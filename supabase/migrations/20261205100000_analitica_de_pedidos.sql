-- Analítica de pedidos para el Dueño (ficha agile/cambios/analitica-de-pedidos.md, ADR 0045), sobre 20261027100000 (analítica
-- básica) y 20261126100000/20261128100000 (pedidos).
--
-- Qué hace:
--  * `owner_sales_overview(p_org, p_days, p_branch)`: ventas de los pedidos CERRADOS del período (7, 30 o 90 días calendario, tope
--    90) y del período anterior de igual largo, por día, por franja (día de la semana × hora de apertura), por categoría, más los
--    pedidos anulados y las líneas canceladas con sus motivos. jsonb.
--  * `owner_products_performance(p_org, p_days, p_branch, p_limit)`: platos más vendidos (con sus vistas) y platos activos sin
--    pedidos en el período (con sus vistas). jsonb.
--  * Índice `orders_organization_closed_idx` para acotar la lectura por fecha de cierre.
--
-- Reglas: solo el Dueño ACTUAL de la organización, con la función `analytics` en el plan (en «solo lectura» sí; suspendida no, como
-- el resto de la analítica); cualquier otra identidad recibe `null`. Importe de línea = cantidad × (unit_price_cents +
-- options_cents), como la precuenta; una línea `cancelled` no suma; un pedido anulado o abierto no suma a las ventas. Los días
-- son los de la zona horaria de CADA sucursal (`branches.timezone`, ADR 0040). Nada se agrupa por persona. Las funciones solo leen.
--
-- Aditiva: sin datos que migrar. Rollback (local): git revert + `pnpm db:reset`. En una base con datos reales:
--   drop function public.owner_sales_overview(uuid, integer, uuid), public.owner_products_performance(uuid, integer, uuid, integer);
--   drop index public.orders_organization_closed_idx;

begin;

create index orders_organization_closed_idx on public.orders (organization_id, closed_at desc) where closed_at is not null;

-- ---------------------------------------------------------------------------
-- Ventas, franjas, categorías y control
-- ---------------------------------------------------------------------------
create function public.owner_sales_overview(p_org uuid, p_days integer default 30, p_branch uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_result jsonb;
begin
  if p_org is null
     or not private.is_org_owner(p_org)
     or not private.has_feature(p_org, 'analytics') then
    return null;
  end if;

  with scoped as (
    -- Pedidos terminados de los dos períodos. `days_ago` es en días calendario de la zona de la sucursal (0 = hoy). El filtro por
    -- `closed_at` acota el índice; el margen de un día cubre cualquier diferencia de zona.
    select o.id, o.status, o.void_reason, o.opened_at, o.closed_at, b.timezone as tz,
           (now() at time zone b.timezone)::date - (o.closed_at at time zone b.timezone)::date as days_ago
    from public.orders o
    join public.branches b on b.id = o.branch_id and b.organization_id = o.organization_id
    where o.organization_id = p_org
      and o.status in ('closed', 'void')
      and (p_branch is null or o.branch_id = p_branch)
      and o.closed_at >= now() - make_interval(days => 2 * v_days + 1)
  ),
  win as (
    select s.*, case when s.days_ago < v_days then 'current' else 'previous' end as period
    from scoped s
    where s.days_ago between 0 and 2 * v_days - 1
  ),
  tot as (
    select w.id, w.period, w.status, w.void_reason, w.days_ago, w.opened_at, w.closed_at, w.tz,
           coalesce(sum(i.quantity) filter (where i.status <> 'cancelled'), 0)::bigint as units,
           coalesce(sum(i.quantity::bigint * (i.unit_price_cents + i.options_cents)) filter (where i.status <> 'cancelled'), 0)::bigint as cents,
           coalesce(sum(i.quantity::bigint * (i.base_price_cents - i.unit_price_cents)) filter (where i.status <> 'cancelled'), 0)::bigint as promo_cents,
           coalesce(sum(i.quantity) filter (where i.status = 'cancelled'), 0)::bigint as cancelled_units,
           coalesce(sum(i.quantity::bigint * (i.unit_price_cents + i.options_cents)) filter (where i.status = 'cancelled'), 0)::bigint as cancelled_cents
    from win w
    left join public.order_items i on i.order_id = w.id and i.organization_id = p_org
    group by w.id, w.period, w.status, w.void_reason, w.days_ago, w.opened_at, w.closed_at, w.tz
  ),
  periods as (
    select pr.period,
           count(t.id) filter (where t.status = 'closed' and t.units > 0) as orders,
           coalesce(sum(t.cents) filter (where t.status = 'closed' and t.units > 0), 0)::bigint as revenue_cents,
           coalesce(sum(t.units) filter (where t.status = 'closed'), 0)::bigint as units,
           coalesce(sum(t.promo_cents) filter (where t.status = 'closed'), 0)::bigint as promo_discount_cents,
           count(t.id) filter (where t.status = 'void') as voided_orders,
           coalesce(sum(t.cents) filter (where t.status = 'void'), 0)::bigint as voided_cents,
           coalesce(sum(t.cancelled_units) filter (where t.status = 'closed'), 0)::bigint as cancelled_units,
           coalesce(sum(t.cancelled_cents) filter (where t.status = 'closed'), 0)::bigint as cancelled_cents,
           round((percentile_cont(0.5) within group (order by extract(epoch from (t.closed_at - t.opened_at)) / 60.0)
                  filter (where t.status = 'closed' and t.units > 0))::numeric) as median_minutes
    from (values ('current'), ('previous')) pr(period)
    left join tot t on t.period = pr.period
    group by pr.period
  )
  select jsonb_build_object(
    'days', v_days,
    'current', (select jsonb_build_object(
        'orders', x.orders, 'revenue_cents', x.revenue_cents, 'units', x.units, 'promo_discount_cents', x.promo_discount_cents,
        'voided_orders', x.voided_orders, 'voided_cents', x.voided_cents, 'cancelled_units', x.cancelled_units,
        'cancelled_cents', x.cancelled_cents, 'median_minutes', x.median_minutes)
      from periods x where x.period = 'current'),
    'previous', (select jsonb_build_object(
        'orders', x.orders, 'revenue_cents', x.revenue_cents, 'units', x.units, 'promo_discount_cents', x.promo_discount_cents,
        'voided_orders', x.voided_orders, 'voided_cents', x.voided_cents, 'cancelled_units', x.cancelled_units,
        'cancelled_cents', x.cancelled_cents, 'median_minutes', x.median_minutes)
      from periods x where x.period = 'previous'),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('days_ago', g.days_ago, 'orders', g.n, 'revenue_cents', g.c) order by g.days_ago), '[]'::jsonb)
      from (
        select t.days_ago, count(*) as n, sum(t.cents)::bigint as c
        from tot t
        where t.period = 'current' and t.status = 'closed' and t.units > 0
        group by t.days_ago
      ) g),
    'by_slot', (
      select coalesce(jsonb_agg(jsonb_build_object('dow', g.dow, 'hour', g.hr, 'orders', g.n, 'revenue_cents', g.c) order by g.dow, g.hr), '[]'::jsonb)
      from (
        select extract(isodow from t.opened_at at time zone t.tz)::integer as dow,
               extract(hour from t.opened_at at time zone t.tz)::integer as hr,
               count(*) as n, sum(t.cents)::bigint as c
        from tot t
        where t.period = 'current' and t.status = 'closed' and t.units > 0
        group by 1, 2
      ) g),
    'by_category', (
      select coalesce(jsonb_agg(jsonb_build_object('category_id', g.cid, 'name', g.cname, 'units', g.units, 'revenue_cents', g.cents)
                                order by g.cents desc, g.units desc, g.cname nulls last), '[]'::jsonb)
      from (
        select c.id as cid, c.name as cname, sum(i.quantity)::bigint as units,
               sum(i.quantity::bigint * (i.unit_price_cents + i.options_cents))::bigint as cents
        from tot t
        join public.order_items i on i.order_id = t.id and i.organization_id = p_org and i.status <> 'cancelled'
        left join public.products p on p.id = i.product_id and p.organization_id = p_org
        left join public.categories c on c.id = p.category_id and c.organization_id = p_org
        where t.period = 'current' and t.status = 'closed'
        group by c.id, c.name
        order by 4 desc, 3 desc, c.name nulls last
        limit 12
      ) g),
    'void_reasons', (
      select coalesce(jsonb_agg(jsonb_build_object('reason', g.reason, 'orders', g.n, 'cents', g.c) order by g.n desc, g.c desc, g.reason), '[]'::jsonb)
      from (
        select min(t.void_reason) as reason, count(*) as n, sum(t.cents)::bigint as c
        from tot t
        where t.period = 'current' and t.status = 'void'
        group by lower(btrim(t.void_reason))
        order by 2 desc, 3 desc, 1
        limit 5
      ) g),
    'cancel_reasons', (
      select coalesce(jsonb_agg(jsonb_build_object('reason', g.reason, 'units', g.n, 'cents', g.c) order by g.n desc, g.c desc, g.reason), '[]'::jsonb)
      from (
        select min(coalesce(i.cancel_reason, '')) as reason, sum(i.quantity)::bigint as n,
               sum(i.quantity::bigint * (i.unit_price_cents + i.options_cents))::bigint as c
        from tot t
        join public.order_items i on i.order_id = t.id and i.organization_id = p_org and i.status = 'cancelled'
        where t.period = 'current' and t.status = 'closed'
        group by lower(btrim(coalesce(i.cancel_reason, '')))
        order by 2 desc, 3 desc, 1
        limit 5
      ) g)
  ) into v_result;

  return v_result;
end;
$$;
comment on function public.owner_sales_overview(uuid, integer, uuid) is
  'Ventas de los pedidos cerrados de los últimos 7, 30 o 90 días (tope 90) y del período anterior, por día, franja y categoría, con anulados y cancelaciones, para el Dueño actual con analítica. null para cualquier otra identidad. Días de la zona de cada sucursal. Solo lee.';

-- ---------------------------------------------------------------------------
-- Platos: los que más venden y los que no se piden
-- ---------------------------------------------------------------------------
create function public.owner_products_performance(p_org uuid, p_days integer default 30, p_branch uuid default null, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  -- Las vistas se cuentan por día de Argentina (ADR 0022), igual que owner_top_dishes.
  v_from date := (now() at time zone 'America/Argentina/Buenos_Aires')::date - (least(greatest(coalesce(p_days, 30), 1), 90) - 1);
  v_result jsonb;
begin
  if p_org is null
     or not private.is_org_owner(p_org)
     or not private.has_feature(p_org, 'analytics') then
    return null;
  end if;

  with sold as (
    -- Un plato borrado después de venderse (product_id nulo) se agrupa por el nombre copiado.
    select coalesce(i.product_id::text, 'n:' || i.product_name) as k,
           (array_agg(i.product_id))[1] as product_id,
           (array_agg(i.product_name order by o.closed_at desc))[1] as name,
           sum(i.quantity)::bigint as units,
           sum(i.quantity::bigint * (i.unit_price_cents + i.options_cents))::bigint as cents
    from public.orders o
    join public.branches b on b.id = o.branch_id and b.organization_id = o.organization_id
    join public.order_items i on i.order_id = o.id and i.organization_id = o.organization_id
    where o.organization_id = p_org
      and o.status = 'closed'
      and i.status <> 'cancelled'
      and (p_branch is null or o.branch_id = p_branch)
      and o.closed_at >= now() - make_interval(days => v_days + 1)
      and (now() at time zone b.timezone)::date - (o.closed_at at time zone b.timezone)::date < v_days
    group by 1
  ),
  views as (
    select d.product_id, sum(d.views)::bigint as views
    from public.dish_view_counts d
    where d.organization_id = p_org
      and d.day >= v_from
      and (p_branch is null or d.branch_id = p_branch)
    group by d.product_id
  ),
  best as (
    select s.k, s.product_id, coalesce(p.name, s.name) as name, c.name as category, s.units, s.cents,
           coalesce(v.views, 0)::bigint as views, (p.id is not null) as in_catalog, coalesce(p.is_active, false) as is_active
    from sold s
    left join public.products p on p.id = s.product_id and p.organization_id = p_org
    left join public.categories c on c.id = p.category_id and c.organization_id = p_org
    left join views v on v.product_id = s.product_id
    order by s.cents desc, s.units desc, coalesce(p.name, s.name), s.k
    limit v_limit
  ),
  unsold_all as (
    -- Platos publicados (activos, en categoría activa) que se ven en alguna sucursal considerada y no vendieron nada.
    select p.id as product_id, p.name, c.name as category, coalesce(v.views, 0)::bigint as views
    from public.products p
    join public.categories c on c.id = p.category_id and c.organization_id = p.organization_id and c.is_active
    left join views v on v.product_id = p.id
    where p.organization_id = p_org
      and p.is_active
      and not exists (select 1 from sold s where s.product_id = p.id)
      and exists (
        select 1 from public.branches b
        where b.organization_id = p_org
          and b.is_active
          and (p_branch is null or b.id = p_branch)
          and not exists (
            select 1 from public.product_availability pa
            where pa.branch_id = b.id and pa.product_id = p.id and not pa.is_visible
          )
      )
  )
  select jsonb_build_object(
    'days', v_days,
    'best', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'product_id', x.product_id, 'name', x.name, 'category', x.category, 'units', x.units, 'revenue_cents', x.cents,
        'views', x.views, 'in_catalog', x.in_catalog, 'is_active', x.is_active)
        order by x.cents desc, x.units desc, x.name, x.k), '[]'::jsonb)
      from best x),
    'unsold_total', (select count(*) from unsold_all),
    'unsold', (
      select coalesce(jsonb_agg(jsonb_build_object('product_id', u.product_id, 'name', u.name, 'category', u.category, 'views', u.views)
                               order by u.views desc, u.name, u.product_id), '[]'::jsonb)
      from (select * from unsold_all order by views desc, name, product_id limit v_limit) u)
  ) into v_result;

  return v_result;
end;
$$;
comment on function public.owner_products_performance(uuid, integer, uuid, integer) is
  'Platos más vendidos del período (con sus vistas) y platos publicados sin pedidos (con sus vistas), para el Dueño actual con analítica. null para cualquier otra identidad. Solo lee.';

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
revoke all on function public.owner_sales_overview(uuid, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.owner_products_performance(uuid, integer, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.owner_sales_overview(uuid, integer, uuid) to authenticated;
grant execute on function public.owner_products_performance(uuid, integer, uuid, integer) to authenticated;

commit;
