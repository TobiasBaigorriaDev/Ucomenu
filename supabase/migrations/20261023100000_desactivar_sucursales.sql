-- Desactivar y reactivar sucursales (ficha desactivar-sucursales; reglas en gestion-de-sucursales).
--
-- Una sucursal inactiva:
--   * NO cuenta para el tope del plan (como platos y mesas): el conteo y el trigger miran solo las activas;
--   * deja de publicarse: la lectura pública de `branches` la oculta, y su carta (por dirección, por alias y por el QR de
--     sus mesas) responde «no disponible» —no 404, para que un QR impreso no parezca roto—;
--   * no admite llamados nuevos (`create_waiter_call` responde `unavailable`);
--   * conserva sus mesas, tokens y llamados sin tocarlos, y sigue reservando su `slug` y sus alias.
-- Reactivarla respeta el tope: el trigger la rechaza con 53400 si ya están usadas todas las activas del plan.
-- Quién cambia el estado: solo el owner con la cuenta al día (la política UPDATE de `branches` ya lo exige; solo se suma
-- el privilegio por columna). Sin DELETE, sin `audit_log` (decisión del 2026-10-17).
--
-- Rollback (local: `git revert` + `pnpm db:reset`). En una base con datos, en este orden:
--   revoke update (is_active) on table public.branches from authenticated;
--   drop trigger branches_enforce_limit_on_activate on public.branches;
--   volver a aplicar las definiciones de private.enforce_branch_limit (20261014003848), public.org_entitlements
--     (20261017100000), public.public_menu_status (20261022100000), public.resolve_table_qr (20261014050902) y
--     public.create_waiter_call (20261016140000), y la política de lectura pública de branches (20261014003848);
--   alter table public.branches drop column is_active;  -- solo si ninguna sucursal quedó inactiva (si no, reactivarlas antes).

alter table public.branches add column is_active boolean not null default true;

-- La API de miembros cambia únicamente este flag (no `slug`, `organization_id` ni `id`); el INSERT no lo recibe y nace activa.
grant update (is_active) on table public.branches to authenticated;

-- ---------------------------------------------------------------------------
-- Lectura pública: una sucursal inactiva no se ve por la API (la carta cae en el camino «no disponible»).
-- Los miembros siguen viendo todas las de su organización con la política «lectura de miembros».
-- ---------------------------------------------------------------------------
drop policy "branches: lectura pública de organizaciones activas y publicadas" on public.branches;
create policy "branches: lectura pública de activas y publicadas"
  on public.branches for select
  to anon, authenticated
  using (
    is_active
    and private.org_is_published(organization_id)
    and exists (
      select 1 from public.organizations o
      where o.id = branches.organization_id and o.is_active
    )
  );

-- ---------------------------------------------------------------------------
-- Tope del plan: cuenta solo las activas, al crear y al REACTIVAR. Activa -> inactiva nunca se bloquea.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_branch_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  -- Una sucursal que queda inactiva no consume cupo.
  if not new.is_active then
    return new;
  end if;
  -- Ya estaba activa en la misma organización: editarla (p. ej. renombrar) no consume cupo.
  if tg_op = 'UPDATE' and old.is_active and old.organization_id = new.organization_id then
    return new;
  end if;
  -- Usuario de la API sin membresía en esta organización: no se cuenta ni se informa; decide RLS.
  if (select auth.uid()) is not null and not private.is_org_member(new.organization_id) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('limit:branches:' || new.organization_id::text, 0));

  v_limit := private.org_limit(new.organization_id, 'branches');
  if v_limit is null then
    return new;
  end if;

  select count(*) into v_count
  from public.branches
  where organization_id = new.organization_id and is_active and id <> new.id;

  if v_count >= v_limit then
    raise exception 'limit_exceeded:branches'
      using errcode = '53400',
            detail = format('limit=%s current=%s', v_limit, v_count),
            hint = 'Desactivá una sucursal o cambiá de plan.';
  end if;
  return new;
end;
$$;

-- El trigger de alta (branches_enforce_limit, BEFORE INSERT) sigue igual y usa la función nueva. Este se suma para la
-- reactivación; `of is_active` evita correr el chequeo en cada renombre.
create trigger branches_enforce_limit_on_activate
  before update of is_active on public.branches
  for each row execute function private.enforce_branch_limit();

-- ---------------------------------------------------------------------------
-- Uso del plan: «sucursales» son las activas. Mismo contrato que la versión de 20261017100000.
-- ---------------------------------------------------------------------------
create or replace function public.org_entitlements(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_result jsonb;
  v_sub public.subscriptions%rowtype;
  v_end timestamptz;
begin
  if not private.is_org_member(p_org) then
    return null;
  end if;

  v_state := private.org_state(p_org);

  v_result := jsonb_build_object(
    'state', v_state,
    'can_write', v_state in ('active', 'grace'),
    'features', coalesce(
      (
        select jsonb_agg(f order by f)
        from unnest(array['analytics', 'loyalty', 'menu', 'waiter_call', 'webar']) as f
        where private.has_feature(p_org, f)
      ),
      '[]'::jsonb
    ),
    'limits', jsonb_build_object(
      'branches', private.org_limit(p_org, 'branches'),
      'tables_per_branch', private.org_limit(p_org, 'tables_per_branch'),
      'active_products', private.org_limit(p_org, 'active_products'),
      'models_3d', private.org_limit(p_org, 'models_3d')
    ),
    'usage', jsonb_build_object(
      'branches', (select count(*) from public.branches b where b.organization_id = p_org and b.is_active),
      'active_products', (select count(*) from public.products p where p.organization_id = p_org and p.is_active)
    )
  );

  if private.is_org_owner(p_org) then
    select * into v_sub from public.subscriptions s where s.organization_id = p_org;
    if found then
      v_end := greatest(v_sub.current_period_end, v_sub.trial_ends_at);
      v_result := v_result || jsonb_build_object(
        'plan', v_sub.plan_code,
        'billing_cycle', v_sub.billing_cycle,
        'period_end', v_end,
        'days_late', case when now() <= v_end then 0 else ceil(extract(epoch from (now() - v_end)) / 86400)::integer end,
        'trial_status', private.trial_status(v_sub.trial_ends_at, v_sub.current_period_end, now()),
        'trial_ends_at', v_sub.trial_ends_at,
        'suspended_manually', v_sub.suspended_at is not null
      );
    end if;
  end if;

  return v_result;
end;
$$;
comment on function public.org_entitlements(uuid) is
  'Estado, escritura permitida, features, límites y uso (sucursales activas y platos activos) de la organización. Solo para sus miembros.';

-- ---------------------------------------------------------------------------
-- Estado público de una carta: 'available' | 'suspended' (cuenta en pausa) | 'inactive' (sucursal desactivada) | null.
-- La cuenta suspendida tiene prioridad. Resuelve también los alias, así que un enlace anterior de una sucursal inactiva
-- dice «no disponible» igual que su dirección actual.
-- ---------------------------------------------------------------------------
create or replace function public.public_menu_status(p_org_slug text, p_branch_slug text)
returns text language sql stable security definer set search_path = ''
as $$
  select case
    when not private.org_is_published(o.id) then 'suspended'
    when not b.is_active then 'inactive'
    else 'available'
  end
  from public.organizations o
  join public.branches b on b.organization_id = o.id
  where o.slug = p_org_slug
    and (b.slug = p_branch_slug or p_branch_slug = any(b.slug_aliases))
    and o.is_active;
$$;

-- ---------------------------------------------------------------------------
-- QR de una mesa: misma forma que la versión de 20261014050902 (+ estado 'inactive'). Los botones de llamado no se
-- ofrecen si la sucursal está desactivada.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_table_qr(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'org_slug', o.slug,
    'org_name', o.name,
    'branch_slug', b.slug,
    'table_label', t.label,
    'table_active', t.is_active,
    'status', case
      when not private.org_is_published(o.id) then 'suspended'
      when not b.is_active then 'inactive'
      else 'available'
    end,
    'calls_enabled', (
      t.is_active
      and b.is_active
      and (t.muted_until is null or t.muted_until <= now())
      and private.has_feature(o.id, 'waiter_call')
    )
  )
  from public.tables t
  join public.branches b on b.id = t.branch_id
  join public.organizations o on o.id = t.organization_id
  where p_token ~ '^[0-9a-f]{32}$'
    and t.qr_token = p_token
    and o.is_active;
$$;

-- ---------------------------------------------------------------------------
-- Llamados: ninguno nuevo para las mesas de una sucursal inactiva. Idéntica a la de 20261016140000 salvo la lectura de
-- `b.is_active` y su comprobación junto a las demás causas de «no disponible».
-- ---------------------------------------------------------------------------
create or replace function public.create_waiter_call(
  p_token text,
  p_kind text,
  p_client text default null,
  p_visit_started_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_table record;
  v_client text;
  v_visit timestamptz;
  v_last timestamptz;
  v_count integer;
  v_oldest timestamptz;
  v_retry integer;
begin
  if p_kind is null or p_kind not in ('waiter', 'bill')
     or p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('status', 'not_found');
  end if;

  select t.id, t.organization_id, t.branch_id, t.is_active, t.muted_until,
         b.waiter_call_cooldown_seconds as cooldown, b.is_active as branch_active
    into v_table
  from public.tables t
  join public.branches b on b.id = t.branch_id
  join public.organizations o on o.id = t.organization_id
  where t.qr_token = p_token
    and o.is_active;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Serializa los llamados de una misma mesa: dos toques simultáneos no crean dos pendientes.
  perform pg_advisory_xact_lock(hashtextextended('waiter_call:' || v_table.id::text, 0));

  if not v_table.is_active
     or not v_table.branch_active
     or (v_table.muted_until is not null and v_table.muted_until > now())
     or not private.has_feature(v_table.organization_id, 'waiter_call') then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- Verosímil = de las últimas 24 horas y no del futuro; si no, NULL. Se guarda para la sala y decide el cierre de sesión.
  v_visit := case
    when p_visit_started_at >= now() - interval '24 hours' and p_visit_started_at <= now() + interval '1 minute'
      then p_visit_started_at
  end;

  -- Sesión cerrada: si después de emitido el ticket (el ticket guarda segundos enteros: la emisión cae en
  -- [v_visit, v_visit + 1 s)) el personal atendió un «Pedir la cuenta» de esta mesa y pasaron más de 10 minutos de
  -- gracia, esa visita terminó. Sin ticket verosímil no hay nada que comparar (llamar directo a la API se salta esto,
  -- como el resto de lo que valida la app).
  if v_visit is not null and exists (
    select 1 from public.waiter_calls
    where table_id = v_table.id
      and kind = 'bill'
      and status = 'attended'
      and attended_at >= v_visit + interval '1 second'
      and attended_at <= now() - interval '10 minutes'
  ) then
    return jsonb_build_object('status', 'session_closed');
  end if;

  -- Un pendiente de más de 30 minutos vence solo: no puede bloquear el índice único.
  update public.waiter_calls
  set status = 'expired'
  where table_id = v_table.id
    and status = 'pending'
    and created_at <= now() - interval '30 minutes';

  if exists (
    select 1 from public.waiter_calls
    where table_id = v_table.id and kind = p_kind and status = 'pending'
  ) then
    return jsonb_build_object('status', 'already_pending');
  end if;

  -- Límite por cliente (segunda línea de defensa). Un valor ausente o con otro formato no se cuenta.
  v_client := case when p_client ~ '^[0-9a-f]{32}$' then p_client end;
  if v_client is not null then
    -- El contador abarca TODAS las mesas del cliente y el lock de arriba es por mesa: sin esto, dos pedidos
    -- simultáneos del mismo cliente a mesas distintas leerían el mismo conteo e insertarían ambos (31 avisos).
    -- El lock se toma SIEMPRE después del de la mesa (mesa, luego cliente): el orden fijo evita interbloqueos.
    -- Se libera al terminar la transacción, o sea después del insert; en READ COMMITTED el conteo siguiente ya
    -- ve lo que confirmó quien tenía el lock.
    perform pg_advisory_xact_lock(hashtextextended('waiter_client:' || v_client, 0));

    select count(*), min(created_at) into v_count, v_oldest
    from public.waiter_calls
    where client_key = v_client
      and created_at > now() - interval '10 minutes';

    if v_count >= 30 then
      v_retry := greatest(1, ceil(extract(epoch from (v_oldest + interval '10 minutes' - now())))::integer);
      return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', v_retry);
    end if;
  end if;

  -- Cooldown por mesa y tipo, contado desde la creación del llamado anterior aunque ya esté atendido.
  select max(created_at) into v_last
  from public.waiter_calls
  where table_id = v_table.id and kind = p_kind;

  if v_last is not null and v_last + make_interval(secs => v_table.cooldown) > now() then
    v_retry := greatest(1, ceil(extract(epoch from (v_last + make_interval(secs => v_table.cooldown) - now())))::integer);
    return jsonb_build_object('status', 'cooldown', 'retry_after_seconds', v_retry);
  end if;

  -- El lock de arriba serializa los llamados de la mesa; si aun así otro pendiente del mismo tipo se coló (índice
  -- único parcial), se responde igual que si se hubiera visto antes: nunca un error ni un segundo pendiente.
  begin
    insert into public.waiter_calls (organization_id, branch_id, table_id, kind, client_key, visit_started_at)
    values (v_table.organization_id, v_table.branch_id, v_table.id, p_kind, v_client, v_visit);
  exception when unique_violation then
    return jsonb_build_object('status', 'already_pending');
  end;

  return jsonb_build_object('status', 'created');
end;
$$;
comment on function public.create_waiter_call(text, text, text, timestamptz) is
  'Única puerta de escritura de waiter_calls (ADR 0010). Público: valida token, disponibilidad (mesa y sucursal activas), sesión cerrada 10 minutos después de atender la cuenta, vencimiento, un pendiente por tipo, límite por cliente y cooldown. p_visit_started_at (ticket de visita): informativo y, si es verosímil, decide el cierre de sesión.';
