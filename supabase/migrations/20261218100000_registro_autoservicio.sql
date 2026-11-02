-- Registro autoservicio de dueños y plan elegido al pagar (nivel C).
-- Ficha: agile/cambios/registro-autoservicio.md · ADR 0053 (y 0007, 0032, 0052).
--
-- Qué agrega:
--  * `organizations.origin`: 'admin' (alta por el SuperAdmin) o 'self_service' (alta propia).
--  * `trial_claims`: hash del email que ya usó la prueba. Sobrevive al borrado de la cuenta y del local. Sin acceso por la API.
--  * `self_register_organization`: la única puerta del alta propia. Solo service_role; vuelve a exigir un email confirmado.
--  * `purge_unconfirmed_accounts`: borra por lotes las cuentas sin confirmar de más de 7 días. Solo service_role.
--  * `admin_list_orphan_accounts` deja afuera las cuentas sin confirmar: esas las limpia la purga.
--  * Cobro: el Dueño elige plan y ciclo si no tiene un período pago vigente. `payment_intents` guarda el plan de origen y
--    `system_register_mp_payment` cambia el plan en la misma transacción que registra el pago.
--
-- Rollback (en UNA transacción; requiere que no haya intenciones pendientes con cambio de plan):
--   begin;
--   drop function public.purge_unconfirmed_accounts(interval, integer);
--   drop trigger auth_users_drop_password_on_confirmation on auth.users;
--   drop function private.drop_password_on_email_confirmation();
--   drop trigger auth_users_mark_created_in_transaction on auth.users;
--   drop function private.mark_user_created_in_transaction();
--   drop function public.self_register_organization(uuid, text, text, text, text, text);
--   drop function private.normalized_email_hash(text);
--   drop table public.trial_claims;
--   alter table public.organizations drop column origin;
--   drop function public.system_start_payment_intent(uuid, uuid, text, text);
--   y volver a crear con 20261217100000 `private.payment_quote`, `public.owner_payment_quote`,
--   `public.system_start_payment_intent(uuid, uuid)` y `public.system_register_mp_payment`; con 20261117100000,
--   `public.admin_list_orphan_accounts`; drop de `private.payment_quote_for`, `private.plan_fit_problem` y `private.lock_plan_limits`.
--   `payment_intents.from_*` se pueden quitar; los checks de `audit_log` y `payment_reviews` se restauran solo si no hay filas con los
--   valores nuevos.
--   commit;
--
-- Errores (mensaje = nombre estable que lee el servidor):
--   42501 email_not_confirmed · 22023 invalid_terms / slug_reserved / invalid_choice ·
--   55000 already_owner / trial_already_used / signups_throttled / paid_period_active / over_plan_limit ·
--   23505 (índice único del slug).

begin;

-- ---------------------------------------------------------------------------
-- Origen del local
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column origin text not null default 'admin' check (origin in ('admin', 'self_service'));
comment on column public.organizations.origin is
  'Cómo nació el local: alta por el SuperAdmin o alta propia (ADR 0053). Lo escribe solo self_register_organization.';

-- ---------------------------------------------------------------------------
-- Auditoría y revisión de pagos: valores nuevos
-- ---------------------------------------------------------------------------

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in (
    'organization.created',
    'organization.self_registered',
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

alter table public.payment_reviews drop constraint payment_reviews_reason_check;
alter table public.payment_reviews add constraint payment_reviews_reason_check
  check (reason in (
    'amount_mismatch', 'currency_mismatch', 'plan_changed', 'intent_already_paid', 'already_covered', 'payment_reversed', 'over_plan_limit'
  ));

-- ---------------------------------------------------------------------------
-- Una prueba por persona
-- ---------------------------------------------------------------------------

create table public.trial_claims (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  claimed_at timestamptz not null default clock_timestamp(),
  terms_version text not null check (char_length(terms_version) between 1 and 40)
);
comment on table public.trial_claims is
  'Hash del email normalizado que ya usó la prueba, con la versión de los términos aceptados (ADR 0053). Sin claves foráneas: sobrevive al borrado de la cuenta y del local. Sin acceso por la API.';
alter table public.trial_claims enable row level security;
revoke all on table public.trial_claims from public, anon, authenticated, service_role;

-- Minúsculas, sin `+etiqueta` y, en Gmail, sin puntos y con un solo dominio: variantes del mismo buzón dan el mismo hash.
create function private.normalized_email_hash(p_email text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_local text := split_part(v_email, '@', 1);
  v_domain text := split_part(v_email, '@', 2);
begin
  v_local := split_part(v_local, '+', 1);
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;
  return encode(pg_catalog.sha256(convert_to(v_local || '@' || v_domain, 'UTF8')), 'hex');
end;
$$;

-- ---------------------------------------------------------------------------
-- Una contraseña cargada antes de confirmar el email no sobrevive a la confirmación
-- ---------------------------------------------------------------------------
-- Con el registro abierto, cualquiera puede crear por la API de Auth una cuenta sin confirmar con un email ajeno y una contraseña propia.
-- Si la persona dueña del correo confirma, esa contraseña seguiría valiendo. Se borra en la MISMA escritura que confirma: no hay ningún
-- instante con el email confirmado y esa contraseña viva, y antes de confirmar Auth no deja entrar con ella (ADR 0053, decisión 1).
-- Auth crea las cuentas del servidor (`email_confirm: true`) en dos pasos dentro de una transacción, insertar y confirmar: esas conservan su
-- contraseña. Se marca de forma explícita cuál nació en esta transacción, con un valor local que vence al confirmarla; cualquier otra cuenta
-- la pierde, salvo que la misma escritura traiga una contraseña nueva. Sin la marca se borra: falla cerrado.

create function private.mark_user_created_in_transaction()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('ucomenu.user_created_in_transaction', new.id::text, true);
  return new;
end;
$$;

create trigger auth_users_mark_created_in_transaction
  before insert on auth.users
  for each row execute function private.mark_user_created_in_transaction();

create function private.drop_password_on_email_confirmation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null
     and new.encrypted_password is not distinct from old.encrypted_password
     and coalesce(pg_catalog.current_setting('ucomenu.user_created_in_transaction', true), '') <> old.id::text then
    new.encrypted_password := null;
  end if;
  return new;
end;
$$;

create trigger auth_users_drop_password_on_confirmation
  before update of email_confirmed_at on auth.users
  for each row execute function private.drop_password_on_email_confirmation();

-- ---------------------------------------------------------------------------
-- Alta propia
-- ---------------------------------------------------------------------------

create function public.self_register_organization(
  p_user uuid,
  p_slug text,
  p_name text,
  p_branch_slug text,
  p_branch_name text,
  p_terms_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_hash text;
  v_org_id uuid;
begin
  -- La confirmación se lee de Auth: ni el formulario ni el JWT deciden.
  select u.email into v_email
  from auth.users u
  where u.id = p_user and u.email_confirmed_at is not null and u.deleted_at is null and u.banned_until is null;
  if v_email is null then
    raise exception 'email_not_confirmed' using errcode = '42501';
  end if;

  if p_terms_version is null or char_length(p_terms_version) not between 1 and 40 then
    raise exception 'invalid_terms' using errcode = '22023';
  end if;
  if lower(coalesce(p_slug, '')) in ('admin', 'api', 'ayuda', 'demo', 'soporte', 'ucomenu', 'uconext', 'www') then
    raise exception 'slug_reserved' using errcode = '22023';
  end if;

  -- Las altas propias van de a una: así no se cuela nadie por encima del tope de abajo, y dos pedidos del mismo buzón se ordenan.
  -- Duran milisegundos y el tope las limita a 30 por hora: la fila no molesta.
  v_hash := private.normalized_email_hash(v_email);
  perform pg_advisory_xact_lock(hashtextextended('self_register', 0));

  if exists (select 1 from public.memberships m where m.user_id = p_user and m.role = 'owner') then
    raise exception 'already_owner' using errcode = '55000';
  end if;
  if exists (select 1 from public.trial_claims c where c.email_hash = v_hash) then
    raise exception 'trial_already_used' using errcode = '55000';
  end if;
  -- Cortacircuitos ante una ola de altas: el tope es global y se sube con una migración.
  if (
    select count(*) from public.organizations o
    where o.origin = 'self_service' and o.created_at > now() - interval '1 hour'
  ) >= 30 then
    raise exception 'signups_throttled' using errcode = '55000';
  end if;

  insert into public.trial_claims (email_hash, terms_version) values (v_hash, p_terms_version);

  insert into public.organizations (slug, name, origin)
  values (p_slug, p_name, 'self_service')
  returning id into v_org_id;

  -- La suscripción de prueba (14 días) ya la creó el trigger de organizations; la portada promete Pro.
  update public.subscriptions set plan_code = 'pro' where organization_id = v_org_id;
  if not found then
    raise exception 'subscription_missing' using errcode = 'XX000';
  end if;

  insert into public.memberships (user_id, organization_id, role) values (p_user, v_org_id, 'owner');

  insert into public.branches (organization_id, slug, name) values (v_org_id, p_branch_slug, p_branch_name);

  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_user,
    v_email,
    'organization.self_registered',
    v_org_id,
    null,
    jsonb_build_object(
      'slug', p_slug,
      'name', p_name,
      'plan', 'pro',
      'owner_user_id', p_user,
      'terms_version', p_terms_version,
      'branch', jsonb_build_object('slug', p_branch_slug, 'name', p_branch_name)
    )
  );

  return v_org_id;
end;
$$;
comment on function public.self_register_organization(uuid, text, text, text, text, text) is
  'Alta propia de un local (ADR 0053): email confirmado, una prueba por persona, Pro por 14 días. Solo service_role.';

-- ---------------------------------------------------------------------------
-- Purga de cuentas sin confirmar
-- ---------------------------------------------------------------------------

create function public.purge_unconfirmed_accounts(
  p_older_than interval default interval '7 days',
  p_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_older_than is null or p_older_than < interval '1 day' then
    raise exception 'invalid_retention' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;

  with candidates as (
    select u.id
    from auth.users u
    where u.email_confirmed_at is null
      and u.created_at < clock_timestamp() - p_older_than
      and not exists (select 1 from public.memberships m where m.user_id = u.id)
      and not exists (select 1 from public.platform_admins a where a.user_id = u.id)
      and not exists (select 1 from private.account_leases l where l.user_id = u.id and l.expires_at > clock_timestamp())
    order by u.created_at
    limit p_limit
    for update of u skip locked
  )
  delete from auth.users u using candidates c where u.id = c.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
comment on function public.purge_unconfirmed_accounts(interval, integer) is
  'Borra por lotes las cuentas que nunca confirmaron su email (ADR 0053). Nunca una con membresía, de SuperAdmin o con reserva vigente. Solo service_role.';

-- Las cuentas sin confirmar no se listan para borrar a mano: las limpia la purga y ocuparían el tope de 100.
create or replace function public.admin_list_orphan_accounts(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', o.id, 'email', o.email, 'created_at', o.created_at, 'last_sign_in_at', o.last_sign_in_at
    ) order by o.created_at desc)
    from (
      select u.id, u.email, u.created_at, u.last_sign_in_at
      from auth.users u
      where u.email_confirmed_at is not null
        and not exists (select 1 from public.memberships m where m.user_id = u.id)
        and not exists (select 1 from public.platform_admins a where a.user_id = u.id)
        and not exists (select 1 from private.account_leases l where l.user_id = u.id and l.expires_at > clock_timestamp())
        and u.created_at < clock_timestamp() - interval '1 hour'
      order by u.created_at desc
      limit 100
    ) o
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cobro: ¿el local entra en ese plan?
-- ---------------------------------------------------------------------------
-- Devuelve qué lo impide (`extra_branches`, `branches`, `tables`, `products`) o null. Un tope nulo es «sin límite». No cuenta las
-- sucursales adicionales como cupo si el plan elegido no las admite: esas se finalizan antes.

create function private.plan_fit_problem(p_org uuid, p_plan text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan public.plans%rowtype;
  v_extra integer := private.org_extra_branches(p_org);
begin
  select * into v_plan from public.plans p where p.code = p_plan;
  if not found then
    return 'plan';
  end if;
  if v_extra > 0 and not exists (
    select 1 from public.addons ad where ad.code = 'extra_branch' and p_plan = any (ad.allowed_plans)
  ) then
    return 'extra_branches';
  end if;
  if v_plan.max_branches is not null and (
    select count(*) from public.branches b where b.organization_id = p_org and b.is_active
  ) > v_plan.max_branches + v_extra then
    return 'branches';
  end if;
  if v_plan.max_tables_per_branch is not null and exists (
    select 1
    from public.tables t
    join public.branches b on b.id = t.branch_id and b.is_active
    where t.organization_id = p_org and t.is_active
    group by t.branch_id
    having count(*) > v_plan.max_tables_per_branch
  ) then
    return 'tables';
  end if;
  if v_plan.max_active_products is not null and (
    select count(*) from public.products p where p.organization_id = p_org and p.is_active
  ) > v_plan.max_active_products then
    return 'products';
  end if;
  return null;
end;
$$;

-- Los mismos candados que toman los triggers de límites. Quien va a cambiar de plan los toma ANTES de contar: un alta en curso termina y
-- se cuenta, y una posterior espera y ya lee el plan nuevo. El orden es fijo (sucursales, mesas por sucursal, platos) y esos triggers no
-- bloquean la suscripción, así que no hay ciclo con el candado de la suscripción que ya tiene quien llama.
create function private.lock_plan_limits(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('limit:branches:' || p_org::text, 0));
  for v_branch in select b.id from public.branches b where b.organization_id = p_org order by b.id loop
    perform pg_advisory_xact_lock(hashtextextended('limit:tables:' || v_branch::text, 0));
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('limit:active_products:' || p_org::text, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- Cobro: cuánto hay que pagar por un plan y un ciclo
-- ---------------------------------------------------------------------------
-- Generaliza `private.payment_quote`: sin elección cotiza la suscripción tal como está. Con elección, solo si no hay un período pago
-- vigente: durante la prueba o con el período vencido se puede elegir, y con uno vigente se renueva el mismo plan y ciclo.

create function private.payment_quote_for(p_org uuid, p_plan text, p_cycle text)
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
  v_target_plan text;
  v_target_cycle text;
  v_changing boolean;
  v_problem text;
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

  v_target_plan := coalesce(p_plan, v_sub.plan_code);
  v_target_cycle := coalesce(p_cycle, v_sub.billing_cycle);
  v_changing := v_target_plan <> v_sub.plan_code or v_target_cycle <> v_sub.billing_cycle;

  select * into v_plan from public.plans p where p.code = v_target_plan;
  if not found then
    return jsonb_build_object('available', false, 'reason', 'no_list_price');
  end if;

  v_cycle := case when v_target_cycle = 'yearly' then interval '1 year' else interval '1 month' end;
  v_prev := greatest(v_sub.current_period_end, v_sub.trial_ends_at);
  v_extra := private.org_extra_branches(p_org);
  v_plan_cents := case when v_target_cycle = 'yearly' then v_plan.yearly_price_cents else v_plan.monthly_price_cents end;

  v_base := jsonb_build_object(
    'plan_code', v_target_plan,
    'billing_cycle', v_target_cycle,
    'from_plan_code', v_sub.plan_code,
    'from_billing_cycle', v_sub.billing_cycle,
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
  if v_changing then
    if v_sub.current_period_end is not null and v_sub.current_period_end > now() then
      return v_base || jsonb_build_object('available', false, 'reason', 'paid_period_active');
    end if;
    v_problem := private.plan_fit_problem(p_org, v_target_plan);
    if v_problem is not null then
      return v_base || jsonb_build_object('available', false, 'reason', 'over_plan_limit', 'limit', v_problem);
    end if;
  end if;
  if v_extra > 0 then
    select * into v_ad from public.addons ad where ad.code = 'extra_branch' and ad.grants_limit = 'branches';
    if not found then
      return v_base || jsonb_build_object('available', false, 'reason', 'price_unavailable');
    end if;
    v_unit := case when v_target_cycle = 'yearly' then v_ad.yearly_price_cents else v_ad.price_cents end;
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

create or replace function private.payment_quote(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.payment_quote_for(p_org, null, null);
$$;

-- Suma `options`: cada plan con precio de lista y cada ciclo, con su importe o el motivo por el que no se puede elegir.
create or replace function public.owner_payment_quote(p_org uuid)
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
  v_options jsonb;
begin
  if not private.is_org_owner(p_org) then
    return null;
  end if;
  v_quote := private.payment_quote(p_org);
  -- Intenciones sin pagar de los últimos 30 días, aunque su link ya haya vencido: un aviso perdido se recupera con «Ya pagué,
  -- verificar» mientras el pedido siga a la vista. Cota: 20 (ver system_start_payment_intent).
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'expires_at', u.expires_at) order by u.created_at desc), '[]'::jsonb)
  into v_unpaid
  from (
    select i.id, i.expires_at, i.created_at
    from public.payment_intents i
    where i.organization_id = p_org and i.status in ('pending', 'expired') and i.created_at > now() - interval '30 days'
    order by i.created_at desc
    limit 20
  ) u;
  v_quote := v_quote || jsonb_build_object('unpaid_intents', v_unpaid);

  select coalesce(jsonb_agg(jsonb_build_object(
    'plan_code', o.quote ->> 'plan_code',
    'billing_cycle', o.quote ->> 'billing_cycle',
    'available', (o.quote ->> 'available')::boolean,
    'reason', o.quote ->> 'reason',
    'limit', o.quote ->> 'limit',
    'amount_cents', (o.quote ->> 'amount_cents')::bigint,
    'currency', o.quote ->> 'currency'
  ) order by o.monthly, o.cycle_order), '[]'::jsonb)
  into v_options
  from (
    select private.payment_quote_for(p_org, p.code, c.cycle) as quote, p.monthly_price_cents as monthly, c.cycle_order
    from public.plans p
    cross join (values ('monthly', 1), ('yearly', 2)) as c (cycle, cycle_order)
    where p.monthly_price_cents is not null
  ) o;
  v_quote := v_quote || jsonb_build_object('options', v_options);

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

-- ---------------------------------------------------------------------------
-- Cobro: pedir el link con el plan elegido
-- ---------------------------------------------------------------------------

alter table public.payment_intents
  add column from_plan_code text,
  add column from_billing_cycle text check (from_billing_cycle is null or from_billing_cycle in ('monthly', 'yearly')),
  add constraint payment_intents_from_together_check check ((from_plan_code is null) = (from_billing_cycle is null));
comment on column public.payment_intents.from_plan_code is
  'Plan de la suscripción al pedir el link (ADR 0053). Si cambió antes del pago, el pago va a revisar. Nulo en intenciones anteriores: no cambian de plan.';

drop function public.system_start_payment_intent(uuid, uuid);

create function public.system_start_payment_intent(p_org uuid, p_user uuid, p_plan text default null, p_cycle text default null)
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
  if p_cycle is not null and p_cycle not in ('monthly', 'yearly') then
    raise exception 'invalid_choice' using errcode = '22023';
  end if;

  select * into v_sub from public.subscriptions s where s.organization_id = p_org for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0002';
  end if;

  update public.payment_intents set status = 'expired'
  where subscription_id = v_sub.id and status = 'pending' and expires_at <= now();

  v_quote := private.payment_quote_for(p_org, p_plan, p_cycle);
  if not (v_quote ->> 'available')::boolean then
    raise exception '%', v_quote ->> 'reason' using errcode = '55000';
  end if;

  select * into v_intent from public.payment_intents i where i.subscription_id = v_sub.id and i.status = 'pending' for update;
  if found and (
       v_intent.amount_cents <> (v_quote ->> 'amount_cents')::bigint
    or v_intent.plan_code <> v_quote ->> 'plan_code'
    or v_intent.billing_cycle <> v_quote ->> 'billing_cycle'
    or v_intent.extra_branches <> (v_quote ->> 'extra_branches')::integer
    or v_intent.from_plan_code is distinct from v_quote ->> 'from_plan_code'
    or v_intent.from_billing_cycle is distinct from v_quote ->> 'from_billing_cycle'
  ) then
    update public.payment_intents set status = 'expired' where id = v_intent.id;
    v_intent := null;
  end if;

  if v_intent.id is null then
    -- Cota de la recuperación: «Ya pagué, verificar» consulta hasta 20 pedidos sin pagar de los últimos 30 días. Para que ninguno quede
    -- fuera, no se crea el 21.º: falla cerrado y el Dueño contacta a UcoMenú.
    if (
      select count(*) from public.payment_intents i
      where i.organization_id = p_org and i.status in ('pending', 'expired') and i.created_at > now() - interval '30 days'
    ) >= 20 then
      raise exception 'too_many_unpaid' using errcode = '55000';
    end if;
    insert into public.payment_intents (
      organization_id, subscription_id, plan_code, billing_cycle, from_plan_code, from_billing_cycle, extra_branches, amount_cents,
      currency, expires_at, created_by
    )
    values (
      p_org, v_sub.id, v_quote ->> 'plan_code', v_quote ->> 'billing_cycle', v_quote ->> 'from_plan_code', v_quote ->> 'from_billing_cycle',
      (v_quote ->> 'extra_branches')::integer, (v_quote ->> 'amount_cents')::bigint, v_quote ->> 'currency', now() + interval '72 hours', p_user
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

-- ---------------------------------------------------------------------------
-- Cobro: registrar el pago y, si se eligió otro plan, cambiarlo en la misma transacción
-- ---------------------------------------------------------------------------

create or replace function public.system_register_mp_payment(
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
  v_changing boolean;
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
  v_cycle := case when v_intent.billing_cycle = 'yearly' then interval '1 year' else interval '1 month' end;
  v_changing := v_sub.plan_code <> v_intent.plan_code or v_sub.billing_cycle <> v_intent.billing_cycle;
  if v_changing then
    perform private.lock_plan_limits(v_intent.organization_id);
  end if;

  v_reason := case
    when v_intent.status = 'paid' then 'intent_already_paid'
    when p_currency <> v_intent.currency then 'currency_mismatch'
    when p_amount_cents <> v_intent.amount_cents then 'amount_mismatch'
    -- La suscripción tiene que seguir como estaba al pedir el link. Una intención anterior a esta migración no trae origen: su plan es el de origen.
    when v_sub.plan_code <> coalesce(v_intent.from_plan_code, v_intent.plan_code)
      or v_sub.billing_cycle <> coalesce(v_intent.from_billing_cycle, v_intent.billing_cycle) then 'plan_changed'
    -- Un link viejo no cambia de plan si mientras tanto se pagó un período (misma regla que la elección).
    when v_changing and v_sub.current_period_end is not null and v_sub.current_period_end > now() then 'plan_changed'
    when v_changing and private.plan_fit_problem(v_intent.organization_id, v_intent.plan_code) is not null then 'over_plan_limit'
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
    v_intent.organization_id, v_sub.id, v_intent.plan_code, v_intent.billing_cycle, p_amount_cents, p_currency, 'payment_link',
    'MP ' || p_provider_payment_id, v_paid_on, v_prev, v_covers, c_system, 'mercadopago', p_provider_payment_id
  )
  returning id into v_id;

  update public.subscriptions
  set current_period_end = v_covers, plan_code = v_intent.plan_code, billing_cycle = v_intent.billing_cycle
  where id = v_sub.id;
  update public.payment_intents
  set status = 'paid', paid_at = now(), provider_payment_id = p_provider_payment_id
  where id = v_intent.id;

  select o.slug into v_slug from public.organizations o where o.id = v_intent.organization_id;

  if v_changing then
    insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
    values (
      c_system,
      'Mercado Pago (automático)',
      'subscription.plan_changed',
      v_intent.organization_id,
      jsonb_build_object('plan', v_sub.plan_code, 'billing_cycle', v_sub.billing_cycle),
      jsonb_build_object('slug', v_slug, 'plan', v_intent.plan_code, 'billing_cycle', v_intent.billing_cycle, 'reason', 'Elegido por el Dueño al pagar')
    );
  end if;

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
      'plan', v_intent.plan_code,
      'billing_cycle', v_intent.billing_cycle,
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

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
-- PUBLIC recibe EXECUTE por defecto: se parte de cero. `create or replace` conserva los permisos de las funciones que ya existían.

revoke all on function
  private.normalized_email_hash(text),
  private.mark_user_created_in_transaction(),
  private.drop_password_on_email_confirmation(),
  private.plan_fit_problem(uuid, text),
  private.lock_plan_limits(uuid),
  private.payment_quote_for(uuid, text, text),
  public.self_register_organization(uuid, text, text, text, text, text),
  public.purge_unconfirmed_accounts(interval, integer),
  public.system_start_payment_intent(uuid, uuid, text, text)
from public, anon, authenticated, service_role;

grant execute on function public.self_register_organization(uuid, text, text, text, text, text) to service_role;
grant execute on function public.purge_unconfirmed_accounts(interval, integer) to service_role;
grant execute on function public.system_start_payment_intent(uuid, uuid, text, text) to service_role;

commit;
