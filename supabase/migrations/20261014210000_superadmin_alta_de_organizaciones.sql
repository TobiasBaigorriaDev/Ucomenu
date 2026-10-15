-- SuperAdmin mínimo (nivel C): administradores de plataforma, registro de auditoría de solo-agregado y alta de una
-- organización con su Dueño y su plan en una sola transacción.
-- Ficha: agile/cambios/superadmin-alta-de-organizaciones.md · ADR 0013.
--
-- Aditiva: dos tablas, tres funciones, políticas y permisos nuevos. No toca datos ni políticas existentes.
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos (la auditoría se pierde; las organizaciones
-- creadas quedan intactas):
--   drop function public.admin_create_organization(uuid, text, text, uuid, text, text, timestamptz);
--   drop table public.audit_log, public.platform_admins;
--   drop function private.audit_log_append_only(), private.is_platform_admin();
--
-- Reglas de fondo:
--  * `platform_admins` no se escribe por la API ni por service_role: el operador agrega SuperAdmins con SQL
--    (`insert into public.platform_admins (user_id) select id from auth.users where email = '...'`).
--  * `audit_log` solo se agrega: ni la API, ni service_role, ni el dueño de la tabla (trigger) pueden modificarla o
--    borrarla. La escribe únicamente la función de alta, dentro de la MISMA transacción que el cambio.
--  * `actor_id` y `organization_id` NO tienen clave foránea a propósito: el registro sobrevive a la baja de la persona y
--    a un futuro borrado de la organización (ver ADR 0012 para el mismo criterio en price_history).
--  * La función de alta solo la puede ejecutar service_role (el servidor) y vuelve a comprobar que el actor es SuperAdmin.

-- ---------------------------------------------------------------------------
-- Administradores de plataforma
-- ---------------------------------------------------------------------------

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.platform_admins is
  'Personas del equipo de UcoMenu con acceso a /admin. Solo las agrega el operador con SQL; la API no escribe.';

alter table public.platform_admins enable row level security;

create function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins a
    where a.user_id = (select auth.uid())
  );
$$;

-- Cada uno ve solo su propia fila: sirve de prueba de identidad al servidor sin revelar quiénes más son SuperAdmin.
create policy "platform_admins: lectura propia"
  on public.platform_admins for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.platform_admins from anon, authenticated;
grant select on table public.platform_admins to authenticated;
-- Supabase otorga todo a service_role por defecto: se le quita lo que escribe. Conserva SELECT.
revoke insert, update, delete, truncate, references, trigger on table public.platform_admins from service_role;

-- ---------------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  -- Instante real del cambio, para ordenar varios movimientos de una misma transacción.
  created_at timestamptz not null default clock_timestamp(),
  -- Quién lo hizo. Sin clave foránea: sobrevive a la baja de la cuenta. El email es una instantánea del momento.
  actor_id uuid not null,
  actor_email text not null,
  action text not null
    check (action in ('organization.created')),
  -- Organización afectada. Sin clave foránea: sobrevive a su eventual borrado.
  organization_id uuid,
  before jsonb,
  after jsonb
);
comment on table public.audit_log is
  'Cambios de plataforma hechos por SuperAdmin. Solo se agrega: sin escritura por la API ni service_role; la escribe la función que hace el cambio.';
comment on column public.audit_log.after is
  'Estado resultante. No incluye datos personales de terceros (del Dueño solo su user_id, no su email).';

create index audit_log_created_at_idx on public.audit_log (created_at desc);
create index audit_log_organization_idx on public.audit_log (organization_id, created_at desc);

alter table public.audit_log enable row level security;

create policy "audit_log: lectura de SuperAdmin"
  on public.audit_log for select
  to authenticated
  using (private.is_platform_admin());

revoke all on table public.audit_log from anon, authenticated;
grant select on table public.audit_log to authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.audit_log from service_role;

-- Barrera para quien igual tenga privilegios (dueño de la tabla, superusuario): UPDATE, DELETE y TRUNCATE fallan.
-- Una purga deliberada exige `alter table public.audit_log disable trigger ...` y una decisión de retención aceptada.
create function private.audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log es de solo agregado (% rechazado)', tg_op
    using errcode = '42501';
end;
$$;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function private.audit_log_append_only();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.audit_log_append_only();

-- ---------------------------------------------------------------------------
-- Alta de una organización
-- ---------------------------------------------------------------------------
-- Una sola transacción: organización, suscripción, membresía del Dueño y auditoría. Si algo falla no queda nada.
-- La cuenta de Auth del Dueño ya existe (la crea el servidor antes; Auth no es transaccional) y p_owner la identifica.
--
-- Errores con SQLSTATE propio para que el servidor los distinga:
--   42501 not_platform_admin · 22023 invalid_period / invalid_plan · 23505 slug repetido (unique) ·
--   23514 slug o nombre inválidos / ciclo inválido (check) · 23503 el Dueño no existe (clave foránea).
--
-- La organización nueva dispara la prueba de 14 días (trigger de planes); acá se reemplaza por el plan y la fecha
-- pedidos: trial_ends_at queda NULL para que el fin efectivo (greatest(current_period_end, trial_ends_at)) sea el elegido.

create function public.admin_create_organization(
  p_actor uuid,
  p_slug text,
  p_name text,
  p_owner uuid,
  p_plan text,
  p_billing_cycle text,
  p_period_end timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_org_id uuid;
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  if p_period_end is null or p_period_end <= now() or p_period_end > now() + interval '731 days' then
    raise exception 'invalid_period' using errcode = '22023';
  end if;

  if not exists (select 1 from public.plans p where p.code = p_plan) then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;

  select u.email into v_actor_email from auth.users u where u.id = p_actor;

  insert into public.organizations (slug, name)
  values (p_slug, p_name)
  returning id into v_org_id;

  -- La suscripción de prueba ya la creó el trigger de organizations.
  update public.subscriptions
  set plan_code = p_plan,
      billing_cycle = p_billing_cycle,
      current_period_end = p_period_end,
      trial_ends_at = null
  where organization_id = v_org_id;
  if not found then
    raise exception 'subscription_missing' using errcode = 'XX000';
  end if;

  insert into public.memberships (user_id, organization_id, role)
  values (p_owner, v_org_id, 'owner');

  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_actor,
    coalesce(v_actor_email, '(sin email)'),
    'organization.created',
    v_org_id,
    null,
    jsonb_build_object(
      'slug', p_slug,
      'name', p_name,
      'plan', p_plan,
      'billing_cycle', p_billing_cycle,
      'period_end', p_period_end,
      'owner_user_id', p_owner
    )
  );

  return v_org_id;
end;
$$;
comment on function public.admin_create_organization(uuid, text, text, uuid, text, text, timestamptz) is
  'Alta de organización con Dueño, plan y auditoría en una transacción. Solo service_role; vuelve a comprobar que p_actor es SuperAdmin.';

-- ---------------------------------------------------------------------------
-- Permisos de las funciones
-- ---------------------------------------------------------------------------
-- PUBLIC recibe EXECUTE por defecto: se parte de cero. La de alta solo la ejecuta service_role (el servidor); ni anon
-- ni authenticated pueden llamarla por la API, aunque sean SuperAdmin (la acción de servidor es el único camino).

revoke all on function
  private.is_platform_admin(),
  private.audit_log_append_only(),
  public.admin_create_organization(uuid, text, text, uuid, text, text, timestamptz)
from public, anon, authenticated;

grant execute on function private.is_platform_admin() to authenticated;
grant execute on function public.admin_create_organization(uuid, text, text, uuid, text, text, timestamptz) to service_role;
