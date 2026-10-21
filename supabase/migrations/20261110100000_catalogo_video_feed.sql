-- Catálogo del feed de videos cortos (fase 2, nivel C): feature `video_feed` y límite `videos_published` en `plans`;
-- se retira el add-on `webar` y el límite `models_3d`. Ficha: agile/cambios/catalogo-video-feed.md · ADR 0031 (reemplaza a 0002).
--
-- Qué hace:
--  * `plans`: la feature `video_feed` entra en el `check` y se suma a Premium; la columna nueva `max_videos_published`
--    (null = sin límite, como los otros topes) vale 10 en Premium y 0 en Básico y Pro (sin cupo: fallan cerrado).
--  * Retira WebAR: los contratos vigentes se cierran con una entrada `addon.ended` en `audit_log` (actor «sistema»,
--    motivo «retirado del catálogo»), se borran las filas de `subscription_addons` de `webar` y la fila de `addons`.
--    Eran solo de ensayo (nunca estuvo a la venta y no habilita nada). El historial del Dueño y del SuperAdmin sigue
--    mostrando «WebAR» en los movimientos viejos.
--  * `addons.code` deja de estar limitado a `webar`: queda un chequeo de formato para que el próximo add-on solo agregue
--    su fila al catálogo (las funciones de ADR 0025 se conservan). El catálogo queda vacío: hoy no hay add-ons a la venta.
--  * `private.plan_grants` pierde la rama de add-on (solo el plan concede features), `private.org_limit` cambia
--    `models_3d` por `videos_published` y `public.org_entitlements` informa `video_feed` / `videos_published`.
--  * `private.has_feature`: `video_feed` se conserva en solo lectura (los videos publicados se siguen viendo). Subir,
--    publicar, dar like y comentar exigen además `private.org_can_write` (invariante de los incrementos siguientes).
--
-- Sin cambios de permisos: `create or replace` conserva los EXECUTE; nada nuevo se abre a anon ni a authenticated.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos, en UNA transacción: volver a crear las cuatro
-- funciones con las definiciones de 20261014003848_plans_and_entitlements.sql / 20261023100000_desactivar_sucursales.sql,
-- quitar `video_feed` de `plans.features` y de su `check`, `drop column max_videos_published`, restaurar el `check` de
-- `addons.code` y volver a insertar la fila `webar` del catálogo. Los contratos borrados NO se recuperan de la base: quedan
-- en `audit_log` (`before` trae packs y fin) y se reconstruirían a mano con `admin_set_addon`.

-- ---------------------------------------------------------------------------
-- plans: feature y límite del feed
-- ---------------------------------------------------------------------------

alter table public.plans drop constraint plans_features_check;
alter table public.plans add constraint plans_features_check
  check (features <@ array['menu', 'waiter_call', 'loyalty', 'analytics', 'video_feed']);

alter table public.plans add column max_videos_published integer
  check (max_videos_published is null or max_videos_published >= 0);
comment on column public.plans.max_videos_published is
  'Tope de videos publicados en el feed (ADR 0031). 0 = sin cupo; null = sin límite. Lo modifica solo el servidor.';

update public.plans set max_videos_published = 0 where code in ('basic', 'pro');
update public.plans
set features = array['menu', 'waiter_call', 'analytics', 'loyalty', 'video_feed'],
    max_videos_published = 10
where code = 'premium';

-- ---------------------------------------------------------------------------
-- Retiro del add-on webar: contratos, catálogo y chequeo de código
-- ---------------------------------------------------------------------------

-- Los contratos vigentes quedan registrados como finalizados por el sistema antes de borrarse.
insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  'sistema (migración 20261110100000)',
  'addon.ended',
  a.organization_id,
  jsonb_build_object('active', true, 'extra_packs', a.extra_packs, 'ends_at', a.ends_at),
  jsonb_build_object(
    'slug', o.slug,
    'addon', a.addon_code,
    'extra_packs', a.extra_packs,
    'ends_at', clock_timestamp(),
    'reason', 'Add-on retirado del catálogo (ADR 0031)'
  )
from public.subscription_addons a
join public.organizations o on o.id = a.organization_id
where a.addon_code = 'webar'
  and (a.ends_at is null or a.ends_at > now());

delete from public.subscription_addons where addon_code = 'webar';
delete from public.addons where code = 'webar';

alter table public.addons drop constraint addons_code_check;
alter table public.addons add constraint addons_code_check
  check (code ~ '^[a-z][a-z0-9_]{0,31}$');
comment on table public.addons is
  'Add-ons contratables sobre un plan. Catálogo vacío desde ADR 0031 (WebAR retirado); lo escribe solo una migración.';

-- ---------------------------------------------------------------------------
-- Entitlements: solo el plan concede features; el cupo de videos sale de `plans`
-- ---------------------------------------------------------------------------

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
  );
$$;

-- Capacidades efectivas: plan + mora.
--  suspended: nada · read_only: solo lo no interactivo (menu, analytics, video_feed) · active/grace: todo lo contratado.
-- `video_feed` en solo lectura significa «los videos publicados se ven»; las escrituras exigen además org_can_write.
create or replace function private.has_feature(org_id uuid, feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case private.org_state(org_id)
    when 'suspended' then false
    when 'read_only' then feature in ('menu', 'analytics', 'video_feed') and private.plan_grants(org_id, feature)
    else private.plan_grants(org_id, feature)
  end;
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
    return v_plan.max_branches;
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

-- Mismo contrato que la versión de 20261023100000; cambia la lista de features y el límite de videos.
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
