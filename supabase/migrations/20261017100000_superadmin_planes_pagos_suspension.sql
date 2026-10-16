-- SuperAdmin, siguientes incrementos (nivel C): cambiar el plan a mano, suspender y reactivar, registrar pagos y la
-- prueba gratuita como concepto aparte. Ficha: agile/cambios/superadmin-planes-pagos.md · ADR 0013 y 0006.
--
-- Aditiva: una columna, una tabla, tres funciones de API, una función pura, y reemplaza dos funciones existentes
-- (`private.org_state` y `public.org_entitlements`, con `create or replace`: conservan sus permisos) y el `check` de
-- `audit_log.action`. No toca datos ni políticas existentes.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos (se pierden los pagos registrados; la auditoría
-- queda, pero sin esas acciones no se puede volver a poner el `check` viejo mientras existan filas nuevas):
--   drop function public.admin_change_plan(uuid, uuid, text, text, text),
--                 public.admin_set_suspension(uuid, uuid, boolean, text),
--                 public.admin_register_payment(uuid, uuid, bigint, text, text, text, date, timestamptz);
--   drop table public.payments;
--   drop function private.payments_append_only(), private.trial_status(timestamptz, timestamptz, timestamptz);
--   alter table public.subscriptions drop column suspended_at;
--   y volver a crear `private.org_state` y `public.org_entitlements` con las definiciones de
--   20261014003848_plans_and_entitlements.sql.
--
-- Reglas de fondo:
--  * Plan, suspensión y pagos los escribe SOLO una función de API que solo puede ejecutar service_role (el servidor),
--    vuelve a comprobar que `p_actor` es SuperAdmin, toma un lock de la suscripción y escribe `audit_log` en la MISMA
--    transacción. Un Dueño o un Staff no tienen ninguna vía de escritura.
--  * La suspensión manual es un dato aparte de la mora: `suspended_at` no nulo = `suspended`, sin importar las fechas.
--    Reactivar NO regala tiempo: la cuenta vuelve al estado que digan sus fechas.
--  * La prueba gratuita conserva su fecha propia (`trial_ends_at`); su estado se deriva (`private.trial_status`).
--  * `payments` solo se agrega (igual que `audit_log`): ni la API ni service_role ni el dueño de la tabla (trigger) pueden
--    modificarla o borrarla.

-- ---------------------------------------------------------------------------
-- Suspensión manual
-- ---------------------------------------------------------------------------

alter table public.subscriptions add column suspended_at timestamptz;
comment on column public.subscriptions.suspended_at is
  'Suspensión a mano por el SuperAdmin (nula = no suspendida). Mientras no sea nula, el estado es suspended aunque las fechas estén al día.';

-- El estado de la organización: la suspensión manual manda; si no, se deriva de las fechas (ADR 0006).
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
        when s.suspended_at is not null then 'suspended'
        else private.billing_state(greatest(s.current_period_end, s.trial_ends_at), now())
      end
      from public.subscriptions s
      where s.organization_id = org_id
    ),
    'suspended'
  );
$$;

-- ---------------------------------------------------------------------------
-- Prueba gratuita como concepto aparte (estado derivado, igual que la mora)
-- ---------------------------------------------------------------------------
-- none: nunca tuvo prueba (o el alta del SuperAdmin la reemplazó por un plan con fecha) · in_trial: la prueba corre ·
-- expired: la prueba terminó y nadie asignó ni pagó un período · converted: ya tiene un período propio (pago o asignación
-- posterior). El vencimiento de una prueba sigue la regla de mora de ADR 0006 (supuesto vigente): no es otro estado.
create function private.trial_status(trial_ends_at timestamptz, current_period_end timestamptz, at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when trial_ends_at is null then 'none'
    when current_period_end is not null then 'converted'
    when at <= trial_ends_at then 'in_trial'
    else 'expired'
  end;
$$;

-- El Dueño ve además la prueba y si la suspensión es manual; el Staff sigue recibiendo solo el estado.
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
      'branches', (select count(*) from public.branches b where b.organization_id = p_org),
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
  'Estado, escritura permitida, features, límites y uso de la organización. Solo para sus miembros.';

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
    'payment.registered'
  ));

-- ---------------------------------------------------------------------------
-- Pagos (a mano), vinculados a la suscripción
-- ---------------------------------------------------------------------------
-- Un pago es un hecho que no se reescribe: el importe, la fecha y el período que cubre quedan fijos. El plan y el ciclo
-- son una instantánea del momento. `previous_period_end` es el fin efectivo ANTES del pago (para auditar el efecto).
-- Las claves foráneas son RESTRICT a propósito: una organización con pagos no se borra en cascada por accidente; el
-- borrado de organizaciones (aún inexistente) tiene que definir antes la retención de pagos, como con price_history.

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  subscription_id uuid not null references public.subscriptions (id) on delete restrict,
  plan_code text not null,
  billing_cycle text not null check (billing_cycle in ('monthly', 'yearly')),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  currency text not null check (currency in ('ARS', 'USD')),
  method text not null check (method in ('transfer', 'payment_link', 'cash', 'other')),
  reference text check (reference is null or char_length(reference) <= 120),
  -- Día (de Argentina) en que se recibió el dinero.
  paid_on date not null,
  previous_period_end timestamptz not null,
  covers_until timestamptz not null,
  -- Quién lo registró. Sin clave foránea: sobrevive a la baja de la cuenta (el email queda en la auditoría).
  registered_by uuid not null,
  check (covers_until > previous_period_end),
  -- Defensa contra el doble registro: dos pagos de una suscripción no pueden dejarla con el mismo fin.
  unique (subscription_id, covers_until)
);
comment on table public.payments is
  'Pagos registrados a mano por el SuperAdmin. Solo se agrega; los escribe únicamente admin_register_payment, en la misma transacción que el cambio de vigencia y la auditoría.';
comment on column public.payments.reference is
  'Número de operación o referencia, sin datos personales. No se puede corregir después: la tabla no se modifica.';

create index payments_organization_idx on public.payments (organization_id, created_at desc);

alter table public.payments enable row level security;

-- Solo los SuperAdmin leen (el Dueño no ve pagos todavía: queda para cuando se defina esa pantalla).
create policy "payments: lectura de SuperAdmin"
  on public.payments for select
  to authenticated
  using (private.is_platform_admin());

revoke all on table public.payments from anon, authenticated;
grant select on table public.payments to authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.payments from service_role;

create function private.payments_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'payments es de solo agregado (% rechazado)', tg_op
    using errcode = '42501';
end;
$$;

create trigger payments_no_update_delete
  before update or delete on public.payments
  for each row execute function private.payments_append_only();

create trigger payments_no_truncate
  before truncate on public.payments
  for each statement execute function private.payments_append_only();

-- ---------------------------------------------------------------------------
-- Acciones de SuperAdmin (solo service_role; vuelven a comprobar al actor; una transacción con la auditoría)
-- ---------------------------------------------------------------------------
-- Errores (mensaje = nombre estable que lee el servidor):
--   42501 not_platform_admin · 22023 invalid_reason / invalid_plan / invalid_cycle / invalid_amount / invalid_currency /
--   invalid_method / invalid_reference / invalid_paid_on / invalid_period · P0002 subscription_not_found ·
--   55000 plan_unchanged / already_suspended / not_suspended / payment_not_extending.

-- Cambiar plan y ciclo. No toca fechas (sin prorrateo) ni borra nada: bajar de plan conserva los datos y solo bloquea crear más.
create function public.admin_change_plan(
  p_actor uuid,
  p_org uuid,
  p_plan text,
  p_billing_cycle text,
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
  v_slug text;
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 or char_length(v_reason) > 200 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if not exists (select 1 from public.plans p where p.code = p_plan) then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;
  if p_billing_cycle is null or p_billing_cycle not in ('monthly', 'yearly') then
    raise exception 'invalid_cycle' using errcode = '22023';
  end if;

  select * into v_sub from public.subscriptions s where s.organization_id = p_org for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0002';
  end if;
  if v_sub.plan_code = p_plan and v_sub.billing_cycle = p_billing_cycle then
    raise exception 'plan_unchanged' using errcode = '55000';
  end if;

  select o.slug into v_slug from public.organizations o where o.id = p_org;
  select u.email into v_actor_email from auth.users u where u.id = p_actor;

  update public.subscriptions
  set plan_code = p_plan, billing_cycle = p_billing_cycle
  where id = v_sub.id;

  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_actor,
    coalesce(v_actor_email, '(sin email)'),
    'subscription.plan_changed',
    p_org,
    jsonb_build_object('plan', v_sub.plan_code, 'billing_cycle', v_sub.billing_cycle),
    jsonb_build_object('slug', v_slug, 'plan', p_plan, 'billing_cycle', p_billing_cycle, 'reason', v_reason)
  );
end;
$$;
comment on function public.admin_change_plan(uuid, uuid, text, text, text) is
  'Cambia el plan y el ciclo de una organización a mano, con motivo y auditoría. Solo service_role; vuelve a comprobar que p_actor es SuperAdmin.';

-- Suspender (p_suspend = true) o reactivar (false). Reactivar no extiende fechas: vuelve al estado que digan las fechas.
create function public.admin_set_suspension(
  p_actor uuid,
  p_org uuid,
  p_suspend boolean,
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
  v_slug text;
  v_state text;
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 or char_length(v_reason) > 200 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if p_suspend is null then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  select * into v_sub from public.subscriptions s where s.organization_id = p_org for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0002';
  end if;
  if p_suspend and v_sub.suspended_at is not null then
    raise exception 'already_suspended' using errcode = '55000';
  end if;
  if not p_suspend and v_sub.suspended_at is null then
    raise exception 'not_suspended' using errcode = '55000';
  end if;

  select o.slug into v_slug from public.organizations o where o.id = p_org;
  select u.email into v_actor_email from auth.users u where u.id = p_actor;

  update public.subscriptions
  set suspended_at = case when p_suspend then now() else null end
  where id = v_sub.id;

  -- Estado resultante (con la suspensión ya aplicada): al reactivar muestra si la mora la mantiene suspendida.
  v_state := private.org_state(p_org);

  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_actor,
    coalesce(v_actor_email, '(sin email)'),
    case when p_suspend then 'subscription.suspended' else 'subscription.reactivated' end,
    p_org,
    jsonb_build_object('suspended', v_sub.suspended_at is not null),
    jsonb_build_object('slug', v_slug, 'suspended', p_suspend, 'state', v_state, 'reason', v_reason)
  );
end;
$$;
comment on function public.admin_set_suspension(uuid, uuid, boolean, text) is
  'Suspende o reactiva una organización a mano, con motivo y auditoría. Solo service_role; vuelve a comprobar que p_actor es SuperAdmin.';

-- Registrar un pago: guarda el pago y mueve el fin del período a `p_covers_until`. Nunca acorta ni repite la vigencia:
-- `p_covers_until` tiene que ser posterior al fin efectivo actual y a ahora, y a lo sumo 731 días en el futuro.
-- No levanta una suspensión manual (se reactiva aparte) y conserva trial_ends_at (la prueba queda como historia).
create function public.admin_register_payment(
  p_actor uuid,
  p_org uuid,
  p_amount_cents bigint,
  p_currency text,
  p_method text,
  p_reference text,
  p_paid_on date,
  p_covers_until timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_sub public.subscriptions%rowtype;
  v_slug text;
  v_reference text;
  v_today date;
  v_previous_end timestamptz;
  v_id uuid;
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000000 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_currency is null or p_currency not in ('ARS', 'USD') then
    raise exception 'invalid_currency' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('transfer', 'payment_link', 'cash', 'other') then
    raise exception 'invalid_method' using errcode = '22023';
  end if;
  v_reference := nullif(btrim(coalesce(p_reference, '')), '');
  if v_reference is not null and char_length(v_reference) > 120 then
    raise exception 'invalid_reference' using errcode = '22023';
  end if;
  -- El día de hoy en Argentina; un pago no puede tener fecha futura ni más de un año de antigüedad.
  v_today := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  if p_paid_on is null or p_paid_on > v_today or p_paid_on < v_today - 365 then
    raise exception 'invalid_paid_on' using errcode = '22023';
  end if;
  if p_covers_until is null or p_covers_until > now() + interval '731 days' then
    raise exception 'invalid_period' using errcode = '22023';
  end if;

  select * into v_sub from public.subscriptions s where s.organization_id = p_org for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0002';
  end if;

  v_previous_end := greatest(v_sub.current_period_end, v_sub.trial_ends_at);
  if p_covers_until <= greatest(v_previous_end, now()) then
    raise exception 'payment_not_extending' using errcode = '55000';
  end if;

  select o.slug into v_slug from public.organizations o where o.id = p_org;
  select u.email into v_actor_email from auth.users u where u.id = p_actor;

  insert into public.payments (
    organization_id, subscription_id, plan_code, billing_cycle, amount_cents, currency, method, reference,
    paid_on, previous_period_end, covers_until, registered_by
  )
  values (
    p_org, v_sub.id, v_sub.plan_code, v_sub.billing_cycle, p_amount_cents, p_currency, p_method, v_reference,
    p_paid_on, v_previous_end, p_covers_until, p_actor
  )
  returning id into v_id;

  update public.subscriptions set current_period_end = p_covers_until where id = v_sub.id;

  -- La referencia del pago no se copia: puede traer datos de terceros y la auditoría no se borra.
  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_actor,
    coalesce(v_actor_email, '(sin email)'),
    'payment.registered',
    p_org,
    jsonb_build_object('period_end', v_previous_end),
    jsonb_build_object(
      'slug', v_slug,
      'payment_id', v_id,
      'plan', v_sub.plan_code,
      'billing_cycle', v_sub.billing_cycle,
      'amount_cents', p_amount_cents,
      'currency', p_currency,
      'method', p_method,
      'paid_on', p_paid_on,
      'period_end', p_covers_until
    )
  );

  return v_id;
end;
$$;
comment on function public.admin_register_payment(uuid, uuid, bigint, text, text, text, date, timestamptz) is
  'Registra un pago a mano y extiende la vigencia de la suscripción, con auditoría. Solo service_role; vuelve a comprobar que p_actor es SuperAdmin.';

-- ---------------------------------------------------------------------------
-- Permisos de las funciones nuevas
-- ---------------------------------------------------------------------------
-- PUBLIC recibe EXECUTE por defecto: se parte de cero. Las acciones solo las ejecuta service_role (el servidor).
-- (`org_state` y `org_entitlements` se reemplazaron con `create or replace`: conservan los permisos de antes.)

revoke all on function
  private.trial_status(timestamptz, timestamptz, timestamptz),
  private.payments_append_only(),
  public.admin_change_plan(uuid, uuid, text, text, text),
  public.admin_set_suspension(uuid, uuid, boolean, text),
  public.admin_register_payment(uuid, uuid, bigint, text, text, text, date, timestamptz)
from public, anon, authenticated;

grant execute on function public.admin_change_plan(uuid, uuid, text, text, text) to service_role;
grant execute on function public.admin_set_suspension(uuid, uuid, boolean, text) to service_role;
grant execute on function public.admin_register_payment(uuid, uuid, bigint, text, text, text, date, timestamptz) to service_role;
