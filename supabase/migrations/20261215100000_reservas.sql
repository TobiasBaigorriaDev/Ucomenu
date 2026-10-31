-- Reservas de mesa, fase 1: reservas manuales y asignación de mesa (ficha agile/cambios/reservas-de-mesa.md, ADR 0051). Nivel C.
--
-- Qué hace:
--  * Catálogo: `reservations` entra a `plans.features` y a `plans_features_check`, y se concede a Pro y Premium.
--    `public.org_entitlements` la informa (mismo contrato que 20261121100000, con una función más en la lista).
--  * Tabla `reservations`: una reserva de una sucursal (nombre, teléfono, email opcional, personas, horario, nota, estado) y la mesa
--    asignada, con su etiqueta copiada. Claves foráneas compuestas con la organización: ninguna apunta a una sucursal o mesa ajena.
--  * NADIE escribe la tabla por la API (tampoco `service_role`): las únicas puertas son `create_reservation`,
--    `assign_reservation_table` y `set_reservation_status`, que exigen un Dueño o Staff (no el cocinero) con la función en el plan y la
--    cuenta al día (`has_feature` ya excluye solo lectura y suspendida). Lee la tabla solo un Dueño o Staff de la organización.
--  * Una mesa no tiene dos reservas `confirmed`/`seated` que se superpongan: lo comprueba la función bajo un candado por mesa.
--  * `purge_expired_reservations`: borra los datos personales 30 días después de terminada la reserva (la programa quien despliega).
--
-- Errores estables (el mensaje es el nombre):
--   42501 reservations_not_allowed (sin sesión, no es miembro, o el plan/la mora no lo permiten) · P0002 branch_not_found /
--   table_not_found / reservation_not_found · 22023 invalid_client_key / client_key_reused / invalid_name / invalid_phone /
--   invalid_email / invalid_party / invalid_duration / invalid_time / invalid_notes / invalid_status / invalid_transition ·
--   23P01 table_busy (la mesa ya tiene otra reserva en ese horario) · 53400 reservations_full (2000 reservas sin terminar).
--
-- Aditiva: sin datos que migrar. Borrar la organización se lleva las reservas por cascada; borrar una mesa deja la reserva con la
-- etiqueta copiada y sin mesa.
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos reales: exportar `reservations` (si hace falta) y después
--   1. drop function public.create_reservation(uuid, text, text, text, integer, date, time, integer, text, uuid, uuid),
--      public.assign_reservation_table(uuid, uuid), public.set_reservation_status(uuid, text),
--      public.purge_expired_reservations(interval, integer), private.can_manage_reservations(uuid),
--      private.reservation_table_is_free(uuid, timestamptz, timestamptz, uuid);
--   2. drop table public.reservations;
--   3. quitar `reservations` de `plans.features` y de `plans_features_check`, y volver a crear `org_entitlements` con 20261121100000.

begin;

-- ---------------------------------------------------------------------------
-- Catálogo de planes
-- ---------------------------------------------------------------------------

alter table public.plans drop constraint plans_features_check;
alter table public.plans add constraint plans_features_check
  check (features <@ array['menu', 'waiter_call', 'loyalty', 'analytics', 'video_feed', 'promotions', 'orders', 'reservations']);

update public.plans
set features = array_append(features, 'reservations')
where code in ('pro', 'premium') and not ('reservations' = any (features));

-- ---------------------------------------------------------------------------
-- Lo que informa org_entitlements
-- ---------------------------------------------------------------------------
-- Mismo contrato que 20261121100000; cambia solo la lista de funciones que informa (suma `reservations`).
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
  v_ad public.addons%rowtype;
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
        from unnest(array['analytics', 'customers', 'loyalty', 'menu', 'orders', 'promotions', 'reservations', 'review_invite', 'video_feed', 'waiter_call']) as f
        where private.has_feature(p_org, f)
      ),
      '[]'::jsonb
    ),
    'limits', jsonb_build_object(
      'branches', private.org_limit(p_org, 'branches'),
      'tables_per_branch', private.org_limit(p_org, 'tables_per_branch'),
      'active_products', private.org_limit(p_org, 'active_products'),
      'videos_published', private.org_limit(p_org, 'videos_published')
    ),
    'usage', jsonb_build_object(
      'branches', (select count(*) from public.branches b where b.organization_id = p_org and b.is_active),
      'active_products', (select count(*) from public.products p where p.organization_id = p_org and p.is_active),
      'videos_published', (select count(*) from public.menu_videos v where v.organization_id = p_org and v.status = 'published')
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

      select * into v_ad from public.addons ad where ad.grants_limit = 'branches' order by ad.code limit 1;
      if found and v_sub.plan_code = any (v_ad.allowed_plans) then
        v_result := v_result || jsonb_build_object(
          'extra_branches', private.org_extra_branches(p_org),
          'extra_branch_price_cents', v_ad.price_cents,
          'extra_branch_currency', v_ad.currency,
          'extra_branch_max', v_ad.max_packs * v_ad.quota_per_pack
        );
      end if;
    end if;
  end if;

  return v_result;
end;
$$;
comment on function public.org_entitlements(uuid) is
  'Estado, escritura permitida, features, límites y uso (sucursales activas, platos activos y videos publicados) de la organización; para el Dueño, además, plan, fechas y sucursales adicionales. Solo para sus miembros.';


-- ---------------------------------------------------------------------------
-- Tabla
-- ---------------------------------------------------------------------------

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  -- Nulo si no tiene mesa asignada o si se borra la mesa: la reserva se conserva con la etiqueta copiada.
  table_id uuid,
  table_label text,
  source text not null default 'manual',
  status text not null default 'requested',
  guest_name text not null,
  guest_phone text not null,
  guest_email text,
  party_size smallint not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  notes text,
  -- Clave que genera el cliente por envío: repetir la llamada con la misma no duplica la reserva.
  client_key uuid not null,
  request_hash text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint reservations_id_organization_key unique (id, organization_id),
  constraint reservations_source_check check (source in ('manual', 'public')),
  constraint reservations_status_check
    check (status in ('pending_email', 'requested', 'confirmed', 'seated', 'rejected', 'cancelled', 'no_show')),
  constraint reservations_name_check check (char_length(btrim(guest_name)) between 1 and 80),
  constraint reservations_phone_check check (guest_phone ~ '^[0-9+() -]{6,30}$'),
  constraint reservations_email_check check (guest_email is null or (char_length(guest_email) <= 120 and guest_email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')),
  constraint reservations_party_check check (party_size between 1 and 50),
  constraint reservations_time_check check (ends_at > starts_at and ends_at <= starts_at + interval '6 hours'),
  constraint reservations_notes_check check (notes is null or (char_length(notes) between 1 and 300 and notes !~ '[[:cntrl:]]')),
  constraint reservations_table_check check ((table_id is null) or (status in ('confirmed', 'seated'))),
  foreign key (branch_id, organization_id) references public.branches (id, organization_id) on delete cascade,
  foreign key (table_id, branch_id, organization_id) references public.tables (id, branch_id, organization_id) on delete set null (table_id)
);
comment on table public.reservations is
  'Reserva de una mesa (ADR 0051). Se escribe solo con create_reservation, assign_reservation_table y set_reservation_status; la etiqueta de la mesa se copia. Datos personales: se purgan 30 días después de terminada.';

create unique index reservations_client_key on public.reservations (organization_id, client_key);
create index reservations_branch_day_idx on public.reservations (branch_id, starts_at);
create index reservations_organization_idx on public.reservations (organization_id, starts_at desc);
create index reservations_table_idx on public.reservations (table_id, starts_at) where table_id is not null;
create index reservations_ends_at_idx on public.reservations (ends_at);

-- ---------------------------------------------------------------------------
-- Permisos y lectura
-- ---------------------------------------------------------------------------
-- Gestiona un Dueño o Staff (NO el cocinero) con la función en el plan y la cuenta al día.

create function private.can_manage_reservations(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_member(org_id) and private.has_feature(org_id, 'reservations');
$$;
revoke all on function private.can_manage_reservations(uuid) from public, anon, authenticated;

alter table public.reservations enable row level security;

revoke all on table public.reservations from anon, authenticated;
-- Lee un Dueño o Staff de la organización aunque el plan o la cuenta ya no permitan escribir (ven lo que ya tenían); nadie más.
create policy "reservations: lectura de miembros"
  on public.reservations for select to authenticated
  using (private.is_org_member(organization_id));
grant select on table public.reservations to authenticated;

-- Ni siquiera el servicio técnico escribe: solo las funciones (y la cascada del borrado de la organización, que corre con el dueño).
revoke insert, update, delete, truncate, references, trigger on table public.reservations from service_role;

-- ---------------------------------------------------------------------------
-- ¿La mesa está libre en ese horario? (se llama con el candado de la mesa tomado)
-- ---------------------------------------------------------------------------

create function private.reservation_table_is_free(p_table uuid, p_starts timestamptz, p_ends timestamptz, p_except uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.reservations r
    where r.table_id = p_table
      and r.status in ('confirmed', 'seated')
      and r.id is distinct from p_except
      and r.starts_at < p_ends
      and r.ends_at > p_starts
  );
$$;
revoke all on function private.reservation_table_is_free(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Alta de una reserva (manual)
-- ---------------------------------------------------------------------------

create function public.create_reservation(
  p_branch uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_party integer,
  p_date date,
  p_time time,
  p_duration integer,
  p_notes text,
  p_table uuid,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_active boolean;
  v_tz text;
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_duration integer := coalesce(p_duration, 90);
  v_starts timestamptz;
  v_ends timestamptz;
  v_label text;
  v_status text := 'requested';
  v_hash text;
  v_open integer;
  v_row public.reservations%rowtype;
begin
  if v_uid is null then
    raise exception 'reservations_not_allowed' using errcode = '42501';
  end if;

  select b.organization_id, b.is_active, b.timezone into v_org, v_active, v_tz from public.branches b where b.id = p_branch;
  if not found then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  -- Antes de mirar nada más de la organización: quien no es miembro (o no tiene plan o cuenta al día) no aprende qué hay adentro.
  if not private.can_manage_reservations(v_org) then
    raise exception 'reservations_not_allowed' using errcode = '42501';
  end if;
  if not v_active then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;

  if p_client_key is null then
    raise exception 'invalid_client_key' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_phone !~ '^[0-9+() -]{6,30}$' or char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 6 then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  if v_email is not null and (char_length(v_email) > 120 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$') then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if p_party is null or p_party < 1 or p_party > 50 then
    raise exception 'invalid_party' using errcode = '22023';
  end if;
  if v_duration < 30 or v_duration > 360 then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;
  if v_notes is not null and (char_length(v_notes) > 300 or v_notes ~ '[[:cntrl:]]') then
    raise exception 'invalid_notes' using errcode = '22023';
  end if;
  if p_date is null or p_time is null then
    raise exception 'invalid_time' using errcode = '22023';
  end if;
  -- Fecha y hora LOCALES de la sucursal (ADR 0040): se convierten con su zona. No en el pasado (1 hora de margen) ni a más de un año.
  v_starts := (p_date + p_time) at time zone v_tz;
  v_ends := v_starts + make_interval(mins => v_duration);
  if v_starts < now() - interval '1 hour' or v_starts > now() + interval '365 days' then
    raise exception 'invalid_time' using errcode = '22023';
  end if;

  -- Mismo envío repetido a la vez: se serializa por clave, así la segunda llamada ve la reserva de la primera.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || p_client_key::text, 0));
  if not private.can_manage_reservations(v_org) then
    raise exception 'reservations_not_allowed' using errcode = '42501';
  end if;
  -- La huella cubre TODO lo que la persona cargó (también la nota): repetir la clave con otros datos no se toma por un reintento.
  v_hash := md5(format('%s|%s|%s|%s|%s|%s|%s|%s|%s', p_branch, v_name, v_phone, coalesce(v_email, ''), p_party, v_starts, v_duration, coalesce(p_table::text, ''), coalesce(v_notes, '')));
  select r.* into v_row from public.reservations r where r.organization_id = v_org and r.client_key = p_client_key;
  if found then
    if v_row.request_hash <> v_hash then
      raise exception 'client_key_reused' using errcode = '22023';
    end if;
    return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'starts_at', v_row.starts_at, 'table_label', v_row.table_label, 'replayed', true);
  end if;

  select count(*) into v_open from public.reservations r
  where r.organization_id = v_org and r.status in ('pending_email', 'requested', 'confirmed') and r.ends_at > now();
  if v_open >= 2000 then
    raise exception 'reservations_full' using errcode = '53400';
  end if;

  if p_table is not null then
    select t.label into v_label
    from public.tables t
    where t.id = p_table and t.branch_id = p_branch and t.organization_id = v_org and t.is_active;
    if not found then
      raise exception 'table_not_found' using errcode = 'P0002';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_table::text, 1));
    if not private.reservation_table_is_free(p_table, v_starts, v_ends, null) then
      raise exception 'table_busy' using errcode = '23P01';
    end if;
    v_status := 'confirmed';
  end if;

  insert into public.reservations (
    organization_id, branch_id, table_id, table_label, source, status, guest_name, guest_phone, guest_email,
    party_size, starts_at, ends_at, notes, client_key, request_hash, created_by
  ) values (
    v_org, p_branch, p_table, v_label, 'manual', v_status, v_name, v_phone, v_email,
    p_party, v_starts, v_ends, v_notes, p_client_key, v_hash, v_uid
  ) returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'starts_at', v_row.starts_at, 'table_label', v_row.table_label, 'replayed', false);
end;
$$;
revoke all on function public.create_reservation(uuid, text, text, text, integer, date, time, integer, text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_reservation(uuid, text, text, text, integer, date, time, integer, text, uuid, uuid) to authenticated;
comment on function public.create_reservation(uuid, text, text, text, integer, date, time, integer, text, uuid, uuid) is
  'Alta manual de una reserva (ADR 0051). Hora local de la sucursal; con mesa nace confirmada. Solo Dueño o Staff con la función en el plan.';

-- ---------------------------------------------------------------------------
-- Asignar (o cambiar) la mesa: la reserva queda confirmada
-- ---------------------------------------------------------------------------

create function public.assign_reservation_table(p_reservation uuid, p_table uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_row public.reservations%rowtype;
  v_label text;
begin
  if v_uid is null then
    raise exception 'reservations_not_allowed' using errcode = '42501';
  end if;
  select r.* into v_row from public.reservations r where r.id = p_reservation;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  if not private.can_manage_reservations(v_row.organization_id) then
    raise exception 'reservations_not_allowed' using errcode = '42501';
  end if;

  select t.label into v_label
  from public.tables t
  where t.id = p_table and t.branch_id = v_row.branch_id and t.organization_id = v_row.organization_id and t.is_active;
  if not found then
    raise exception 'table_not_found' using errcode = 'P0002';
  end if;

  -- Candado de la mesa, y recién después se vuelve a leer la reserva y a comprobar quién llama: lo que cambió mientras esperaba manda.
  perform pg_advisory_xact_lock(hashtextextended(p_table::text, 1));
  select r.* into v_row from public.reservations r where r.id = p_reservation for update;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  if not private.can_manage_reservations(v_row.organization_id) then
    raise exception 'reservations_not_allowed' using errcode = '42501';
  end if;
  if v_row.status not in ('requested', 'confirmed') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if not private.reservation_table_is_free(p_table, v_row.starts_at, v_row.ends_at, v_row.id) then
    raise exception 'table_busy' using errcode = '23P01';
  end if;

  update public.reservations
  set table_id = p_table, table_label = v_label, status = 'confirmed', updated_at = clock_timestamp()
  where id = v_row.id
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'table_label', v_row.table_label);
end;
$$;
revoke all on function public.assign_reservation_table(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.assign_reservation_table(uuid, uuid) to authenticated;
comment on function public.assign_reservation_table(uuid, uuid) is
  'Asigna una mesa a una reserva solicitada o confirmada y la deja confirmada (ADR 0051). table_busy si la mesa ya tiene otra en ese horario.';

-- ---------------------------------------------------------------------------
-- Cambiar el estado
-- ---------------------------------------------------------------------------
-- requested -> cancelled | rejected · confirmed -> seated | cancelled | no_show | requested (suelta la mesa).
-- seated, cancelled, rejected y no_show son finales. `no_show` solo desde la hora de inicio.

create function public.set_reservation_status(p_reservation uuid, p_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_row public.reservations%rowtype;
begin
  if v_uid is null then
    raise exception 'reservations_not_allowed' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('requested', 'seated', 'rejected', 'cancelled', 'no_show') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  select r.* into v_row from public.reservations r where r.id = p_reservation;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  if not private.can_manage_reservations(v_row.organization_id) then
    raise exception 'reservations_not_allowed' using errcode = '42501';
  end if;

  select r.* into v_row from public.reservations r where r.id = p_reservation for update;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  if not private.can_manage_reservations(v_row.organization_id) then
    raise exception 'reservations_not_allowed' using errcode = '42501';
  end if;

  if not (
    (v_row.status = 'requested' and p_status in ('cancelled', 'rejected'))
    or (v_row.status = 'confirmed' and p_status in ('seated', 'cancelled', 'no_show', 'requested'))
  ) then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if p_status = 'no_show' and now() < v_row.starts_at then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  -- Solo una reserva `confirmed` o `seated` tiene mesa: al cancelar o dar «no vino» se suelta (queda libre para otra) y se conserva la
  -- etiqueta como constancia; al volver a `requested` se suelta también la etiqueta.
  update public.reservations
  set status = p_status,
      table_id = case when p_status = 'seated' then table_id else null end,
      table_label = case when p_status = 'requested' then null else table_label end,
      updated_at = clock_timestamp()
  where id = v_row.id
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'table_label', v_row.table_label);
end;
$$;
revoke all on function public.set_reservation_status(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_reservation_status(uuid, text) to authenticated;
comment on function public.set_reservation_status(uuid, text) is
  'Cambia el estado de una reserva según las transiciones permitidas (ADR 0051). Cancelar, rechazar o soltar conserva los datos hasta la purga.';

-- ---------------------------------------------------------------------------
-- Retención: 30 días después de terminada la reserva
-- ---------------------------------------------------------------------------
-- Solo `service_role` (la dispara quien despliega con pg_cron; docs/produccion.md). Por lotes, con `skip locked`, sobre el FIN de la
-- reserva. Piso de 7 días sobre el corte efectivo (`now() - retención`): un valor mal puesto no borra reservas recientes.

create function public.purge_expired_reservations(p_retention interval default interval '30 days', p_batch integer default 500)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_deleted integer;
begin
  if p_retention is null then
    raise exception 'invalid_retention' using errcode = '22023';
  end if;
  begin
    v_cutoff := now() - p_retention;
  exception when datetime_field_overflow then
    raise exception 'invalid_retention' using errcode = '22023';
  end;
  if v_cutoff > now() - interval '7 days' then
    raise exception 'invalid_retention' using errcode = '22023';
  end if;
  if p_batch is null or p_batch < 1 or p_batch > 5000 then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;

  with doomed as (
    select r.id from public.reservations r where r.ends_at < v_cutoff order by r.ends_at limit p_batch for update skip locked
  )
  delete from public.reservations r using doomed where r.id = doomed.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.purge_expired_reservations(interval, integer) from public, anon, authenticated, service_role;
grant execute on function public.purge_expired_reservations(interval, integer) to service_role;
comment on function public.purge_expired_reservations(interval, integer) is
  'Borra por lotes las reservas terminadas hace más de la retención (30 días por defecto; piso de 7). Solo service_role. Devuelve cuántas borró.';

commit;
