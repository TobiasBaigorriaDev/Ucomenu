-- Cobro de la suscripción con link de Mercado Pago, con registro automático del pago (nivel C).
-- Ficha: agile/cambios/cobro-con-link-de-mercado-pago.md · ADR 0052 (y 0006, 0013, 0024, 0027).
--
-- El Dueño pide un link de pago por período; el servidor lo crea en Mercado Pago, y cuando Mercado Pago avisa (y el servidor
-- vuelve a pedirle el pago a su API) UNA función de base registra el pago y extiende la vigencia. Nada de esto abre una vía de
-- escritura a la API: las funciones `system_*` y `admin_*` solo las ejecuta service_role; la única función que ve el Dueño
-- (`owner_payment_quote`) es de lectura.
--
-- Qué agrega:
--  * `addons.yearly_price_cents`: precio anual de la sucursal adicional (ARS 115.200 = 12.000 × 12 con 20 % menos, como los planes).
--  * `payments.provider` / `provider_payment_id`: el pago de Mercado Pago, con unicidad (un pago de MP extiende UNA vez).
--  * `payment_intents`: el pedido de pago con el importe congelado (el importe sale de la base, nunca del cliente).
--  * `payment_reviews`: pagos aprobados que NO se registraron solos (no cuadran) o que se revirtieron; los resuelve el SuperAdmin.
--  * `payment_reversals`: un reembolso o contracargo que llegó ANTES de que el pago se registrara (dos avisos concurrentes): el
--    registro lo consulta y, si existe, deja el pago a revisar en vez de renovar. Un candado por ID de pago ordena a las dos funciones.
--  * funciones: `private.payment_quote`, `owner_payment_quote`, `system_start_payment_intent`, `system_attach_payment_preference`,
--    `system_register_mp_payment`, `system_flag_mp_reversal`, `admin_resolve_payment_review`.
--  * `audit_log.action` suma `payment_review.resolved`. El pago automático reutiliza `payment.registered` con un actor «sistema»
--    fijo (00000000-0000-4000-8000-00000000a001) y el email «Mercado Pago (automático)».
--
-- Rollback (local o staging; en UNA transacción; los pagos ya registrados NO se tocan: `payments` es de solo agregado):
--   begin;
--   drop function public.admin_resolve_payment_review(uuid, uuid, text);
--   drop function public.system_flag_mp_reversal(text, text);
--   drop function public.system_register_mp_payment(uuid, text, bigint, text, timestamptz);
--   drop function public.system_attach_payment_preference(uuid, text, text);
--   drop function public.system_start_payment_intent(uuid, uuid);
--   drop function public.owner_payment_quote(uuid);
--   drop function private.flag_payment_review(uuid, uuid, text, text, bigint, text);
--   drop function private.payment_quote(uuid);
--   drop table public.payment_reversals;
--   drop table public.payment_reviews;
--   drop table public.payment_intents;
--   alter table public.addons drop column yearly_price_cents;
--   (`payments.provider*` se quedan: la tabla no se modifica y un pago de Mercado Pago ya registrado perdería su identificador.
--    El `check` de `audit_log.action` se puede volver a poner solo si no hay filas 'payment_review.resolved'.)
--   commit;
--
-- Errores (mensaje = nombre estable que lee el servidor):
--   42501 not_owner / not_platform_admin · P0002 subscription_not_found / review_not_found ·
--   55000 organization_inactive / suspended_manually / no_list_price / price_unavailable / already_covered / review_already_resolved ·
--   22023 invalid_amount / invalid_currency / invalid_payment_id / invalid_preference / invalid_status / invalid_note.

begin;

-- ---------------------------------------------------------------------------
-- Precio anual de la sucursal adicional
-- ---------------------------------------------------------------------------

alter table public.addons add column yearly_price_cents integer check (yearly_price_cents >= 0);
comment on column public.addons.yearly_price_cents is
  'Precio anual por pack, en centavos de `currency` (nulo = no se vende por año). Lo escribe solo una migración.';

-- ARS 12.000 por mes → 115.200 por año (12 meses con 20 % menos, el mismo descuento de los planes).
update public.addons set yearly_price_cents = 11520000 where code = 'extra_branch';

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
    'owner.added',
    'organization.deactivated',
    'organization.reactivated',
    'addon.activated',
    'addon.changed',
    'addon.ended',
    'payments.purged',
    'organization.deleted',
    'account.deleted',
    'feature_preview.started',
    'feature_preview.changed',
    'feature_preview.ended',
    'payment_review.resolved'
  ));

-- ---------------------------------------------------------------------------
-- payments: el pago de un proveedor, con unicidad
-- ---------------------------------------------------------------------------
-- `payments` sigue siendo de solo agregado (los triggers son de UPDATE/DELETE/TRUNCATE: agregar columnas no los toca).

alter table public.payments
  add column provider text check (provider in ('mercadopago')),
  add column provider_payment_id text check (provider_payment_id is null or provider_payment_id ~ '^[0-9]{1,20}$'),
  add constraint payments_provider_together_check check ((provider is null) = (provider_payment_id is null));
comment on column public.payments.provider_payment_id is
  'ID del pago en el proveedor (Mercado Pago). Único por proveedor: un pago del proveedor extiende la vigencia una sola vez.';

create unique index payments_provider_payment_key on public.payments (provider, provider_payment_id) where provider is not null;

-- ---------------------------------------------------------------------------
-- Intenciones de pago (el importe congelado)
-- ---------------------------------------------------------------------------
-- Una por pedido de link. `id` viaja a Mercado Pago como `external_reference`. Una sola pendiente por suscripción. Sin acceso por
-- la API ni por service_role directo: todo pasa por las funciones de abajo. Se borran con la organización (el pago, si hubo,
-- sobrevive en `payments`, ADR 0027).

create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  plan_code text not null,
  billing_cycle text not null check (billing_cycle in ('monthly', 'yearly')),
  extra_branches integer not null check (extra_branches >= 0),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  currency text not null check (currency in ('ARS', 'USD')),
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired')),
  expires_at timestamptz not null,
  -- El link de Mercado Pago (se completa después de crear la preferencia).
  mp_preference_id text check (mp_preference_id is null or char_length(mp_preference_id) <= 100),
  checkout_url text check (checkout_url is null or char_length(checkout_url) <= 500),
  created_by uuid not null,
  paid_at timestamptz,
  provider_payment_id text check (provider_payment_id is null or provider_payment_id ~ '^[0-9]{1,20}$'),
  check ((status = 'paid') = (paid_at is not null))
);
comment on table public.payment_intents is
  'Pedidos de link de pago (ADR 0052). El importe sale de la base y queda congelado. Sin acceso por la API: solo las funciones system_* / owner_payment_quote.';

create unique index payment_intents_one_pending_key on public.payment_intents (subscription_id) where status = 'pending';
create index payment_intents_organization_idx on public.payment_intents (organization_id, created_at desc);

alter table public.payment_intents enable row level security;
revoke all on table public.payment_intents from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Pagos a revisar
-- ---------------------------------------------------------------------------
-- Un pago aprobado que no se registró solo (no cuadra con la intención) o que se revirtió después. NO extiende nada. Una fila por
-- pago y motivo. Sin claves foráneas hacia la organización: sobrevive a su borrado como `payments`.

create table public.payment_reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  organization_id uuid not null,
  intent_id uuid,
  provider_payment_id text not null check (provider_payment_id ~ '^[0-9]{1,20}$'),
  reason text not null check (reason in (
    'amount_mismatch', 'currency_mismatch', 'plan_changed', 'intent_already_paid', 'already_covered', 'payment_reversed'
  )),
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null check (currency in ('ARS', 'USD')),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text check (resolution_note is null or char_length(resolution_note) between 1 and 200),
  unique (provider_payment_id, reason),
  check ((resolved_at is null) = (resolved_by is null))
);
comment on table public.payment_reviews is
  'Pagos de Mercado Pago que requieren a una persona (ADR 0052). Los escriben las funciones system_*; los resuelve admin_resolve_payment_review.';

create index payment_reviews_open_idx on public.payment_reviews (created_at desc) where resolved_at is null;
create index payment_reviews_organization_idx on public.payment_reviews (organization_id, created_at desc);

alter table public.payment_reviews enable row level security;
create policy "payment_reviews: lectura de SuperAdmin"
  on public.payment_reviews for select
  to authenticated
  using (private.is_platform_admin());
revoke all on table public.payment_reviews from public, anon, authenticated, service_role;
grant select on table public.payment_reviews to authenticated;

-- ---------------------------------------------------------------------------
-- Reversiones recibidas antes de registrar el pago
-- ---------------------------------------------------------------------------
-- Dos avisos del mismo pago pueden procesarse a la vez: uno lo lee aprobado y todavía no lo registró cuando el otro lo lee ya
-- reembolsado. La reversión se guarda acá (por ID de pago) y `system_register_mp_payment` la consulta bajo el mismo candado.

create table public.payment_reversals (
  provider_payment_id text primary key check (provider_payment_id ~ '^[0-9]{1,20}$'),
  status text not null check (status in ('refunded', 'charged_back')),
  created_at timestamptz not null default clock_timestamp()
);
comment on table public.payment_reversals is
  'Reembolsos y contracargos vistos por ID de pago (ADR 0052). Los escribe system_flag_mp_reversal y los lee system_register_mp_payment; sin acceso por la API.';
alter table public.payment_reversals enable row level security;
revoke all on table public.payment_reversals from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cuánto hay que pagar (la única cuenta del importe)
-- ---------------------------------------------------------------------------
-- Plan y ciclo de la suscripción + sucursales adicionales vigentes × su precio del MISMO ciclo, todo de la base. No bloquea
-- (las funciones que la usan para escribir ya tienen el lock de la suscripción). Devuelve siempre un jsonb con `available`;
-- si no hay con qué cobrar, `reason` dice por qué. No devuelve nada personal.

create function private.payment_quote(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations%rowtype;
  v_sub public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_ad public.addons%rowtype;
  v_prev timestamptz;
  v_cycle interval;
  v_plan_cents bigint;
  v_extra integer;
  v_unit bigint := 0;
  v_base jsonb;
begin
  select * into v_org from public.organizations o where o.id = p_org;
  if not found or not v_org.is_active then
    return jsonb_build_object('available', false, 'reason', 'organization_inactive');
  end if;
  select * into v_sub from public.subscriptions s where s.organization_id = p_org;
  if not found then
    return jsonb_build_object('available', false, 'reason', 'subscription_not_found');
  end if;
  select * into v_plan from public.plans p where p.code = v_sub.plan_code;

  v_cycle := case when v_sub.billing_cycle = 'yearly' then interval '1 year' else interval '1 month' end;
  v_prev := greatest(v_sub.current_period_end, v_sub.trial_ends_at);
  v_extra := private.org_extra_branches(p_org);
  v_plan_cents := case when v_sub.billing_cycle = 'yearly' then v_plan.yearly_price_cents else v_plan.monthly_price_cents end;

  v_base := jsonb_build_object(
    'plan_code', v_sub.plan_code,
    'billing_cycle', v_sub.billing_cycle,
    'extra_branches', v_extra,
    'currency', v_plan.price_currency,
    'period_end', v_prev
  );

  if v_sub.suspended_at is not null then
    return v_base || jsonb_build_object('available', false, 'reason', 'suspended_manually');
  end if;
  if v_plan_cents is null then
    return v_base || jsonb_build_object('available', false, 'reason', 'no_list_price');
  end if;
  if v_extra > 0 then
    select * into v_ad from public.addons ad where ad.code = 'extra_branch' and ad.grants_limit = 'branches';
    if not found then
      return v_base || jsonb_build_object('available', false, 'reason', 'price_unavailable');
    end if;
    v_unit := case when v_sub.billing_cycle = 'yearly' then v_ad.yearly_price_cents else v_ad.price_cents end;
    if v_unit is null or v_ad.currency <> v_plan.price_currency then
      return v_base || jsonb_build_object('available', false, 'reason', 'price_unavailable');
    end if;
  end if;
  -- Más de un ciclo ya pagado por delante: no se ofrece pagar otro (evita el doble pago).
  if v_prev > now() + v_cycle then
    return v_base || jsonb_build_object('available', false, 'reason', 'already_covered');
  end if;

  return v_base || jsonb_build_object(
    'available', true,
    'plan_price_cents', v_plan_cents,
    'extra_branch_unit_cents', v_unit,
    'amount_cents', v_plan_cents + v_extra * v_unit
  );
end;
$$;

-- El Dueño ve lo que va a pagar y si hay un link pendiente. Solo lectura; otro rol (Staff, otra organización, anon) recibe null.
create function public.owner_payment_quote(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_quote jsonb;
  v_intent public.payment_intents%rowtype;
  v_unpaid jsonb;
begin
  if not private.is_org_owner(p_org) then
    return null;
  end if;
  v_quote := private.payment_quote(p_org);
  -- Intenciones sin pagar de los últimos 30 días, aunque su link ya haya vencido: un aviso perdido se recupera con «Ya pagué,
  -- verificar» mientras el pedido siga a la vista (Mercado Pago pudo cobrar justo antes de vencer).
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'expires_at', u.expires_at) order by u.created_at desc), '[]'::jsonb)
  into v_unpaid
  from (
    select i.id, i.expires_at, i.created_at
    from public.payment_intents i
    where i.organization_id = p_org and i.status in ('pending', 'expired') and i.created_at > now() - interval '30 days'
    order by i.created_at desc
    limit 5
  ) u;
  v_quote := v_quote || jsonb_build_object('unpaid_intents', v_unpaid);
  select * into v_intent
  from public.payment_intents i
  where i.organization_id = p_org and i.status = 'pending' and i.expires_at > now()
  limit 1;
  if found then
    v_quote := v_quote || jsonb_build_object(
      'pending_intent', jsonb_build_object('id', v_intent.id, 'expires_at', v_intent.expires_at, 'amount_cents', v_intent.amount_cents)
    );
  end if;
  return v_quote;
end;
$$;
comment on function public.owner_payment_quote(uuid) is
  'Lo que el Dueño pagaría hoy (importe, plan, ciclo, sucursales) y su link pendiente. Solo lectura; null si no es Dueño.';

-- ---------------------------------------------------------------------------
-- Pedir el link: crea (o reutiliza) la intención con el importe congelado
-- ---------------------------------------------------------------------------

create function public.system_start_payment_intent(p_org uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_quote jsonb;
  v_intent public.payment_intents%rowtype;
begin
  if p_org is null or p_user is null
     or not exists (select 1 from public.memberships m where m.organization_id = p_org and m.user_id = p_user and m.role = 'owner') then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  select * into v_sub from public.subscriptions s where s.organization_id = p_org for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0002';
  end if;

  update public.payment_intents set status = 'expired'
  where subscription_id = v_sub.id and status = 'pending' and expires_at <= now();

  v_quote := private.payment_quote(p_org);
  if not (v_quote ->> 'available')::boolean then
    raise exception '%', v_quote ->> 'reason' using errcode = '55000';
  end if;

  select * into v_intent from public.payment_intents i where i.subscription_id = v_sub.id and i.status = 'pending' for update;
  if found and (
       v_intent.amount_cents <> (v_quote ->> 'amount_cents')::bigint
    or v_intent.plan_code <> v_quote ->> 'plan_code'
    or v_intent.billing_cycle <> v_quote ->> 'billing_cycle'
    or v_intent.extra_branches <> (v_quote ->> 'extra_branches')::integer
  ) then
    update public.payment_intents set status = 'expired' where id = v_intent.id;
    v_intent := null;
  end if;

  if v_intent.id is null then
    insert into public.payment_intents (
      organization_id, subscription_id, plan_code, billing_cycle, extra_branches, amount_cents, currency, expires_at, created_by
    )
    values (
      p_org, v_sub.id, v_quote ->> 'plan_code', v_quote ->> 'billing_cycle', (v_quote ->> 'extra_branches')::integer,
      (v_quote ->> 'amount_cents')::bigint, v_quote ->> 'currency', now() + interval '72 hours', p_user
    )
    returning * into v_intent;
  end if;

  return jsonb_build_object(
    'intent_id', v_intent.id,
    'amount_cents', v_intent.amount_cents,
    'currency', v_intent.currency,
    'plan_code', v_intent.plan_code,
    'billing_cycle', v_intent.billing_cycle,
    'extra_branches', v_intent.extra_branches,
    'expires_at', v_intent.expires_at,
    'preference_id', v_intent.mp_preference_id,
    'checkout_url', v_intent.checkout_url
  );
end;
$$;

-- Guarda el link que devolvió Mercado Pago. Solo si la intención sigue pendiente y todavía no tiene uno (dos pedidos a la vez: gana el primero).
create function public.system_attach_payment_preference(p_intent uuid, p_preference_id text, p_checkout_url text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_preference_id is null or char_length(p_preference_id) not between 1 and 100
     or p_checkout_url is null or char_length(p_checkout_url) not between 1 and 500 then
    raise exception 'invalid_preference' using errcode = '22023';
  end if;
  update public.payment_intents
  set mp_preference_id = p_preference_id, checkout_url = p_checkout_url
  where id = p_intent and status = 'pending' and mp_preference_id is null;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Un pago aprobado en Mercado Pago (el servidor ya lo verificó contra la API)
-- ---------------------------------------------------------------------------
-- Devuelve {result, reason?, covers_until?}: `registered` · `already_registered` · `review` (no extiende; queda a revisar) ·
-- `unknown_intent` (no es de esta aplicación o ya se borró con la organización). Es idempotente por `p_provider_payment_id`.
-- La vigencia la calcula la base: desde el fin vigente o desde ahora (lo que sea mayor) más un ciclo, hasta el cierre del día de
-- Argentina. No levanta la suspensión manual (`suspended_at`): reactivar no regala tiempo.

create function private.flag_payment_review(
  p_org uuid, p_intent uuid, p_payment_id text, p_reason text, p_amount bigint, p_currency text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.payment_reviews (organization_id, intent_id, provider_payment_id, reason, amount_cents, currency)
  values (p_org, p_intent, p_payment_id, p_reason, p_amount, p_currency)
  on conflict (provider_payment_id, reason) do nothing;
$$;

create function public.system_register_mp_payment(
  p_intent uuid,
  p_provider_payment_id text,
  p_amount_cents bigint,
  p_currency text,
  p_paid_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_system constant uuid := '00000000-0000-4000-8000-00000000a001';
  c_tz constant text := 'America/Argentina/Buenos_Aires';
  v_intent public.payment_intents%rowtype;
  v_sub public.subscriptions%rowtype;
  v_slug text;
  v_reason text;
  v_prev timestamptz;
  v_cycle interval;
  v_local timestamp;
  v_covers timestamptz;
  v_paid_on date;
  v_id uuid;
begin
  if p_provider_payment_id is null or p_provider_payment_id !~ '^[0-9]{1,20}$' then
    raise exception 'invalid_payment_id' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000000 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_currency is null or p_currency not in ('ARS', 'USD') then
    raise exception 'invalid_currency' using errcode = '22023';
  end if;

  -- Un candado por ID de pago, tomado ANTES que el de la suscripción (el orden es siempre pago → suscripción → intención): ordena este
  -- registro contra la marca de una reversión del mismo pago (`system_flag_mp_reversal`), así no se pierde ninguna de las dos.
  perform pg_advisory_xact_lock(hashtextextended('mercadopago:' || p_provider_payment_id, 0));

  -- Sin lock de fila todavía: solo para saber qué suscripción bloquear.
  select * into v_intent from public.payment_intents i where i.id = p_intent;
  if not found then
    return jsonb_build_object('result', 'unknown_intent');
  end if;

  select * into v_sub from public.subscriptions s where s.id = v_intent.subscription_id for update;
  if not found then
    return jsonb_build_object('result', 'unknown_intent');
  end if;
  select * into v_intent from public.payment_intents i where i.id = p_intent for update;

  -- Idempotencia: el mismo pago, una sola vez (y uno ya enviado a revisión no se vuelve a evaluar solo).
  if exists (select 1 from public.payments p where p.provider = 'mercadopago' and p.provider_payment_id = p_provider_payment_id) then
    return jsonb_build_object('result', 'already_registered');
  end if;
  if exists (
    select 1 from public.payment_reviews r
    where r.provider_payment_id = p_provider_payment_id and r.reason <> 'payment_reversed'
  ) then
    return jsonb_build_object('result', 'review');
  end if;

  -- Si el pago ya se reembolsó o se revirtió (el aviso de la reversión se procesó antes que este registro), no se renueva nada.
  if exists (select 1 from public.payment_reversals r where r.provider_payment_id = p_provider_payment_id) then
    perform private.flag_payment_review(v_intent.organization_id, v_intent.id, p_provider_payment_id, 'payment_reversed', p_amount_cents, p_currency);
    return jsonb_build_object('result', 'review', 'reason', 'payment_reversed');
  end if;

  v_prev := greatest(v_sub.current_period_end, v_sub.trial_ends_at);
  v_cycle := case when v_sub.billing_cycle = 'yearly' then interval '1 year' else interval '1 month' end;

  v_reason := case
    when v_intent.status = 'paid' then 'intent_already_paid'
    when p_currency <> v_intent.currency then 'currency_mismatch'
    when p_amount_cents <> v_intent.amount_cents then 'amount_mismatch'
    when v_sub.plan_code <> v_intent.plan_code or v_sub.billing_cycle <> v_intent.billing_cycle then 'plan_changed'
    when v_prev > now() + v_cycle then 'already_covered'
    else null
  end;
  if v_reason is not null then
    perform private.flag_payment_review(v_intent.organization_id, v_intent.id, p_provider_payment_id, v_reason, p_amount_cents, p_currency);
    return jsonb_build_object('result', 'review', 'reason', v_reason);
  end if;

  -- Vigencia: desde el fin vigente o desde ahora, un ciclo, hasta el cierre del día de Argentina.
  v_local := (greatest(v_prev, now()) at time zone c_tz) + v_cycle;
  v_covers := (date_trunc('day', v_local) + interval '23 hours 59 minutes 59 seconds') at time zone c_tz;
  v_paid_on := (least(coalesce(p_paid_at, now()), now()) at time zone c_tz)::date;

  insert into public.payments (
    organization_id, subscription_id, plan_code, billing_cycle, amount_cents, currency, method, reference,
    paid_on, previous_period_end, covers_until, registered_by, provider, provider_payment_id
  )
  values (
    v_intent.organization_id, v_sub.id, v_sub.plan_code, v_sub.billing_cycle, p_amount_cents, p_currency, 'payment_link',
    'MP ' || p_provider_payment_id, v_paid_on, v_prev, v_covers, c_system, 'mercadopago', p_provider_payment_id
  )
  returning id into v_id;

  update public.subscriptions set current_period_end = v_covers where id = v_sub.id;
  update public.payment_intents
  set status = 'paid', paid_at = now(), provider_payment_id = p_provider_payment_id
  where id = v_intent.id;

  select o.slug into v_slug from public.organizations o where o.id = v_intent.organization_id;
  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    c_system,
    'Mercado Pago (automático)',
    'payment.registered',
    v_intent.organization_id,
    jsonb_build_object('period_end', v_prev),
    jsonb_build_object(
      'slug', v_slug,
      'payment_id', v_id,
      'plan', v_sub.plan_code,
      'billing_cycle', v_sub.billing_cycle,
      'amount_cents', p_amount_cents,
      'currency', p_currency,
      'method', 'payment_link',
      'provider', 'mercadopago',
      'paid_on', v_paid_on,
      'period_end', v_covers
    )
  );

  return jsonb_build_object('result', 'registered', 'payment_id', v_id, 'covers_until', v_covers);
end;
$$;
comment on function public.system_register_mp_payment(uuid, text, bigint, text, timestamptz) is
  'Registra un pago aprobado de Mercado Pago (ya verificado por el servidor contra la API) y extiende la vigencia. Idempotente; lo que no cuadra va a payment_reviews sin extender. Solo service_role.';

-- Reembolso o contracargo: se guarda siempre por ID de pago. Si el pago ya está registrado queda a revisar (no quita la vigencia: el
-- SuperAdmin lo anula con admin_void_payment) → 'flagged'; si todavía no, el registro lo verá y no renovará → 'recorded'.
create function public.system_flag_mp_reversal(p_provider_payment_id text, p_status text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
begin
  if p_provider_payment_id is null or p_provider_payment_id !~ '^[0-9]{1,20}$' then
    raise exception 'invalid_payment_id' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('refunded', 'charged_back') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  -- Mismo candado que el registro: o este aviso corre primero (y el registro verá la reversión) o corre después (y verá el pago).
  perform pg_advisory_xact_lock(hashtextextended('mercadopago:' || p_provider_payment_id, 0));
  insert into public.payment_reversals (provider_payment_id, status) values (p_provider_payment_id, p_status)
  on conflict (provider_payment_id) do nothing;

  select * into v_payment from public.payments p where p.provider = 'mercadopago' and p.provider_payment_id = p_provider_payment_id;
  if not found then
    return 'recorded';
  end if;
  perform private.flag_payment_review(
    v_payment.organization_id, null, p_provider_payment_id, 'payment_reversed', v_payment.amount_cents, v_payment.currency
  );
  return 'flagged';
end;
$$;

-- ---------------------------------------------------------------------------
-- El SuperAdmin resuelve un pago a revisar
-- ---------------------------------------------------------------------------
-- Es un acuse: la corrección del dinero (registrar a mano, anular, reembolsar en Mercado Pago) la hace con las acciones que ya existen.

create function public.admin_resolve_payment_review(p_actor uuid, p_review uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text;
  v_review public.payment_reviews%rowtype;
  v_actor_email text;
  v_slug text;
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  v_note := btrim(coalesce(p_note, ''));
  if char_length(v_note) < 1 or char_length(v_note) > 200 then
    raise exception 'invalid_note' using errcode = '22023';
  end if;

  select * into v_review from public.payment_reviews r where r.id = p_review for update;
  if not found then
    raise exception 'review_not_found' using errcode = 'P0002';
  end if;
  if v_review.resolved_at is not null then
    raise exception 'review_already_resolved' using errcode = '55000';
  end if;

  update public.payment_reviews
  set resolved_at = now(), resolved_by = p_actor, resolution_note = v_note
  where id = p_review;

  select o.slug into v_slug from public.organizations o where o.id = v_review.organization_id;
  select u.email into v_actor_email from auth.users u where u.id = p_actor;
  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_actor,
    coalesce(v_actor_email, '(sin email)'),
    'payment_review.resolved',
    v_review.organization_id,
    jsonb_build_object('reason', v_review.reason),
    jsonb_build_object('slug', v_slug, 'review_id', p_review, 'reason', v_review.reason, 'provider_payment_id', v_review.provider_payment_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
-- PUBLIC recibe EXECUTE por defecto: se parte de cero. Las acciones solo las ejecuta service_role (el servidor); la lectura del Dueño,
-- authenticated (la función vuelve a comprobar que sea Dueño).

revoke all on function
  private.payment_quote(uuid),
  private.flag_payment_review(uuid, uuid, text, text, bigint, text),
  public.owner_payment_quote(uuid),
  public.system_start_payment_intent(uuid, uuid),
  public.system_attach_payment_preference(uuid, text, text),
  public.system_register_mp_payment(uuid, text, bigint, text, timestamptz),
  public.system_flag_mp_reversal(text, text),
  public.admin_resolve_payment_review(uuid, uuid, text)
from public, anon, authenticated, service_role;

grant execute on function public.owner_payment_quote(uuid) to authenticated;
grant execute on function public.system_start_payment_intent(uuid, uuid) to service_role;
grant execute on function public.system_attach_payment_preference(uuid, text, text) to service_role;
grant execute on function public.system_register_mp_payment(uuid, text, bigint, text, timestamptz) to service_role;
grant execute on function public.system_flag_mp_reversal(text, text) to service_role;
grant execute on function public.admin_resolve_payment_review(uuid, uuid, text) to service_role;

commit;
