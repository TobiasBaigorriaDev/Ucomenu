-- Sucursal adicional para el plan Pro (nivel C): add-on de cupo que vende el SuperAdmin.
-- Ficha: agile/cambios/sucursal-adicional.md · ADR 0039 (decisiones) · ADR 0025 (forma de las acciones de SuperAdmin).
--
-- Qué hace:
--  * `addons` gana el límite que concede (`grants_limit`: `branches` o nulo), `quota_per_pack`, `max_packs`, `price_cents` y
--    `currency`. Entra la fila `extra_branch` (1 sucursal por pack, hasta 3, ARS 12.000/mes, solo Pro). Las columnas de WebAR
--    (`base_model_quota`, `pack_size`, `*_usd_cents`) dejan de usarse pero se conservan (aditiva); la fila lleva ceros.
--  * `private.org_extra_branches(org)` cuenta las sucursales adicionales VIGENTES sobre un plan que las admite, y
--    `private.org_limit('branches')` las suma al tope del plan. El trigger `enforce_branch_limit` y su advisory lock no cambian:
--    se serializa con la baja del add-on tomando ese mismo lock.
--  * `admin_set_extra_branches(actor, org, cantidad 0–3, sucursales_a_desactivar, motivo)`: UNA función que solo ejecuta
--    service_role (recomprueba al actor, bloquea la suscripción, escribe `audit_log` en la misma transacción). Al bajar de N a M
--    exige desactivar exactamente `max(0, min((N − M) × cupo, activas − tope_nuevo))` sucursales que el SuperAdmin elige; nunca
--    se desactiva sola ni se borra nada.
--  * `admin_change_plan` conoce el add-on: a un plan sin tope de sucursales (Premium) lo finaliza en la misma transacción; a uno
--    con tope que no lo admite (Básico) responde `extra_branches_must_end` y no cambia nada.
--  * `admin_set_addon` / `admin_end_addon` (genéricas, ADR 0025) se niegan a tocar un add-on que concede un límite
--    (`addon_has_own_action`): por ellas se saltearían la selección de sucursales.
--  * `org_entitlements` suma, SOLO para el Dueño, la cantidad adicional vigente, su precio y el máximo vendible.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos, en UNA transacción: finalizar los contratos de
-- `extra_branch` (`update subscription_addons set ends_at = now()`), volver a crear `private.org_limit`,
-- `public.org_entitlements`, `admin_change_plan`, `admin_set_addon` y `admin_end_addon` con las definiciones de
-- 20261110100000_catalogo_video_feed.sql / 20261111100000_videos_del_feed.sql / 20261017100000_superadmin_planes_pagos_suspension.sql /
-- 20261030100000_addons_y_baja_de_organizaciones.sql, `drop function public.admin_set_extra_branches(uuid, uuid, integer, uuid[], text)`
-- y `private.org_extra_branches(uuid)`, borrar las filas de `subscription_addons` y `addons` de `extra_branch` y quitar las
-- columnas nuevas. Las sucursales ya desactivadas se reactivan a mano si hay cupo.

begin;

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

alter table public.addons
  add column grants_limit text check (grants_limit in ('branches')),
  add column quota_per_pack integer check (quota_per_pack > 0),
  add column max_packs integer check (max_packs > 0),
  add column price_cents integer check (price_cents >= 0),
  add column currency text check (currency in ('ARS', 'USD'));

alter table public.addons add constraint addons_grant_complete_check
  check (grants_limit is null or (quota_per_pack is not null and max_packs is not null and price_cents is not null and currency is not null));

comment on column public.addons.grants_limit is
  'Límite del plan que amplía el add-on (hoy solo `branches`); nulo = no concede cupo. Lo escribe solo una migración.';
comment on column public.addons.quota_per_pack is 'Cuánto suma cada pack al límite que concede.';
comment on column public.addons.max_packs is 'Máximo de packs que se pueden contratar.';
comment on column public.addons.price_cents is 'Precio mensual por pack, en centavos de `currency`.';
comment on table public.addons is
  'Add-ons contratables sobre un plan. Hoy: `extra_branch` (sucursal adicional, ADR 0039). Lo escribe solo una migración.';

insert into public.addons
  (code, name, monthly_price_usd_cents, base_model_quota, pack_size, pack_monthly_price_usd_cents, allowed_plans,
   grants_limit, quota_per_pack, max_packs, price_cents, currency)
values
  ('extra_branch', 'Sucursal adicional', 0, 0, 1, 0, array['pro'], 'branches', 1, 3, 1200000, 'ARS');

-- ---------------------------------------------------------------------------
-- Cupo: sucursales adicionales vigentes y tope efectivo
-- ---------------------------------------------------------------------------

-- Vigente = sin fin o con fin posterior al instante REAL (`clock_timestamp()`, no `now()`): un alta que esperó el lock mientras
-- otra transacción finalizaba el add-on tiene un `now()` anterior al `ends_at` y lo vería todavía vigente.
-- `least(…, max_packs)`: defensa en profundidad por si una fila trae más packs que el máximo vendible.
create function private.org_extra_branches(org_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(least(sa.extra_packs, ad.max_packs) * ad.quota_per_pack), 0)::integer
  from public.subscription_addons sa
  join public.addons ad on ad.code = sa.addon_code and ad.grants_limit = 'branches'
  join public.subscriptions s on s.organization_id = sa.organization_id
  where sa.organization_id = org_id
    and s.plan_code = any (ad.allowed_plans)
    and (sa.ends_at is null or sa.ends_at > clock_timestamp());
$$;

create or replace function private.org_limit(org_id uuid, resource text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan public.plans%rowtype;
begin
  select p.* into v_plan
  from public.subscriptions s
  join public.plans p on p.code = s.plan_code
  where s.organization_id = org_id;

  if not found then
    return 0;
  end if;

  if resource = 'branches' then
    -- Sin tope (Premium) sigue sin tope: el add-on solo amplía un tope que existe.
    if v_plan.max_branches is null then
      return null;
    end if;
    return v_plan.max_branches + private.org_extra_branches(org_id);
  elsif resource = 'tables_per_branch' then
    return v_plan.max_tables_per_branch;
  elsif resource = 'active_products' then
    return v_plan.max_active_products;
  elsif resource = 'videos_published' then
    return v_plan.max_videos_published;
  end if;

  raise exception 'recurso desconocido: %', resource;
end;
$$;

-- ---------------------------------------------------------------------------
-- org_entitlements: el Dueño ve la cantidad adicional vigente, su precio y el máximo vendible
-- ---------------------------------------------------------------------------
-- Mismo contrato que 20261111100000. Las claves nuevas (`extra_branches`, `extra_branch_price_cents`, `extra_branch_currency`,
-- `extra_branch_max`) solo aparecen para el Dueño y solo si su plan admite el add-on. El Staff no recibe ni precio ni cantidad.

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
        from unnest(array['analytics', 'loyalty', 'menu', 'video_feed', 'waiter_call']) as f
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
-- Acción de SuperAdmin: sucursales adicionales
-- ---------------------------------------------------------------------------
-- Errores (mensaje = nombre estable que lee el servidor):
--   42501 not_platform_admin · 22023 invalid_reason / invalid_addon / invalid_packs / branches_selection_invalid ·
--   P0002 subscription_not_found · 55000 addon_not_allowed / addon_unchanged.

create function public.admin_set_extra_branches(
  p_actor uuid,
  p_org uuid,
  p_quantity integer,
  p_deactivate uuid[],
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
  v_ad public.addons%rowtype;
  v_sub public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_cur public.subscription_addons%rowtype;
  v_found boolean;
  v_was_active boolean;
  v_old integer;
  v_new integer;
  v_now timestamptz;
  v_slug text;
  v_active integer;
  v_new_limit integer;
  v_required integer;
  v_selected uuid[];
  v_chosen integer;
  v_deactivated jsonb;
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 or char_length(v_reason) > 200 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  select * into v_ad from public.addons ad where ad.code = 'extra_branch' and ad.grants_limit = 'branches';
  if not found then
    raise exception 'invalid_addon' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > v_ad.max_packs then
    raise exception 'invalid_packs' using errcode = '22023';
  end if;

  -- El lock de la suscripción serializa los cambios de plan, de pagos y de add-ons de la organización.
  select * into v_sub from public.subscriptions s where s.organization_id = p_org for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0002';
  end if;
  select * into v_plan from public.plans p where p.code = v_sub.plan_code;
  if p_quantity > 0 and not (v_sub.plan_code = any (v_ad.allowed_plans)) then
    raise exception 'addon_not_allowed' using errcode = '55000';
  end if;

  select * into v_cur
  from public.subscription_addons a
  where a.organization_id = p_org and a.addon_code = v_ad.code
  for update;
  v_found := found;
  -- Instante REAL, tomado con los locks ya adquiridos (ver admin_set_addon).
  v_now := clock_timestamp();
  v_was_active := v_found and (v_cur.ends_at is null or v_cur.ends_at > v_now);
  v_old := case when v_was_active then least(v_cur.extra_packs, v_ad.max_packs) else 0 end;
  v_new := p_quantity;

  if v_new = v_old then
    raise exception 'addon_unchanged' using errcode = '55000';
  end if;

  -- Mismo lock que el alta y la reactivación de sucursales (`enforce_branch_limit`): un alta que compite con esta baja
  -- entra antes de que se cuente o espera y ve el tope nuevo.
  perform pg_advisory_xact_lock(hashtextextended('limit:branches:' || p_org::text, 0));

  select count(*) into v_active from public.branches b where b.organization_id = p_org and b.is_active;
  v_new_limit := case when v_plan.max_branches is null then null else v_plan.max_branches + v_new * v_ad.quota_per_pack end;
  -- Desactivaciones exigidas: las que sobran por quitar cupo, sin pasarse del exceso real (el exceso heredado de un cambio
  -- de plan no se arrastra). Cero si se agrega cupo o si el tope nuevo todavía alcanza.
  v_required := case
    when v_new_limit is null then 0
    else greatest(0, least((v_old - v_new) * v_ad.quota_per_pack, v_active - v_new_limit))
  end;

  v_selected := coalesce(p_deactivate, '{}'::uuid[]);
  if cardinality(v_selected) <> v_required
     or (select count(distinct u) from unnest(v_selected) as u) <> cardinality(v_selected) then
    raise exception 'branches_selection_invalid' using errcode = '22023';
  end if;

  if v_required > 0 then
    -- Todas de la organización y activas; se bloquean en orden de id para no cruzarse con otra baja.
    select count(*) into v_chosen
    from (
      select b.id
      from public.branches b
      where b.organization_id = p_org and b.is_active and b.id = any (v_selected)
      order by b.id
      for update
    ) locked;
    if v_chosen <> v_required then
      raise exception 'branches_selection_invalid' using errcode = '22023';
    end if;

    update public.branches set is_active = false where organization_id = p_org and id = any (v_selected);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'slug', b.slug) order by b.slug), '[]'::jsonb)
  into v_deactivated
  from public.branches b
  where b.id = any (v_selected);

  if v_found then
    update public.subscription_addons
    set extra_packs = case when v_new = 0 then extra_packs else v_new end,
        ends_at = case when v_new = 0 then v_now else null end
    where id = v_cur.id;
  else
    insert into public.subscription_addons (organization_id, addon_code, extra_packs, ends_at)
    values (p_org, v_ad.code, v_new, null);
  end if;

  select o.slug into v_slug from public.organizations o where o.id = p_org;
  select u.email into v_actor_email from auth.users u where u.id = p_actor;

  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_actor,
    coalesce(v_actor_email, '(sin email)'),
    case when v_new = 0 then 'addon.ended' when v_was_active then 'addon.changed' else 'addon.activated' end,
    p_org,
    jsonb_build_object('active', v_was_active, 'extra_packs', v_old, 'ends_at', case when v_found then v_cur.ends_at else null end),
    jsonb_build_object(
      'slug', v_slug,
      'addon', v_ad.code,
      'extra_packs', case when v_new = 0 then v_old else v_new end,
      'ends_at', case when v_new = 0 then v_now else null end,
      'branches_limit', v_new_limit,
      'deactivated_branches', v_deactivated,
      'reason', v_reason
    )
  );
end;
$$;
comment on function public.admin_set_extra_branches(uuid, uuid, integer, uuid[], text) is
  'Pone la cantidad de sucursales adicionales (0 = finalizar) de una organización Pro; al bajar, desactiva las sucursales elegidas que excedan el tope nuevo. Con motivo y auditoría. Solo service_role; vuelve a comprobar que p_actor es SuperAdmin.';

-- ---------------------------------------------------------------------------
-- admin_change_plan: el add-on de sucursales acompaña al plan (mismo contrato que 20261017100000)
-- ---------------------------------------------------------------------------
-- Errores nuevos: 55000 extra_branches_must_end (el plan nuevo tiene tope y no admite el add-on vigente).

create or replace function public.admin_change_plan(
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
  v_new_plan public.plans%rowtype;
  v_slug text;
  v_now timestamptz;
  v_extra record;
begin
  if p_actor is null or not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 or char_length(v_reason) > 200 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  select * into v_new_plan from public.plans p where p.code = p_plan;
  if not found then
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

  -- Add-ons de sucursales vigentes que el plan nuevo no admite. Instante real tras el lock de la suscripción.
  v_now := clock_timestamp();
  for v_extra in
    select sa.id, sa.extra_packs, sa.ends_at, ad.code as addon_code
    from public.subscription_addons sa
    join public.addons ad on ad.code = sa.addon_code and ad.grants_limit = 'branches'
    where sa.organization_id = p_org
      and not (p_plan = any (ad.allowed_plans))
      and (sa.ends_at is null or sa.ends_at > v_now)
    order by sa.id
    for update of sa
  loop
    -- Un plan con tope (Básico) no puede heredar sucursales que ya no paga: el SuperAdmin las finaliza antes, eligiendo cuáles
    -- se desactivan. Un plan sin tope (Premium) no las necesita: se finaliza acá, sin desactivar nada.
    if v_new_plan.max_branches is not null then
      raise exception 'extra_branches_must_end' using errcode = '55000';
    end if;

    update public.subscription_addons set ends_at = v_now where id = v_extra.id;

    insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
    values (
      p_actor,
      coalesce(v_actor_email, '(sin email)'),
      'addon.ended',
      p_org,
      jsonb_build_object('active', true, 'extra_packs', v_extra.extra_packs, 'ends_at', v_extra.ends_at),
      jsonb_build_object(
        'slug', v_slug,
        'addon', v_extra.addon_code,
        'extra_packs', v_extra.extra_packs,
        'ends_at', v_now,
        'reason', 'Cambio de plan: ' || v_reason
      )
    );
  end loop;

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

-- ---------------------------------------------------------------------------
-- admin_set_addon / admin_end_addon: no tocan un add-on que concede un límite
-- ---------------------------------------------------------------------------
-- Mismas funciones de 20261030100000 con una comprobación más: `addon_has_own_action` (55000). Por ellas se saltearían la
-- selección de sucursales a desactivar.

create or replace function public.admin_set_addon(
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
  v_now timestamptz;
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
  if v_addon.grants_limit is not null then
    raise exception 'addon_has_own_action' using errcode = '55000';
  end if;
  if p_extra_packs is null or p_extra_packs < 0 or p_extra_packs > 50 then
    raise exception 'invalid_packs' using errcode = '22023';
  end if;
  if p_ends_at is not null and (p_ends_at <= now() or p_ends_at > now() + interval '731 days') then
    raise exception 'invalid_ends_at' using errcode = '22023';
  end if;

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
  v_now := clock_timestamp();
  v_was_active := v_found and (v_cur.ends_at is null or v_cur.ends_at > v_now);

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

create or replace function public.admin_end_addon(
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
  v_addon public.addons%rowtype;
  v_sub public.subscriptions%rowtype;
  v_cur public.subscription_addons%rowtype;
  v_now timestamptz;
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
  if v_addon.grants_limit is not null then
    raise exception 'addon_has_own_action' using errcode = '55000';
  end if;

  select * into v_sub from public.subscriptions s where s.organization_id = p_org for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0002';
  end if;

  select * into v_cur
  from public.subscription_addons a
  where a.organization_id = p_org and a.addon_code = p_addon
  for update;
  v_now := clock_timestamp();
  if not found or (v_cur.ends_at is not null and v_cur.ends_at <= v_now) then
    raise exception 'addon_not_active' using errcode = '55000';
  end if;

  select o.slug into v_slug from public.organizations o where o.id = p_org;
  select u.email into v_actor_email from auth.users u where u.id = p_actor;

  update public.subscription_addons set ends_at = v_now where id = v_cur.id;

  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_actor,
    coalesce(v_actor_email, '(sin email)'),
    'addon.ended',
    p_org,
    jsonb_build_object('active', true, 'extra_packs', v_cur.extra_packs, 'ends_at', v_cur.ends_at),
    jsonb_build_object('slug', v_slug, 'addon', p_addon, 'extra_packs', v_cur.extra_packs, 'ends_at', v_now, 'reason', v_reason)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
-- `create or replace` conserva los EXECUTE de org_limit, org_entitlements, admin_change_plan, admin_set_addon y
-- admin_end_addon. Lo nuevo parte de cero: PUBLIC recibe EXECUTE por defecto.

revoke all on function private.org_extra_branches(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_set_extra_branches(uuid, uuid, integer, uuid[], text) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_extra_branches(uuid, uuid, integer, uuid[], text) to service_role;

commit;
