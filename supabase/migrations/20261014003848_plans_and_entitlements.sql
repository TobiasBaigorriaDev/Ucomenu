-- Planes y entitlements (nivel C): catálogo, suscripciones, estado de mora derivado,
-- límites por plan y bloqueo de escrituras. Ver agile/cambios/planes-y-entitlements.md
-- y docs/decisiones/0006-planes-mora-y-limites-en-la-base.md.
--
-- Aditiva, salvo que reemplaza políticas existentes por versiones con condiciones nuevas.
-- Rollback (local): git revert + `pnpm db:reset`. Con datos: ver la ficha.
--
-- Reglas de fondo:
--  * El estado de mora se DERIVA de las fechas y de now(); no se guarda.
--  * Plan, fechas y add-ons los escribe solo el servidor (service_role). Por la API, solo se leen.
--  * Los topes son invariantes de la base (triggers), valen también para service_role.

-- ---------------------------------------------------------------------------
-- Catálogo (parametrizable: ningún valor comercial vive en el código)
-- ---------------------------------------------------------------------------

create table public.plans (
  code text primary key
    check (code in ('basic', 'pro', 'premium')),
  name text not null,
  monthly_price_usd_cents integer not null check (monthly_price_usd_cents >= 0),
  yearly_price_usd_cents integer not null check (yearly_price_usd_cents >= 0),
  -- null = sin límite
  max_branches integer check (max_branches is null or max_branches > 0),
  max_tables_per_branch integer check (max_tables_per_branch is null or max_tables_per_branch > 0),
  max_active_products integer check (max_active_products is null or max_active_products > 0),
  features text[] not null default '{}'
    check (features <@ array['menu', 'waiter_call', 'loyalty', 'analytics']),
  created_at timestamptz not null default now()
);
comment on table public.plans is
  'Catálogo de planes. Precios en centavos de USD; límites nulos = sin límite. Lo modifica solo el servidor.';

create table public.addons (
  code text primary key
    check (code in ('webar')),
  name text not null,
  monthly_price_usd_cents integer not null check (monthly_price_usd_cents >= 0),
  base_model_quota integer not null check (base_model_quota >= 0),
  pack_size integer not null check (pack_size > 0),
  pack_monthly_price_usd_cents integer not null check (pack_monthly_price_usd_cents >= 0),
  allowed_plans text[] not null
    check (allowed_plans <@ array['basic', 'pro', 'premium']),
  created_at timestamptz not null default now()
);
comment on table public.addons is
  'Add-ons contratables sobre un plan (WebAR: cupo base de platos 3D y packs extra).';

-- Valores de docs/producto.md (2026-10-13).
insert into public.plans
  (code, name, monthly_price_usd_cents, yearly_price_usd_cents, max_branches, max_tables_per_branch, max_active_products, features)
values
  ('basic',   'Básico',  2000, 19000, 1,    20,   80,   array['menu']),
  ('pro',     'Pro',     4000, 38000, 2,    50,   200,  array['menu', 'waiter_call', 'analytics']),
  ('premium', 'Premium', 7000, 67000, null, null, null, array['menu', 'waiter_call', 'analytics', 'loyalty']);

insert into public.addons
  (code, name, monthly_price_usd_cents, base_model_quota, pack_size, pack_monthly_price_usd_cents, allowed_plans)
values
  ('webar', 'WebAR', 2500, 15, 10, 1000, array['pro', 'premium']);

-- ---------------------------------------------------------------------------
-- Suscripciones
-- ---------------------------------------------------------------------------

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  plan_code text not null references public.plans (code),
  billing_cycle text not null default 'monthly'
    check (billing_cycle in ('monthly', 'yearly')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  -- Sin ninguna fecha el estado no se puede derivar: se exige al menos una.
  check (trial_ends_at is not null or current_period_end is not null)
);
comment on table public.subscriptions is
  'Una por organización. El estado de mora se deriva de greatest(current_period_end, trial_ends_at); no se guarda.';

create index subscriptions_plan_code_idx on public.subscriptions (plan_code);

create table public.subscription_addons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  addon_code text not null references public.addons (code),
  extra_packs integer not null default 0 check (extra_packs >= 0),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, addon_code)
);
comment on table public.subscription_addons is
  'Add-ons contratados por la organización. Vigente si ends_at es nulo o futuro.';

create index subscription_addons_addon_code_idx on public.subscription_addons (addon_code);

alter table public.plans               enable row level security;
alter table public.addons              enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.subscription_addons enable row level security;

-- ---------------------------------------------------------------------------
-- Estado derivado y entitlements (esquema private; ver ADR 0005 para el patrón)
-- ---------------------------------------------------------------------------
-- Todas con search_path vacío. Los privilegios EXECUTE se otorgan al final, uno por uno.

-- Pura: estado a partir del fin del período y un instante. Los bordes son inclusivos:
-- día N de mora = techo((at - fin) / 24 h); gracia 1-7, solo lectura 8-15, suspendida 16+.
-- Intervalos en horas para no depender de la zona horaria de la sesión.
create function private.billing_state(period_end timestamptz, at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when period_end is null then 'suspended'
    when at <= period_end then 'active'
    when at <= period_end + interval '168 hours' then 'grace'
    when at <= period_end + interval '360 hours' then 'read_only'
    else 'suspended'
  end;
$$;

-- Estado de una organización ahora. Sin suscripción: suspendida (falla cerrado).
create function private.org_state(org_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select private.billing_state(greatest(s.current_period_end, s.trial_ends_at), now())
      from public.subscriptions s
      where s.organization_id = org_id
    ),
    'suspended'
  );
$$;

create function private.org_can_write(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.org_state(org_id) in ('active', 'grace');
$$;

-- La carta pública se publica salvo suspensión.
create function private.org_is_published(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.org_state(org_id) <> 'suspended';
$$;

-- ¿Lo concede el plan (o el add-on vigente), ignorando la mora?
create function private.plan_grants(org_id uuid, feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case
      when feature = 'webar' then exists (
        select 1
        from public.subscription_addons a
        join public.addons ad on ad.code = a.addon_code
        join public.subscriptions s on s.organization_id = a.organization_id
        where a.organization_id = org_id
          and a.addon_code = 'webar'
          and (a.ends_at is null or a.ends_at > now())
          and s.plan_code = any (ad.allowed_plans)
      )
      else exists (
        select 1
        from public.subscriptions s
        join public.plans p on p.code = s.plan_code
        where s.organization_id = org_id
          and feature = any (p.features)
      )
    end,
    false
  );
$$;

-- Capacidades efectivas: plan + add-on + mora.
--  suspended: nada · read_only: solo lo no interactivo (menu, analytics) · active/grace: todo lo contratado.
create function private.has_feature(org_id uuid, feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case private.org_state(org_id)
    when 'suspended' then false
    when 'read_only' then feature in ('menu', 'analytics') and private.plan_grants(org_id, feature)
    else private.plan_grants(org_id, feature)
  end;
$$;

-- Tope de un recurso para la organización. null = sin límite; 0 si no hay suscripción.
create function private.org_limit(org_id uuid, resource text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan public.plans%rowtype;
  v_quota integer;
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
  elsif resource = 'models_3d' then
    select ad.base_model_quota + a.extra_packs * ad.pack_size into v_quota
    from public.subscription_addons a
    join public.addons ad on ad.code = a.addon_code
    where a.organization_id = org_id
      and a.addon_code = 'webar'
      and (a.ends_at is null or a.ends_at > now())
      and v_plan.code = any (ad.allowed_plans);
    return coalesce(v_quota, 0);
  end if;

  raise exception 'recurso desconocido: %', resource;
end;
$$;

-- ---------------------------------------------------------------------------
-- Alta: toda organización nueva arranca con 14 días de Básico (336 h)
-- ---------------------------------------------------------------------------

create function private.create_trial_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.subscriptions (organization_id, plan_code, trial_ends_at)
  values (new.id, 'basic', new.created_at + interval '336 hours');
  return new;
end;
$$;

create trigger organizations_create_trial
  after insert on public.organizations
  for each row execute function private.create_trial_subscription();

-- Organizaciones ya existentes: prueba completa de 14 días desde esta migración.
insert into public.subscriptions (organization_id, plan_code, trial_ends_at)
select o.id, 'basic', now() + interval '336 hours'
from public.organizations o
where not exists (select 1 from public.subscriptions s where s.organization_id = o.id);

-- ---------------------------------------------------------------------------
-- Límites: se aplican al crear y al ACTIVAR. Activo -> inactivo nunca se bloquea.
-- Un advisory lock por organización serializa los pedidos simultáneos para que no superen el tope.
--
-- Los triggers BEFORE corren ANTES del WITH CHECK de RLS y estas funciones son SECURITY DEFINER:
-- si contaran sin más, un usuario podría provocar el error 53400 contra una organización ajena
-- y leer su tope y su uso en el detalle. Por eso, si el pedido trae un usuario (API) que no es
-- miembro de la organización, el trigger no cuenta ni informa nada y deja que RLS rechace la
-- escritura con 42501. Sin usuario (servidor, service_role) el tope se aplica siempre.
-- ---------------------------------------------------------------------------

create function private.enforce_product_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  if not new.is_active then
    return new;
  end if;
  -- Ya estaba activo en la misma organización: editarlo no consume cupo.
  if tg_op = 'UPDATE' and old.is_active and old.organization_id = new.organization_id then
    return new;
  end if;
  -- Usuario de la API sin membresía en esta organización: no se cuenta ni se informa; decide RLS.
  if (select auth.uid()) is not null and not private.is_org_member(new.organization_id) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('limit:active_products:' || new.organization_id::text, 0));

  v_limit := private.org_limit(new.organization_id, 'active_products');
  if v_limit is null then
    return new;
  end if;

  select count(*) into v_count
  from public.products
  where organization_id = new.organization_id and is_active;

  if v_count >= v_limit then
    raise exception 'limit_exceeded:active_products'
      using errcode = '53400',
            detail = format('limit=%s active=%s', v_limit, v_count),
            hint = 'Desactivá un plato o cambiá de plan.';
  end if;
  return new;
end;
$$;

create trigger products_enforce_limit
  before insert or update on public.products
  for each row execute function private.enforce_product_limit();

create function private.enforce_branch_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  -- Usuario de la API sin membresía en esta organización: no se cuenta ni se informa; decide RLS.
  if (select auth.uid()) is not null and not private.is_org_member(new.organization_id) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('limit:branches:' || new.organization_id::text, 0));

  v_limit := private.org_limit(new.organization_id, 'branches');
  if v_limit is null then
    return new;
  end if;

  select count(*) into v_count
  from public.branches
  where organization_id = new.organization_id;

  if v_count >= v_limit then
    raise exception 'limit_exceeded:branches'
      using errcode = '53400',
            detail = format('limit=%s current=%s', v_limit, v_count),
            hint = 'Cambiá de plan para agregar sucursales.';
  end if;
  return new;
end;
$$;

create trigger branches_enforce_limit
  before insert on public.branches
  for each row execute function private.enforce_branch_limit();

-- Las mesas llegan en «Mesas y QR»: allí se crea un trigger igual con private.org_limit(org, 'tables_per_branch').

-- ---------------------------------------------------------------------------
-- API pública mínima (las únicas funciones SECURITY DEFINER en `public`)
-- ---------------------------------------------------------------------------

-- Entitlements de una organización para sus miembros. Para cualquier otro devuelve null.
-- El Staff no recibe plan, fechas ni días de mora (eso es del Dueño).
create function public.org_entitlements(p_org uuid)
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
        'days_late', case when now() <= v_end then 0 else ceil(extract(epoch from (now() - v_end)) / 86400)::integer end
      );
    end if;
  end if;

  return v_result;
end;
$$;
comment on function public.org_entitlements(uuid) is
  'Estado, escritura permitida, features, límites y uso de la organización. Solo para sus miembros.';

-- Estado público de una carta: 'available' | 'suspended' | null (no existe o no es publicable).
-- Exige que la sucursal exista: una sucursal inventada es «no existe» (404) aunque la organización
-- esté suspendida. Revela solo que el enlace es válido y si está disponible, nunca la causa ni los días de mora.
create function public.public_menu_status(p_org_slug text, p_branch_slug text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.org_is_published(o.id) then 'available' else 'suspended' end
  from public.organizations o
  join public.branches b on b.organization_id = o.id
  where o.slug = p_org_slug
    and b.slug = p_branch_slug
    and o.is_active;
$$;
comment on function public.public_menu_status(text, text) is
  'Para que la ruta pública distinga «Carta temporalmente no disponible» de «no existe».';

-- ---------------------------------------------------------------------------
-- Políticas: lectura pública sin suspendidas; escrituras solo con la cuenta al día
-- ---------------------------------------------------------------------------

-- Lectura pública (reemplaza las de 20261013230544): se agrega org_is_published.
drop policy "branches: lectura pública de organizaciones activas" on public.branches;
create policy "branches: lectura pública de organizaciones activas y publicadas"
  on public.branches for select
  to anon, authenticated
  using (
    private.org_is_published(organization_id)
    and exists (
      select 1 from public.organizations o
      where o.id = branches.organization_id and o.is_active
    )
  );

drop policy "categories: lectura pública de activas" on public.categories;
create policy "categories: lectura pública de activas y publicadas"
  on public.categories for select
  to anon, authenticated
  using (
    is_active
    and private.org_is_published(organization_id)
    and exists (
      select 1 from public.organizations o
      where o.id = categories.organization_id and o.is_active
    )
  );

drop policy "products: lectura pública de activos en categoría activa" on public.products;
create policy "products: lectura pública de activos en categoría activa y publicada"
  on public.products for select
  to anon, authenticated
  using (
    is_active
    and private.org_is_published(organization_id)
    and exists (
      select 1 from public.categories c
      where c.id = products.category_id
        and c.organization_id = products.organization_id
        and c.is_active
    )
  );

-- Escrituras de miembros (reemplaza las de 20261014000121): se agrega org_can_write.
drop policy "organizations: el owner actualiza la suya" on public.organizations;
create policy "organizations: el owner actualiza la suya con la cuenta al día"
  on public.organizations for update
  to authenticated
  using (private.is_org_owner(id) and private.org_can_write(id))
  with check (private.is_org_owner(id) and private.org_can_write(id));

drop policy "branches: el owner actualiza las de su organización" on public.branches;
create policy "branches: el owner actualiza las suyas con la cuenta al día"
  on public.branches for update
  to authenticated
  using (private.is_org_owner(organization_id) and private.org_can_write(organization_id))
  with check (private.is_org_owner(organization_id) and private.org_can_write(organization_id));

drop policy "categories: los miembros crean en su organización" on public.categories;
drop policy "categories: los miembros actualizan las de su organización" on public.categories;
drop policy "categories: los miembros borran las de su organización" on public.categories;

create policy "categories: los miembros crean con la cuenta al día"
  on public.categories for insert
  to authenticated
  with check (private.is_org_member(organization_id) and private.org_can_write(organization_id));

create policy "categories: los miembros actualizan con la cuenta al día"
  on public.categories for update
  to authenticated
  using (private.is_org_member(organization_id) and private.org_can_write(organization_id))
  with check (private.is_org_member(organization_id) and private.org_can_write(organization_id));

create policy "categories: los miembros borran con la cuenta al día"
  on public.categories for delete
  to authenticated
  using (private.is_org_member(organization_id) and private.org_can_write(organization_id));

drop policy "products: los miembros crean en su organización" on public.products;
drop policy "products: los miembros actualizan los de su organización" on public.products;
drop policy "products: los miembros borran los de su organización" on public.products;

create policy "products: los miembros crean con la cuenta al día"
  on public.products for insert
  to authenticated
  with check (private.is_org_member(organization_id) and private.org_can_write(organization_id));

create policy "products: los miembros actualizan con la cuenta al día"
  on public.products for update
  to authenticated
  using (private.is_org_member(organization_id) and private.org_can_write(organization_id))
  with check (private.is_org_member(organization_id) and private.org_can_write(organization_id));

create policy "products: los miembros borran con la cuenta al día"
  on public.products for delete
  to authenticated
  using (private.is_org_member(organization_id) and private.org_can_write(organization_id));

-- Lectura de planes y suscripciones.
create policy "plans: lectura con sesión"
  on public.plans for select
  to authenticated
  using (true);

create policy "addons: lectura con sesión"
  on public.addons for select
  to authenticated
  using (true);

create policy "subscriptions: lectura del owner"
  on public.subscriptions for select
  to authenticated
  using (private.is_org_owner(organization_id));

create policy "subscription_addons: lectura del owner"
  on public.subscription_addons for select
  to authenticated
  using (private.is_org_owner(organization_id));

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------

revoke all on table
  public.plans, public.addons, public.subscriptions, public.subscription_addons
from anon, authenticated;

grant select on table
  public.plans, public.addons, public.subscriptions, public.subscription_addons
to authenticated;

-- Funciones: se parte de cero (PUBLIC recibe EXECUTE por defecto) y se concede lo mínimo.
-- Las políticas se evalúan con el rol que consulta, así que las que usan las políticas
-- necesitan EXECUTE para ese rol. Las internas (estado, features, límites, triggers) no tienen.
revoke all on function
  private.billing_state(timestamptz, timestamptz),
  private.org_state(uuid),
  private.org_can_write(uuid),
  private.org_is_published(uuid),
  private.plan_grants(uuid, text),
  private.has_feature(uuid, text),
  private.org_limit(uuid, text),
  private.create_trial_subscription(),
  private.enforce_product_limit(),
  private.enforce_branch_limit(),
  public.org_entitlements(uuid),
  public.public_menu_status(text, text)
from public, anon, authenticated;

grant execute on function private.org_can_write(uuid) to authenticated;
grant execute on function private.org_is_published(uuid) to anon, authenticated;

-- «private» ya es accesible para authenticated (migración anterior); anon la necesita
-- solo para evaluar org_is_published en las políticas de lectura pública.
grant usage on schema private to anon;

grant execute on function public.org_entitlements(uuid) to authenticated;
grant execute on function public.public_menu_status(text, text) to anon, authenticated;
