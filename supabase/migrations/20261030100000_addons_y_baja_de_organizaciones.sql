-- SuperAdmin: add-ons y baja (desactivar / reactivar) de organizaciones (nivel C).
-- Ficha: agile/cambios/addons-y-baja-de-organizaciones.md · ADR 0013 (patrón de las acciones) y 0025 (baja).
--
-- Tres acciones de SuperAdmin, cada una UNA función de API que solo ejecuta service_role, recomprueba que `p_actor` es
-- SuperAdmin, toma un lock y escribe `audit_log` en la misma transacción (ADR 0013):
--   admin_set_addon(actor, org, addon, extra_packs, ends_at, reason)  activa, o cambia los packs / la fecha de fin
--   admin_end_addon(actor, org, addon, reason)                        finaliza un add-on vigente (ends_at = ahora)
--   admin_set_organization_active(actor, org, active, reason)         da de baja (false) o reactiva (true)
--
-- Aditiva salvo cuatro cosas: (1) amplía el `check` de `audit_log.action`; (2) reemplaza `private.is_org_member` y
-- `private.is_org_owner` (con `create or replace`: conservan sus permisos) para que una organización dada de baja NO
-- tenga miembros ni Dueños a efectos de RLS; (3) reemplaza `private.org_state`, que devuelve `suspended` para una organización
-- dada de baja (defensa en profundidad: sin escrituras ni funciones aunque algo consulte el estado directamente);
-- (4) reemplaza `owner_account_history` (suma las acciones nuevas a su lista blanca).
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos (la auditoría queda y, mientras existan filas con
-- las acciones nuevas, no se puede volver a poner el `check` viejo; los add-ons cargados quedan como están). En UNA
-- transacción (begin … commit):
--   drop function public.admin_set_addon(uuid, uuid, text, integer, timestamptz, text),
--                 public.admin_end_addon(uuid, uuid, text, text),
--                 public.admin_set_organization_active(uuid, uuid, boolean, text);
--   y volver a crear `private.is_org_member`, `private.is_org_owner`, `private.org_state` y `owner_account_history` con las
--   definiciones de 20261014000121_tenant_core_memberships_and_write_policies.sql,
--   20261017100000_superadmin_planes_pagos_suspension.sql y 20261029100000_anular_pagos.sql.
-- Una organización dada de baja vuelve a funcionar al reactivarla (o al poner `is_active = true` a mano): no se pierde nada.
--
-- Reglas de fondo:
--  * Baja = reversible y sin borrar nada: `organizations.is_active = false`. La carta pública, los QR y los llamados ya
--    filtraban por `is_active`; ahora además nadie entra por RLS (el Dueño y el Staff dejan de ser miembros a efectos de
--    políticas y de `org_entitlements`) y `org_state` es `suspended`. No toca la suscripción, los pagos ni la suspensión manual.
--  * El borrado y la purga de organizaciones NO se implementan (ADR 0012: falta definir la retención de `price_history`,
--    `payments` y `payment_voids`).
--  * Add-ons: solo sobre un plan que lo admite (`addons.allowed_plans`); packs extra entre 0 y 50; fin opcional, futuro y a
--    lo sumo a 731 días. Finalizar conserva la fila (y los packs) y pone `ends_at = now()`. El motivo es obligatorio y no
--    llega al Dueño. Los packs y la fecha no se reescriben en silencio: cada cambio queda en `audit_log`.

-- ---------------------------------------------------------------------------
-- Auditoría: acciones nuevas
-- ---------------------------------------------------------------------------

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in (
    'organization.created',
    'subscription.plan_changed',
    'subscription.suspended',
    'subscription.reactivated',
    'payment.registered',
    'payment.voided',
    'owner.added',
    'organization.deactivated',
    'organization.reactivated',
    'addon.activated',
    'addon.changed',
    'addon.ended'
  ));

-- ---------------------------------------------------------------------------
-- Una organización dada de baja no tiene miembros (RLS) y su estado es `suspended`
-- ---------------------------------------------------------------------------

create or replace function private.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
      and o.is_active
  );
$$;

create or replace function private.is_org_owner(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
      and o.is_active
  );
$$;

create or replace function private.org_state(org_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case
        when not o.is_active then 'suspended'
        when s.suspended_at is not null then 'suspended'
        else private.billing_state(greatest(s.current_period_end, s.trial_ends_at), now())
      end
      from public.subscriptions s
      join public.organizations o on o.id = s.organization_id
      where s.organization_id = org_id
    ),
    'suspended'
  );
$$;

-- ---------------------------------------------------------------------------
-- Acciones de SuperAdmin
-- ---------------------------------------------------------------------------
-- Errores (mensaje = nombre estable que lee el servidor):
--   42501 not_platform_admin · 22023 invalid_reason / invalid_addon / invalid_packs / invalid_ends_at ·
--   P0002 subscription_not_found / organization_not_found ·
--   55000 addon_not_allowed / addon_unchanged / addon_not_active / already_inactive / already_active.

-- Activar un add-on, o cambiar sus packs extra y su fecha de fin. `p_ends_at` nulo = sin fecha de fin.
create function public.admin_set_addon(
  p_actor uuid,
  p_org uuid,
  p_addon text,
  p_extra_packs integer,
  p_ends_at timestamptz,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_reason text;
  v_addon public.addons%rowtype;
  v_sub public.subscriptions%rowtype;
  v_cur public.subscription_addons%rowtype;
  v_found boolean;
  v_was_active boolean;
  v_slug text;
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 or char_length(v_reason) > 200 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  select * into v_addon from public.addons ad where ad.code = p_addon;
  if not found then
    raise exception 'invalid_addon' using errcode = '22023';
  end if;
  if p_extra_packs is null or p_extra_packs < 0 or p_extra_packs > 50 then
    raise exception 'invalid_packs' using errcode = '22023';
  end if;
  if p_ends_at is not null and (p_ends_at <= now() or p_ends_at > now() + interval '731 days') then
    raise exception 'invalid_ends_at' using errcode = '22023';
  end if;

  -- El lock de la suscripción serializa los cambios de plan, de pagos y de add-ons de la organización.
  select * into v_sub from public.subscriptions s where s.organization_id = p_org for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0002';
  end if;
  if not (v_sub.plan_code = any (v_addon.allowed_plans)) then
    raise exception 'addon_not_allowed' using errcode = '55000';
  end if;

  select * into v_cur
  from public.subscription_addons a
  where a.organization_id = p_org and a.addon_code = p_addon
  for update;
  v_found := found;
  v_was_active := v_found and (v_cur.ends_at is null or v_cur.ends_at > now());

  if v_was_active and v_cur.extra_packs = p_extra_packs and v_cur.ends_at is not distinct from p_ends_at then
    raise exception 'addon_unchanged' using errcode = '55000';
  end if;

  select o.slug into v_slug from public.organizations o where o.id = p_org;
  select u.email into v_actor_email from auth.users u where u.id = p_actor;

  if v_found then
    update public.subscription_addons
    set extra_packs = p_extra_packs, ends_at = p_ends_at
    where id = v_cur.id;
  else
    insert into public.subscription_addons (organization_id, addon_code, extra_packs, ends_at)
    values (p_org, p_addon, p_extra_packs, p_ends_at);
  end if;

  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_actor,
    coalesce(v_actor_email, '(sin email)'),
    case when v_was_active then 'addon.changed' else 'addon.activated' end,
    p_org,
    case
      when v_found then jsonb_build_object('active', v_was_active, 'extra_packs', v_cur.extra_packs, 'ends_at', v_cur.ends_at)
      else jsonb_build_object('active', false)
    end,
    jsonb_build_object(
      'slug', v_slug,
      'addon', p_addon,
      'extra_packs', p_extra_packs,
      'ends_at', p_ends_at,
      'model_quota', v_addon.base_model_quota + p_extra_packs * v_addon.pack_size,
      'reason', v_reason
    )
  );
end;
$$;
comment on function public.admin_set_addon(uuid, uuid, text, integer, timestamptz, text) is
  'Activa un add-on o cambia sus packs extra y su fecha de fin, con motivo y auditoría. Solo service_role; vuelve a comprobar que p_actor es SuperAdmin.';

-- Finalizar un add-on vigente: queda `ends_at = now()` y se conservan los packs (reactivarlo es otra llamada a admin_set_addon).
create function public.admin_end_addon(
  p_actor uuid,
  p_org uuid,
  p_addon text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_reason text;
  v_sub public.subscriptions%rowtype;
  v_cur public.subscription_addons%rowtype;
  v_slug text;
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 or char_length(v_reason) > 200 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if not exists (select 1 from public.addons ad where ad.code = p_addon) then
    raise exception 'invalid_addon' using errcode = '22023';
  end if;

  select * into v_sub from public.subscriptions s where s.organization_id = p_org for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0002';
  end if;

  select * into v_cur
  from public.subscription_addons a
  where a.organization_id = p_org and a.addon_code = p_addon
  for update;
  if not found or (v_cur.ends_at is not null and v_cur.ends_at <= now()) then
    raise exception 'addon_not_active' using errcode = '55000';
  end if;

  select o.slug into v_slug from public.organizations o where o.id = p_org;
  select u.email into v_actor_email from auth.users u where u.id = p_actor;

  update public.subscription_addons set ends_at = now() where id = v_cur.id;

  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_actor,
    coalesce(v_actor_email, '(sin email)'),
    'addon.ended',
    p_org,
    jsonb_build_object('active', true, 'extra_packs', v_cur.extra_packs, 'ends_at', v_cur.ends_at),
    jsonb_build_object('slug', v_slug, 'addon', p_addon, 'extra_packs', v_cur.extra_packs, 'ends_at', now(), 'reason', v_reason)
  );
end;
$$;
comment on function public.admin_end_addon(uuid, uuid, text, text) is
  'Finaliza un add-on vigente de una organización, con motivo y auditoría. Solo service_role; vuelve a comprobar que p_actor es SuperAdmin.';

-- Dar de baja (p_active = false) o reactivar (true) una organización. No borra ni toca la suscripción, los pagos ni la carta.
create function public.admin_set_organization_active(
  p_actor uuid,
  p_org uuid,
  p_active boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_reason text;
  v_org public.organizations%rowtype;
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 or char_length(v_reason) > 200 or p_active is null then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  -- NO KEY UPDATE: cambia una columna que no es clave, así que no frena las altas de filas hijas (claves foráneas).
  select * into v_org from public.organizations o where o.id = p_org for no key update;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  if p_active and v_org.is_active then
    raise exception 'already_active' using errcode = '55000';
  end if;
  if not p_active and not v_org.is_active then
    raise exception 'already_inactive' using errcode = '55000';
  end if;

  select u.email into v_actor_email from auth.users u where u.id = p_actor;

  update public.organizations set is_active = p_active where id = v_org.id;

  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_actor,
    coalesce(v_actor_email, '(sin email)'),
    case when p_active then 'organization.reactivated' else 'organization.deactivated' end,
    p_org,
    jsonb_build_object('active', v_org.is_active),
    jsonb_build_object('slug', v_org.slug, 'active', p_active, 'reason', v_reason)
  );
end;
$$;
comment on function public.admin_set_organization_active(uuid, uuid, boolean, text) is
  'Da de baja o reactiva una organización (is_active), con motivo y auditoría; no borra nada. Solo service_role; vuelve a comprobar que p_actor es SuperAdmin.';

-- ---------------------------------------------------------------------------
-- El Dueño ve los add-ons y la reactivación en su historial (lista blanca, ADR 0021)
-- ---------------------------------------------------------------------------
-- Sin motivo, sin autor, sin ids. La baja y la reactivación van sin detalle (como la suspensión): el Dueño solo ve que pasó.

create or replace function public.owner_account_history(
  p_org uuid,
  p_limit integer default 25,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  created_at timestamptz,
  action text,
  detail jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_org is null or not private.is_org_owner(p_org) then
    return;
  end if;

  return query
  select
    a.id,
    a.created_at,
    a.action,
    jsonb_strip_nulls(
      case a.action
        when 'organization.created' then jsonb_build_object(
          'plan', a.after -> 'plan',
          'billing_cycle', a.after -> 'billing_cycle',
          'period_end', a.after -> 'period_end')
        when 'subscription.plan_changed' then jsonb_build_object(
          'from_plan', a.before -> 'plan',
          'from_billing_cycle', a.before -> 'billing_cycle',
          'plan', a.after -> 'plan',
          'billing_cycle', a.after -> 'billing_cycle')
        when 'subscription.reactivated' then jsonb_build_object('state', a.after -> 'state')
        when 'payment.registered' then jsonb_build_object(
          'plan', a.after -> 'plan',
          'billing_cycle', a.after -> 'billing_cycle',
          'amount_cents', a.after -> 'amount_cents',
          'currency', a.after -> 'currency',
          'method', a.after -> 'method',
          'paid_on', a.after -> 'paid_on',
          'previous_period_end', a.before -> 'period_end',
          'period_end', a.after -> 'period_end')
        -- Sin motivo, sin autor, sin ids: solo el pago anulado y a qué fecha volvió el vencimiento.
        when 'payment.voided' then jsonb_build_object(
          'plan', a.after -> 'plan',
          'billing_cycle', a.after -> 'billing_cycle',
          'amount_cents', a.after -> 'amount_cents',
          'currency', a.after -> 'currency',
          'method', a.after -> 'method',
          'paid_on', a.after -> 'paid_on',
          'previous_period_end', a.before -> 'period_end',
          'period_end', a.after -> 'period_end')
        when 'owner.added' then jsonb_build_object('promoted', coalesce(a.after -> 'promoted', 'false'::jsonb))
        -- Add-ons: cuál, cuántos packs extra y hasta cuándo. Sin motivo ni autor.
        when 'addon.activated' then jsonb_build_object(
          'addon', a.after -> 'addon',
          'extra_packs', a.after -> 'extra_packs',
          'ends_at', a.after -> 'ends_at')
        when 'addon.changed' then jsonb_build_object(
          'addon', a.after -> 'addon',
          'extra_packs', a.after -> 'extra_packs',
          'ends_at', a.after -> 'ends_at')
        when 'addon.ended' then jsonb_build_object(
          'addon', a.after -> 'addon',
          'ends_at', a.after -> 'ends_at')
        else '{}'::jsonb -- 'subscription.suspended', 'organization.deactivated', 'organization.reactivated': sin detalle (el motivo es interno)
      end
    )
  from public.audit_log a
  where a.organization_id = p_org
    and a.action in (
      'organization.created',
      'subscription.plan_changed',
      'subscription.suspended',
      'subscription.reactivated',
      'payment.registered',
      'payment.voided',
      'owner.added',
      'organization.reactivated',
      'addon.activated',
      'addon.changed',
      'addon.ended'
    )
    and (
      p_before is null
      or a.created_at < p_before
      or (p_before_id is not null and a.created_at = p_before and a.id < p_before_id)
    )
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
-- PUBLIC recibe EXECUTE por defecto: se parte de cero. Las acciones solo las ejecuta service_role (el servidor).
-- (`is_org_member`, `is_org_owner`, `org_state` y `owner_account_history` se reemplazaron con `create or replace`:
-- conservan los permisos de antes.)

revoke all on function
  public.admin_set_addon(uuid, uuid, text, integer, timestamptz, text),
  public.admin_end_addon(uuid, uuid, text, text),
  public.admin_set_organization_active(uuid, uuid, boolean, text)
from public, anon, authenticated, service_role;

grant execute on function public.admin_set_addon(uuid, uuid, text, integer, timestamptz, text) to service_role;
grant execute on function public.admin_end_addon(uuid, uuid, text, text) to service_role;
grant execute on function public.admin_set_organization_active(uuid, uuid, boolean, text) to service_role;
