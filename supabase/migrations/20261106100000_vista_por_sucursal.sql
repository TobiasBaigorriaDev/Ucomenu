-- Vista por sucursal de cada persona (nivel C; ficha agile/cambios/vista-por-sucursal.md, ADR 0034).
--
-- Cada persona (Dueño o Staff) elige qué sucursal(es) de su local mira: la sala, el cartel del panel, el sonido y el aviso push de
-- sus dispositivos siguen esa elección. Es una PREFERENCIA, no un permiso: la membresía sigue siendo por organización y por la API
-- cualquier miembro lee y atiende los llamados de cualquier sucursal (ADR 0004 y 0005 no cambian).
--
--  * member_branch_views: una fila por persona y local (vale para todos sus dispositivos). Sin permisos ni políticas, como
--    push_subscriptions: nadie la toca por la API; solo las funciones de abajo. La clave foránea a memberships la borra al quitar
--    a la persona del local.
--  * set_my_branch_view(org, sucursales) -> 'ok' | 'unavailable' | 'invalid': solo para quien es miembro de ese local; las sucursales
--    tienen que ser activas de ESE local y no repetirse; vacío = «Todas».
--  * my_branch_view(org) -> uuid[]: la vista EFECTIVA de quien llama = lo guardado ∩ sucursales activas. Vacío = «Todas»: sin fila,
--    con la lista vacía o con sucursales que se desactivaron o se borraron nadie queda sin ver nada.
--  * push_targets_for_call: ahora descarta las suscripciones de quien eligió OTRAS sucursales. Ante cualquier duda avisa (sin vista,
--    lista vacía, o ninguna de las elegidas sigue activa): un aviso de más es preferible a un llamado sin atender. Solo REDUCE
--    destinatarios; no devuelve datos nuevos.
--
-- Rollback (la vista deja de existir y todo vuelve a verse y avisarse en todas las sucursales). ORDEN: restaurar primero la función
-- anterior y recién después retirar lo nuevo; el código de la aplicación de esta tanda llama a my_branch_view, así que antes hay
-- que desplegar el código ANTERIOR:
--   -- 1) volver a crear public.push_targets_for_call(text, text) con la definición de 20261025100000_push_llamados.sql;
--   drop function public.set_my_branch_view(uuid, uuid[]);
--   drop function public.my_branch_view(uuid);
--   drop table public.member_branch_views;

create table public.member_branch_views (
  user_id uuid not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Vacío = todas las sucursales.
  branch_ids uuid[] not null default '{}' check (cardinality(branch_ids) <= 50),
  updated_at timestamptz not null default now(),
  primary key (user_id, organization_id),
  -- Quitar la membresía (o la cuenta) borra la vista.
  foreign key (user_id, organization_id)
    references public.memberships (user_id, organization_id) on delete cascade
);
comment on table public.member_branch_views is
  'Qué sucursales mira cada persona en su local (preferencia, no permiso; ADR 0034). Vacío = todas. Sin acceso por la API: solo funciones.';

alter table public.member_branch_views enable row level security;
revoke all on table public.member_branch_views from public, anon, authenticated, service_role;

create function public.set_my_branch_view(p_org uuid, p_branches uuid[])
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_ids uuid[] := coalesce(p_branches, '{}'::uuid[]);
begin
  if v_user is null or p_org is null or not private.is_org_member(p_org) then
    return 'unavailable';
  end if;

  if cardinality(v_ids) > 50
     or exists (select 1 from unnest(v_ids) i group by i having count(*) > 1)
     or exists (
       select 1 from unnest(v_ids) i
       where not exists (
         select 1 from public.branches b where b.id = i and b.organization_id = p_org and b.is_active
       )
     ) then
    return 'invalid';
  end if;

  insert into public.member_branch_views (user_id, organization_id, branch_ids)
  values (v_user, p_org, v_ids)
  on conflict (user_id, organization_id) do update
    set branch_ids = excluded.branch_ids, updated_at = now();

  return 'ok';
end;
$$;
comment on function public.set_my_branch_view(uuid, uuid[]) is
  'Guarda qué sucursales mira quien llama en p_org (vacío = todas). Solo miembros; las sucursales tienen que ser activas de ese local.';

create function public.my_branch_view(p_org uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select array_agg(b.id order by b.id)
      from public.member_branch_views v
      join public.branches b on b.id = any (v.branch_ids) and b.organization_id = v.organization_id and b.is_active
      where v.user_id = (select auth.uid())
        and v.organization_id = p_org
        and private.is_org_member(p_org)
    ),
    '{}'::uuid[]
  );
$$;
comment on function public.my_branch_view(uuid) is
  'La vista efectiva de quien llama en p_org: sus sucursales elegidas que siguen activas. Vacío = todas.';

revoke all on function public.set_my_branch_view(uuid, uuid[]) from public, anon;
revoke all on function public.my_branch_view(uuid) from public, anon;
grant execute on function public.set_my_branch_view(uuid, uuid[]) to authenticated;
grant execute on function public.my_branch_view(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- push_targets_for_call: solo avisa a quien mira la sucursal de la mesa (o a todas)
-- ---------------------------------------------------------------------------

create or replace function public.push_targets_for_call(p_token text, p_kind text)
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

  select t.id, t.organization_id, t.branch_id, t.label, b.name as branch_name, o.slug,
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
    left join public.member_branch_views v
      on v.user_id = ps.user_id and v.organization_id = ps.organization_id
    where ps.organization_id = v_table.organization_id
      -- Se avisa si la persona no eligió sucursales, si eligió esta, o si ninguna de las que eligió sigue activa (ante la
      -- duda, se avisa: un aviso de más es preferible a un llamado sin atender).
      and (
        v.user_id is null
        or cardinality(v.branch_ids) = 0
        or v_table.branch_id = any (v.branch_ids)
        or not exists (
          select 1 from public.branches vb
          where vb.id = any (v.branch_ids) and vb.organization_id = v.organization_id and vb.is_active
        )
      )
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
  'Destinos del aviso de un llamado recién creado (pendiente de menos de 2 minutos): suscripciones de los miembros de esa organización que miran la sucursal de la mesa (o todas) y los datos del texto. Solo service_role.';
