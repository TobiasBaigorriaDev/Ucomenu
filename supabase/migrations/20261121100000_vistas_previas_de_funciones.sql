-- Vistas previas de funciones por organización (nivel C): el SuperAdmin habilita una función a un local piloto, con motivo y con fin.
-- Ficha: agile/cambios/vistas-previas-de-funciones.md · ADR 0039 (decisión 5).
--
-- Qué hace:
--  * Tabla `organization_feature_previews` (organización, función, fin, motivo), una fila por par. SOLO la escriben las dos
--    funciones de abajo (ni `service_role` ni la API tienen INSERT/UPDATE/DELETE) y SOLO la lee `service_role`: el Dueño y el
--    Staff no la ven, ni ella ni sus movimientos (no entran en la lista blanca de `owner_account_history`).
--  * `private.plan_grants(org, feature)` = features del plan ∪ vistas previas VIGENTES. La mora sigue mandando: `has_feature`
--    no cambia, así que en solo lectura una vista previa de `orders`, `promotions`, `review_invite` o `customers` no concede nada
--    (esas claves no están entre las que se ven en solo lectura) y suspendida no concede ninguna.
--  * `admin_set_feature_preview(actor, org, función, fin, motivo)` y `admin_end_feature_preview(actor, org, función, motivo)`:
--    solo `service_role`, recomprueban al actor, bloquean la suscripción (se serializan con el cambio de plan y de pagos) y
--    escriben `audit_log` en la misma transacción. Vigencia máxima por vez: 90 días.
--  * `org_entitlements` suma las cuatro claves nuevas a la lista de funciones que informa, para que el panel pueda leerlas.
--
-- Las claves son las del incremento «Salón y crecimiento». Ninguna está en `plans.features` todavía: cada ficha de función
-- agrega la suya al plan que corresponda y a `plans_features_check`, y lee `has_feature`.
--
-- Rollback (local: git revert + `pnpm db:reset`). En una base con datos, en UNA transacción: volver a crear `private.plan_grants`
-- (20261110100000_catalogo_video_feed.sql) y `public.org_entitlements` (20261119100000_sucursal_adicional.sql),
-- `drop function public.admin_set_feature_preview(uuid, uuid, text, timestamptz, text), public.admin_end_feature_preview(uuid, uuid, text, text)`,
-- `drop table public.organization_feature_previews` y volver a aplicar `audit_log_action_check` con la lista de
-- 20261117100000_cuentas_sin_local.sql (falla si ya hay movimientos `feature_preview.*`: habría que conservarlos).

begin;

-- ---------------------------------------------------------------------------
-- Tabla
-- ---------------------------------------------------------------------------

create table public.organization_feature_previews (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  feature text not null
    check (feature in ('orders', 'promotions', 'review_invite', 'customers')),
  ends_at timestamptz not null,
  reason text not null check (char_length(reason) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, feature)
);
comment on table public.organization_feature_previews is
  'Funciones habilitadas a una organización por el SuperAdmin, por tiempo limitado y con motivo (ADR 0039). Vigente si ends_at es futuro. Solo la escriben admin_set_feature_preview y admin_end_feature_preview; solo la lee service_role.';

alter table public.organization_feature_previews enable row level security;
revoke all on table public.organization_feature_previews from anon, authenticated, service_role;
grant select on table public.organization_feature_previews to service_role;

-- ---------------------------------------------------------------------------
-- Auditoría
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
    'feature_preview.ended'
  ));

-- ---------------------------------------------------------------------------
-- Entitlements: plan ∪ vistas previas vigentes
-- ---------------------------------------------------------------------------

-- Vigente = con fin posterior al instante REAL (`clock_timestamp()`, no `now()`), como los add-ons: una operación que esperó
-- un lock no ve todavía vigente lo que otra transacción acaba de finalizar. `$2` es `feature` (el nombre choca con la columna).
create or replace function private.plan_grants(org_id uuid, feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select feature = any (p.features)
      from public.subscriptions s
      join public.plans p on p.code = s.plan_code
      where s.organization_id = org_id
    ),
    false
  )
  or exists (
    select 1
    from public.organization_feature_previews v
    where v.organization_id = org_id
      and v.feature = $2
      and v.ends_at > clock_timestamp()
  );
$$;

-- Mismo contrato que 20261119100000; cambia solo la lista de funciones que informa.
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
        from unnest(array['analytics', 'customers', 'loyalty', 'menu', 'orders', 'promotions', 'review_invite', 'video_feed', 'waiter_call']) as f
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
-- Acciones de SuperAdmin
-- ---------------------------------------------------------------------------
-- Errores (mensaje = nombre estable que lee el servidor):
--   42501 not_platform_admin · 22023 invalid_reason / invalid_feature / invalid_preview_end · P0002 subscription_not_found ·
--   55000 feature_in_plan / preview_unchanged / preview_not_active.

create function public.admin_set_feature_preview(
  p_actor uuid,
  p_org uuid,
  p_feature text,
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
  v_sub public.subscriptions%rowtype;
  v_cur public.organization_feature_previews%rowtype;
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
  if p_feature is null or p_feature not in ('orders', 'promotions', 'review_invite', 'customers') then
    raise exception 'invalid_feature' using errcode = '22023';
  end if;
  if p_ends_at is null then
    raise exception 'invalid_preview_end' using errcode = '22023';
  end if;

  -- El lock de la suscripción serializa los cambios de plan, de pagos, de add-ons y de vistas previas de la organización.
  select * into v_sub from public.subscriptions s where s.organization_id = p_org for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0002';
  end if;

  -- Instante REAL, tomado con el lock ya adquirido. El tope es de 90 días; la base deja 1 de margen por la hora de cada reloj.
  v_now := clock_timestamp();
  if p_ends_at <= v_now or p_ends_at > v_now + interval '91 days' then
    raise exception 'invalid_preview_end' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.plans p where p.code = v_sub.plan_code and p_feature = any (p.features)
  ) then
    raise exception 'feature_in_plan' using errcode = '55000';
  end if;

  select * into v_cur
  from public.organization_feature_previews v
  where v.organization_id = p_org and v.feature = p_feature
  for update;
  v_found := found;
  v_was_active := v_found and v_cur.ends_at > v_now;

  if v_was_active and v_cur.ends_at = p_ends_at then
    raise exception 'preview_unchanged' using errcode = '55000';
  end if;

  if v_found then
    update public.organization_feature_previews
    set ends_at = p_ends_at, reason = v_reason, updated_at = v_now
    where organization_id = p_org and feature = p_feature;
  else
    insert into public.organization_feature_previews (organization_id, feature, ends_at, reason, created_at, updated_at)
    values (p_org, p_feature, p_ends_at, v_reason, v_now, v_now);
  end if;

  select o.slug into v_slug from public.organizations o where o.id = p_org;
  select u.email into v_actor_email from auth.users u where u.id = p_actor;

  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_actor,
    coalesce(v_actor_email, '(sin email)'),
    case when v_was_active then 'feature_preview.changed' else 'feature_preview.started' end,
    p_org,
    jsonb_build_object('active', v_was_active, 'ends_at', case when v_found then v_cur.ends_at else null end),
    jsonb_build_object('slug', v_slug, 'feature', p_feature, 'ends_at', p_ends_at, 'reason', v_reason)
  );
end;
$$;
comment on function public.admin_set_feature_preview(uuid, uuid, text, timestamptz, text) is
  'Habilita (o cambia el fin de) una función a una organización por hasta 90 días, con motivo y auditoría. Solo service_role; vuelve a comprobar que p_actor es SuperAdmin.';

create function public.admin_end_feature_preview(
  p_actor uuid,
  p_org uuid,
  p_feature text,
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
  v_cur public.organization_feature_previews%rowtype;
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
  if p_feature is null or p_feature not in ('orders', 'promotions', 'review_invite', 'customers') then
    raise exception 'invalid_feature' using errcode = '22023';
  end if;

  select * into v_sub from public.subscriptions s where s.organization_id = p_org for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0002';
  end if;

  select * into v_cur
  from public.organization_feature_previews v
  where v.organization_id = p_org and v.feature = p_feature
  for update;
  v_now := clock_timestamp();
  if not found or v_cur.ends_at <= v_now then
    raise exception 'preview_not_active' using errcode = '55000';
  end if;

  update public.organization_feature_previews
  set ends_at = v_now, updated_at = v_now
  where organization_id = p_org and feature = p_feature;

  select o.slug into v_slug from public.organizations o where o.id = p_org;
  select u.email into v_actor_email from auth.users u where u.id = p_actor;

  insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
  values (
    p_actor,
    coalesce(v_actor_email, '(sin email)'),
    'feature_preview.ended',
    p_org,
    jsonb_build_object('active', true, 'ends_at', v_cur.ends_at),
    jsonb_build_object('slug', v_slug, 'feature', p_feature, 'ends_at', v_now, 'reason', v_reason)
  );
end;
$$;
comment on function public.admin_end_feature_preview(uuid, uuid, text, text) is
  'Finaliza ahora una vista previa vigente de una función, con motivo y auditoría. Solo service_role; vuelve a comprobar que p_actor es SuperAdmin.';

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
-- `create or replace` conserva los EXECUTE de plan_grants y org_entitlements. Lo nuevo parte de cero: PUBLIC recibe EXECUTE por defecto.

revoke all on function public.admin_set_feature_preview(uuid, uuid, text, timestamptz, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_end_feature_preview(uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_feature_preview(uuid, uuid, text, timestamptz, text) to service_role;
grant execute on function public.admin_end_feature_preview(uuid, uuid, text, text) to service_role;

commit;
