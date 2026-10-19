-- SuperAdmin anula un pago mal cargado (nivel C). Ficha: agile/cambios/anular-pagos.md · ADR 0024 (y 0012, 0013, 0021).
--
-- Un pago no se edita ni se borra: se anula con un asiento nuevo (`payment_voids`) que lo referencia, con motivo, y la
-- vigencia de la suscripción vuelve a lo que era antes de ese pago. Todo en una sola función de API que solo ejecuta
-- service_role, recomprueba al actor, toma el lock de la suscripción y escribe la auditoría en la misma transacción.
--
-- Aditiva salvo tres cosas: (1) quita el `unique (subscription_id, covers_until)` de `payments` (corregir un importe o un
-- medio exige volver a registrar con la MISMA fecha de cobertura; la regla «extiende» más el lock ya impiden el duplicado),
-- (2) amplía el `check` de `audit_log.action`, (3) recrea `owner_payments` (suma `voided_at`) y reemplaza
-- `owner_account_history` (suma `payment.voided` a su lista blanca).
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos (se pierden las anulaciones: la vigencia NO se
-- restaura sola a la de después del pago, hay que reponerla a mano; la auditoría queda y, mientras existan filas
-- 'payment.voided', no se puede volver a poner el `check` viejo):
--   drop function public.admin_void_payment(uuid, uuid, uuid, text);
--   drop table public.payment_voids;
--   drop function private.payment_voids_append_only();
--   alter table public.payments add constraint payments_subscription_id_covers_until_key unique (subscription_id, covers_until);
--   y volver a crear `owner_payments` y `owner_account_history` con las definiciones de
--   20261026100000_dueno_lee_pagos_y_auditoria.sql.
--
-- Reglas de fondo:
--  * Solo se anula el pago que DEFINE la vigencia actual (`current_period_end = covers_until`): para corregir uno anterior
--    se anulan de atrás hacia adelante. Así lo que se restaura es exactamente `previous_period_end` de ese pago.
--  * Si el pago anulado era el primero y su `previous_period_end` es el fin de la prueba, `current_period_end` vuelve a
--    null: la prueba recupera su estado (in_trial / expired en vez de converted) y conserva `trial_ends_at`.
--  * Control de coherencia: si quedan otros pagos vigentes, el mayor `covers_until` tiene que ser `previous_period_end`;
--    si no (historia tocada a mano), la función se niega y no adivina.
--  * No toca el plan, el ciclo ni la suspensión manual. Puede dejar la cuenta vencida en el acto: es la consecuencia
--    correcta de quitar tiempo que no se pagó.
--  * `payment_voids` solo se agrega (triggers y privilegios), igual que `payments` y `audit_log`.

-- ---------------------------------------------------------------------------
-- payments: se puede volver a registrar con la misma fecha de cobertura
-- ---------------------------------------------------------------------------

alter table public.payments drop constraint payments_subscription_id_covers_until_key;

-- ---------------------------------------------------------------------------
-- Auditoría: acción nueva
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
    'owner.added'
  ));

-- ---------------------------------------------------------------------------
-- Anulaciones de pagos (solo se agregan)
-- ---------------------------------------------------------------------------
-- Una fila por pago anulado. `period_end_before` / `period_end_after` son el fin efectivo de la vigencia antes y después
-- (para auditar el efecto). Claves foráneas RESTRICT, como `payments`: el borrado de organizaciones (aún inexistente) tiene
-- que definir antes la retención.

create table public.payment_voids (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  payment_id uuid not null unique references public.payments (id) on delete restrict,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  subscription_id uuid not null references public.subscriptions (id) on delete restrict,
  reason text not null check (char_length(reason) between 1 and 200),
  -- Quién la registró. Sin clave foránea: sobrevive a la baja de la cuenta (el email queda en la auditoría).
  voided_by uuid not null,
  period_end_before timestamptz not null,
  period_end_after timestamptz not null
);
comment on table public.payment_voids is
  'Anulaciones de pagos (asiento compensatorio). Solo se agrega; la escribe únicamente admin_void_payment, en la misma transacción que el cambio de vigencia y la auditoría.';
comment on column public.payment_voids.reason is
  'Motivo escrito por el SuperAdmin. Interno: no se muestra al Dueño.';

create index payment_voids_organization_idx on public.payment_voids (organization_id, created_at desc);

alter table public.payment_voids enable row level security;

create policy "payment_voids: lectura de SuperAdmin"
  on public.payment_voids for select
  to authenticated
  using (private.is_platform_admin());

revoke all on table public.payment_voids from anon, authenticated;
grant select on table public.payment_voids to authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.payment_voids from service_role;

create function private.payment_voids_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'payment_voids es de solo agregado (% rechazado)', tg_op
    using errcode = '42501';
end;
$$;

create trigger payment_voids_no_update_delete
  before update or delete on public.payment_voids
  for each row execute function private.payment_voids_append_only();

create trigger payment_voids_no_truncate
  before truncate on public.payment_voids
  for each statement execute function private.payment_voids_append_only();

-- ---------------------------------------------------------------------------
-- Anular un pago (solo service_role; vuelve a comprobar al actor; una transacción con la auditoría)
-- ---------------------------------------------------------------------------
-- Errores (mensaje = nombre estable que lee el servidor):
--   42501 not_platform_admin · 22023 invalid_reason · P0002 subscription_not_found / payment_not_found ·
--   55000 payment_already_voided / payment_not_latest / payment_history_inconsistent.
create function public.admin_void_payment(
  p_actor uuid,
  p_org uuid,
  p_payment uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_reason text;
  v_sub public.subscriptions%rowtype;
  v_pay public.payments%rowtype;
  v_slug text;
  v_other_max timestamptz;
  v_before_end timestamptz;
  v_new_period timestamptz;
  v_after_end timestamptz;
  v_id uuid;
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 or char_length(v_reason) > 200 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  -- El lock de la suscripción serializa contra otros pagos y otras anulaciones de esta organización.
  select * into v_sub from public.subscriptions s where s.organization_id = p_org for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0002';
  end if;

  select * into v_pay from public.payments p where p.id = p_payment and p.organization_id = p_org;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.payment_voids v where v.payment_id = v_pay.id) then
    raise exception 'payment_already_voided' using errcode = '55000';
  end if;

  -- Solo el pago que define la vigencia actual.
  if v_sub.current_period_end is distinct from v_pay.covers_until then
    raise exception 'payment_not_latest' using errcode = '55000';
  end if;

  -- Coherencia de la historia: lo que queda vigente antes de este pago tiene que ser lo que él registró como «antes».
  select max(p.covers_until) into v_other_max
  from public.payments p
  where p.subscription_id = v_sub.id
    and p.id <> v_pay.id
    and not exists (select 1 from public.payment_voids v where v.payment_id = p.id);
  if v_other_max is not null and v_other_max is distinct from v_pay.previous_period_end then
    raise exception 'payment_history_inconsistent' using errcode = '55000';
  end if;

  v_before_end := greatest(v_sub.current_period_end, v_sub.trial_ends_at);
  -- Si «antes» era el fin de la prueba, no había período propio: vuelve a null (la prueba recupera su estado).
  v_new_period := case
    when v_sub.trial_ends_at is not null and v_pay.previous_period_end <= v_sub.trial_ends_at then null
    else v_pay.previous_period_end
  end;
  v_after_end := greatest(v_new_period, v_sub.trial_ends_at);

  select o.slug into v_slug from public.organizations o where o.id = p_org;
  select u.email into v_actor_email from auth.users u where u.id = p_actor;

  insert into public.payment_voids (payment_id, organization_id, subscription_id, reason, voided_by, period_end_before, period_end_after)
  values (v_pay.id, p_org, v_sub.id, v_reason, p_actor, v_before_end, v_after_end)
  returning id into v_id;

  update public.subscriptions set current_period_end = v_new_period where id = v_sub.id;

  -- Ni la referencia del pago ni datos de terceros: la auditoría no se borra.
  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_actor,
    coalesce(v_actor_email, '(sin email)'),
    'payment.voided',
    p_org,
    jsonb_build_object('period_end', v_before_end),
    jsonb_build_object(
      'slug', v_slug,
      'payment_id', v_pay.id,
      'void_id', v_id,
      'plan', v_pay.plan_code,
      'billing_cycle', v_pay.billing_cycle,
      'amount_cents', v_pay.amount_cents,
      'currency', v_pay.currency,
      'method', v_pay.method,
      'paid_on', v_pay.paid_on,
      'covers_until', v_pay.covers_until,
      'period_end', v_after_end,
      'reason', v_reason
    )
  );

  return v_id;
end;
$$;
comment on function public.admin_void_payment(uuid, uuid, uuid, text) is
  'Anula el último pago vigente de una organización (asiento compensatorio) y restaura la vigencia, con motivo y auditoría. Solo service_role; vuelve a comprobar que p_actor es SuperAdmin.';

-- ---------------------------------------------------------------------------
-- Lo que ve el Dueño (ADR 0021): el pago marcado como anulado y el movimiento, sin motivo ni autor
-- ---------------------------------------------------------------------------

drop function public.owner_payments(uuid, integer, timestamptz, uuid);

create function public.owner_payments(
  p_org uuid,
  p_limit integer default 24,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  created_at timestamptz,
  paid_on date,
  plan_code text,
  billing_cycle text,
  amount_cents bigint,
  currency text,
  method text,
  reference text,
  previous_period_end timestamptz,
  covers_until timestamptz,
  voided_at timestamptz
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
  select p.id, p.created_at, p.paid_on, p.plan_code, p.billing_cycle, p.amount_cents, p.currency, p.method, p.reference,
         p.previous_period_end, p.covers_until, v.created_at
  from public.payments p
  left join public.payment_voids v on v.payment_id = p.id
  where p.organization_id = p_org
    and (
      p_before is null
      or p.created_at < p_before
      or (p_before_id is not null and p.created_at = p_before and p.id < p_before_id)
    )
  order by p.created_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 24), 1), 100);
end;
$$;
comment on function public.owner_payments(uuid, integer, timestamptz, uuid) is
  'Pagos de la organización para su Dueño actual (cero filas para cualquier otra identidad). Sin registered_by ni motivo de la anulación (solo cuándo se anuló). Solo lee.';

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
        else '{}'::jsonb -- 'subscription.suspended': sin detalle (el motivo es interno)
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
      'owner.added'
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
-- PUBLIC recibe EXECUTE por defecto: se parte de cero. `owner_account_history` se reemplazó con `create or replace`
-- (conserva los permisos); `owner_payments` se recreó y se vuelven a dar.

revoke all on function
  private.payment_voids_append_only(),
  public.admin_void_payment(uuid, uuid, uuid, text),
  public.owner_payments(uuid, integer, timestamptz, uuid)
from public, anon, authenticated, service_role;

grant execute on function public.admin_void_payment(uuid, uuid, uuid, text) to service_role;
grant execute on function public.owner_payments(uuid, integer, timestamptz, uuid) to authenticated;
