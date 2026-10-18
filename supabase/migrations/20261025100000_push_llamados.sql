-- Aviso de llamados con la pestaña cerrada: Web Push (nivel C; ficha agile/cambios/aviso-push-de-llamados.md, ADR 0020).
--
-- Aditiva: una tabla y cinco funciones nuevas (más una auxiliar en `private`). No toca datos ni cambia ninguna función o
-- política vigente.
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos:
--   drop function public.register_push_subscription(uuid, text, text, text);
--   drop function public.unregister_push_subscription(text, uuid);
--   drop function public.push_subscription_registered(uuid, text);
--   drop function public.push_targets_for_call(text, text);
--   drop function public.drop_push_subscriptions(uuid[]);
--   drop table public.push_subscriptions;
--   drop function private.is_push_endpoint(text);
-- (solo se pierden las suscripciones de los dispositivos: cada persona vuelve a activar el aviso desde la sala).
--
-- Reglas de fondo:
--  * Una suscripción es una dirección secreta del servicio de push del navegador + dos claves del dispositivo. NADIE la
--    lee por la API (ni el Dueño): la tabla no tiene permisos para anon, authenticated ni service_role. Todo pasa por
--    funciones SECURITY DEFINER con permisos mínimos.
--  * Solo un miembro de la organización registra la suya (user_id = auth.uid()), y solo mientras el plan y la cuenta
--    permitan el llamado. La clave foránea compuesta a memberships hace que quitar a una persona del local borre sus
--    suscripciones: un push nunca le llega a quien ya no es miembro.
--  * Anti-SSRF: el servidor hace un POST a la dirección guardada, así que solo se aceptan https y los hosts de los
--    servicios de push de Chrome/Android (FCM), Edge (WNS), Firefox y Safari. La misma lista está en el servidor.
--  * El envío lo decide el servidor (service_role) con push_targets_for_call: exige que acabe de crearse un pendiente
--    de esa mesa y devuelve solo suscripciones de miembros de ESA organización.

-- Hosts permitidos (mismo criterio que isAllowedPushEndpoint en src/lib/push/endpoint.ts).
create function private.is_push_endpoint(p_endpoint text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_endpoint ~ '^https://(fcm\.googleapis\.com|[a-z0-9-]+\.notify\.windows\.com|([a-z0-9-]+\.)?push\.services\.mozilla\.com|([a-z0-9-]+\.)?push\.apple\.com)/[^[:space:]\\]*$',
    false
  );
$$;
-- Solo la usa la restricción CHECK de la tabla y las funciones de abajo (que corren como su dueño): nadie más la ejecuta.
revoke all on function private.is_push_endpoint(text) from public, anon, authenticated;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null,
  endpoint text not null
    check (length(endpoint) <= 1000 and private.is_push_endpoint(endpoint)),
  p256dh text not null check (length(p256dh) <= 128),
  auth_secret text not null check (length(auth_secret) <= 64),
  created_at timestamptz not null default now(),
  registered_at timestamptz not null default now(),
  unique (organization_id, endpoint),
  -- Quitar la membresía (o la cuenta) borra la suscripción; registrar exige ser miembro.
  foreign key (user_id, organization_id)
    references public.memberships (user_id, organization_id) on delete cascade
);
comment on table public.push_subscriptions is
  'Dispositivos del personal suscritos al aviso de llamados (Web Push, ADR 0020). Secreto: sin acceso por la API; se escribe y se lee solo con funciones.';

create index push_subscriptions_user_idx on public.push_subscriptions (user_id, organization_id);

alter table public.push_subscriptions enable row level security;
-- Sin políticas: con RLS activo y sin políticas nadie la ve; además se quitan los permisos que Supabase da por defecto.
revoke all on table public.push_subscriptions from public, anon, authenticated, service_role;

-- Registrar (o refrescar) el dispositivo de quien llama. Devuelve: ok | unavailable | invalid | limit.
create function public.register_push_subscription(p_org uuid, p_endpoint text, p_p256dh text, p_auth text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null or p_org is null then
    return 'unavailable';
  end if;

  if not exists (
    select 1 from public.memberships m where m.user_id = v_user and m.organization_id = p_org
  ) or not private.has_feature(p_org, 'waiter_call') then
    return 'unavailable';
  end if;

  if p_endpoint is null or length(p_endpoint) > 1000 or not private.is_push_endpoint(p_endpoint)
     or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{86,88}$'
     or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22,24}$' then
    return 'invalid';
  end if;

  -- Tope por persona y local (un teléfono y una PC son dos; diez cubre de sobra y frena el abuso). El lock serializa los
  -- registros de la misma persona y local: sin él, dos pedidos simultáneos contarían los mismos nueve y terminarían en once.
  perform pg_advisory_xact_lock(hashtextextended('push_subscription:' || v_user::text || ':' || p_org::text, 0));
  if (
    select count(*) from public.push_subscriptions s
    where s.user_id = v_user and s.organization_id = p_org and s.endpoint <> p_endpoint
  ) >= 10 then
    return 'limit';
  end if;

  -- Si el mismo dispositivo ya estaba registrado por otra persona (cambio de cuenta en la misma PC), pasa a quien lo usa ahora.
  insert into public.push_subscriptions (organization_id, user_id, endpoint, p256dh, auth_secret)
  values (p_org, v_user, p_endpoint, p_p256dh, p_auth)
  on conflict (organization_id, endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth_secret = excluded.auth_secret,
        registered_at = now();

  return 'ok';
end;
$$;
comment on function public.register_push_subscription(uuid, text, text, text) is
  'Registra el dispositivo de quien llama para recibir avisos de llamados de p_org (miembro, plan y cuenta al día; endpoint de un servicio de push conocido). ok | unavailable | invalid | limit.';

-- Quitar el dispositivo: solo las suscripciones PROPIAS de ese endpoint (de un local, o de todos si p_org es nulo).
create function public.unregister_push_subscription(p_endpoint text, p_org uuid default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions s
  where s.user_id = (select auth.uid())
    and s.endpoint = p_endpoint
    and (p_org is null or s.organization_id = p_org);
$$;
comment on function public.unregister_push_subscription(text, uuid) is
  'Borra las suscripciones propias de ese endpoint (de un local o de todos). No toca las de otras personas.';

-- ¿Este dispositivo sigue registrado para este local? Solo mira las suscripciones propias.
create function public.push_subscription_registered(p_org uuid, p_endpoint text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.push_subscriptions s
    where s.user_id = (select auth.uid())
      and s.organization_id = p_org
      and s.endpoint = p_endpoint
  );
$$;
comment on function public.push_subscription_registered(uuid, text) is
  'Si el dispositivo (endpoint) de quien llama está registrado para p_org. Solo ve lo propio.';

-- A quién avisar por un llamado recién creado. Solo service_role (el servidor, después de create_waiter_call = created).
-- Devuelve null si no corresponde avisar. Nunca devuelve ids de mesa ni de organización: solo lo que arma el aviso
-- (incluida una clave opaca de la mesa, que distingue mesas homónimas de sucursales distintas en la etiqueta del aviso).
create function public.push_targets_for_call(p_token text, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_table record;
  v_multi boolean;
  v_subscriptions jsonb;
begin
  if p_kind is null or p_kind not in ('waiter', 'bill')
     or p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return null;
  end if;

  select t.id, t.organization_id, t.label, b.name as branch_name, o.slug,
         substr(md5(t.id::text), 1, 12) as table_key
    into v_table
  from public.tables t
  join public.branches b on b.id = t.branch_id and b.is_active
  join public.organizations o on o.id = t.organization_id and o.is_active
  where t.qr_token = p_token
    and t.is_active;

  if not found or not private.has_feature(v_table.organization_id, 'waiter_call') then
    return null;
  end if;

  -- Solo por un llamado que acaba de crearse y sigue pendiente: esta función no sirve para avisar "porque sí".
  if not exists (
    select 1 from public.waiter_calls w
    where w.table_id = v_table.id
      and w.kind = p_kind
      and w.status = 'pending'
      and w.created_at > now() - interval '2 minutes'
  ) then
    return null;
  end if;

  select count(*) > 1 into v_multi
  from public.branches b
  where b.organization_id = v_table.organization_id and b.is_active;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth_secret)), '[]'::jsonb)
    into v_subscriptions
  from (
    select ps.id, ps.endpoint, ps.p256dh, ps.auth_secret
    from public.push_subscriptions ps
    where ps.organization_id = v_table.organization_id
    order by ps.registered_at desc
    limit 200
  ) s;

  return jsonb_build_object(
    'slug', v_table.slug,
    'table_label', v_table.label,
    'table_key', v_table.table_key,
    'branch_name', v_table.branch_name,
    'multi_branch', v_multi,
    'subscriptions', v_subscriptions
  );
end;
$$;
comment on function public.push_targets_for_call(text, text) is
  'Destinos del aviso de un llamado recién creado (pendiente de menos de 2 minutos): suscripciones de los miembros de esa organización y los datos del texto. Solo service_role.';

-- Limpieza de suscripciones que el servicio de push dio por muertas (404/410). Solo service_role.
create function public.drop_push_subscriptions(p_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500 then
    return 0;
  end if;
  delete from public.push_subscriptions where id = any (p_ids);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
comment on function public.drop_push_subscriptions(uuid[]) is
  'Borra suscripciones por id (las que el servicio de push dio por vencidas). Solo service_role.';

-- PUBLIC recibe EXECUTE por defecto: se parte de cero.
revoke all on function public.register_push_subscription(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.unregister_push_subscription(text, uuid) from public, anon, authenticated;
revoke all on function public.push_subscription_registered(uuid, text) from public, anon, authenticated;
revoke all on function public.push_targets_for_call(text, text) from public, anon, authenticated;
revoke all on function public.drop_push_subscriptions(uuid[]) from public, anon, authenticated;

grant execute on function public.register_push_subscription(uuid, text, text, text) to authenticated;
grant execute on function public.unregister_push_subscription(text, uuid) to authenticated;
grant execute on function public.push_subscription_registered(uuid, text) to authenticated;
grant execute on function public.push_targets_for_call(text, text) to service_role;
grant execute on function public.drop_push_subscriptions(uuid[]) to service_role;
