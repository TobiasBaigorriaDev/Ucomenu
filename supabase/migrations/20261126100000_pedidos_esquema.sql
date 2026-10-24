-- Esquema de pedidos y alta de ítems sin opciones (ficha agile/cambios/pedidos-esquema-y-alta-de-items.md, ADR 0041).
--
-- Qué hace:
--  * Catálogo: `orders` entra a `plans.features` y a `plans_features_check`, y se concede a Pro y Premium (ADR 0041, decisión 9).
--    Las vistas previas ya la conocen (`organization_feature_previews`): un Básico puede tenerla por tiempo limitado.
--  * Tablas `orders` (un pedido por mesa, copia de la etiqueta) y `order_items` (una línea: plato, cantidad y precio, todo copiado).
--    Claves foráneas compuestas con la organización: ninguna línea apunta a platos, mesas ni sucursales de otra.
--  * Un solo pedido abierto por mesa (índice único parcial).
--  * NADIE escribe las tablas por la API (tampoco `service_role`): la única puerta de escritura es `public.add_order_item`, que
--    exige un miembro de la organización con la función en el plan y la cuenta al día, y calcula el precio con `effective_prices`.
--    El precio NO es un parámetro. Lee la tabla solo un miembro de la organización; `anon`, nada.
--
-- Errores estables de `add_order_item` (el mensaje es el nombre):
--   42501 orders_not_allowed (sin sesión, no es miembro, o el plan/la mora no lo permiten) · P0002 branch_not_found / table_not_found /
--   product_unavailable · 22023 invalid_quantity / invalid_client_key / client_key_reused · 22023 options_required (plato con un grupo
--   obligatorio: hasta la ficha de variantes) · 53400 order_full (200 líneas) · 40001 order_conflict (se cerró en el medio; repetir).
--
-- Aditiva: sin datos que migrar. Borrar la organización se lleva los pedidos por cascada (la retención y la purga explícita son
-- de la ficha de cierre).
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos reales: exportar `orders` y `order_items`, y después
--   1. drop function public.add_order_item(uuid, uuid, uuid, integer, uuid), private.can_take_orders(uuid);
--   2. drop table public.order_items, public.orders;
--   3. quitar `orders` de `plans.features` y de `plans_features_check`.

begin;

-- ---------------------------------------------------------------------------
-- Catálogo de planes
-- ---------------------------------------------------------------------------

alter table public.plans drop constraint plans_features_check;
alter table public.plans add constraint plans_features_check
  check (features <@ array['menu', 'waiter_call', 'loyalty', 'analytics', 'video_feed', 'promotions', 'orders']);

update public.plans
set features = array_append(features, 'orders')
where code in ('pro', 'premium') and not ('orders' = any (features));

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  -- Nulo si se borra la mesa: el pedido se conserva con la etiqueta copiada.
  table_id uuid,
  table_label text not null,
  status text not null default 'open',
  opened_by uuid references auth.users (id) on delete set null,
  opened_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  constraint orders_id_organization_key unique (id, organization_id),
  constraint orders_label_check check (char_length(btrim(table_label)) between 1 and 40),
  constraint orders_status_check check (status in ('open', 'closed', 'void')),
  constraint orders_closed_check check ((status = 'open') = (closed_at is null)),
  foreign key (branch_id, organization_id) references public.branches (id, organization_id) on delete cascade,
  foreign key (table_id, branch_id, organization_id) references public.tables (id, branch_id, organization_id) on delete set null (table_id)
);
comment on table public.orders is
  'Pedido de una mesa que anota el mozo (ADR 0041). Se escribe solo con add_order_item (y las funciones de las fichas siguientes); la etiqueta de la mesa se copia. Un solo pedido abierto por mesa.';

create unique index orders_one_open_per_table on public.orders (table_id) where status = 'open' and table_id is not null;
create index orders_organization_idx on public.orders (organization_id, opened_at desc);
create index orders_branch_idx on public.orders (branch_id);
create index orders_table_idx on public.orders (table_id) where table_id is not null;

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  order_id uuid not null,
  -- Nulo si se borra el plato: la línea se conserva con el nombre copiado.
  product_id uuid,
  product_name text not null,
  quantity smallint not null,
  -- Precio de lista en la sucursal y precio efectivo al anotar (el que manda; con promoción si regía).
  base_price_cents integer not null,
  unit_price_cents integer not null,
  promotion_id uuid,
  promotion_name text,
  status text not null default 'noted',
  -- Clave que genera el cliente por toque: repetir la llamada con la misma no duplica la línea.
  client_key uuid not null,
  -- Huella de la petición original (mesa, plato y cantidad): el reintento se compara con ella y no con `product_id`, que se
  -- anula si el plato se borra después.
  request_hash text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  constraint order_items_name_check check (char_length(btrim(product_name)) between 1 and 200),
  constraint order_items_quantity_check check (quantity between 1 and 99),
  constraint order_items_prices_check check (base_price_cents >= 0 and unit_price_cents >= 0 and unit_price_cents <= base_price_cents),
  constraint order_items_promotion_check check ((promotion_id is null) = (promotion_name is null)),
  constraint order_items_status_check check (status in ('noted')),
  foreign key (order_id, organization_id) references public.orders (id, organization_id) on delete cascade,
  foreign key (product_id, organization_id) references public.products (id, organization_id) on delete set null (product_id)
);
comment on table public.order_items is
  'Línea de un pedido (ADR 0041): nombre, cantidad y precios copiados al anotarla; el precio efectivo lo calcula la base. Sin opciones todavía (ficha de variantes).';

create unique index order_items_client_key on public.order_items (organization_id, client_key);
create index order_items_order_idx on public.order_items (order_id, created_at);
create index order_items_organization_idx on public.order_items (organization_id);
create index order_items_product_idx on public.order_items (product_id) where product_id is not null;

-- ---------------------------------------------------------------------------
-- Permisos y lectura
-- ---------------------------------------------------------------------------
-- Anota un miembro con la función en el plan y la cuenta al día (`has_feature` ya excluye solo lectura y suspendida).

create function private.can_take_orders(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_member(org_id) and private.has_feature(org_id, 'orders');
$$;
revoke all on function private.can_take_orders(uuid) from public, anon, authenticated;

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all on table public.orders, public.order_items from anon, authenticated;
create policy "orders: lectura de miembros"
  on public.orders for select to authenticated
  using (private.is_org_member(organization_id));
create policy "order_items: lectura de miembros"
  on public.order_items for select to authenticated
  using (private.is_org_member(organization_id));
grant select on table public.orders, public.order_items to authenticated;

-- Ni siquiera el servicio técnico escribe: solo las funciones (y la cascada del borrado de la organización, que corre con el dueño).
revoke insert, update, delete, truncate, references, trigger on table public.orders, public.order_items from service_role;

-- ---------------------------------------------------------------------------
-- Alta de una línea
-- ---------------------------------------------------------------------------

create function public.add_order_item(
  p_branch uuid,
  p_table uuid,
  p_product uuid,
  p_quantity integer,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_active boolean;
  v_label text;
  v_name text;
  v_order uuid;
  v_base integer;
  v_price integer;
  v_promo uuid;
  v_promo_name text;
  v_count integer;
  v_hash text;
  v_item public.order_items%rowtype;
begin
  if v_uid is null then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;

  select b.organization_id, b.is_active into v_org, v_active from public.branches b where b.id = p_branch;
  if not found then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  -- Antes de mirar nada más de la organización: quien no es miembro (o no tiene plan o cuenta al día) no aprende qué hay adentro.
  if not private.can_take_orders(v_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  if not v_active then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  if p_client_key is null then
    raise exception 'invalid_client_key' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;

  -- Mismo toque repetido a la vez: se serializa por clave, así la segunda llamada ve la línea de la primera.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || p_client_key::text, 0));
  -- Esperar el candado puede llevar tiempo: también el reintento (que devuelve la línea) revalida quién llama.
  if not private.can_take_orders(v_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  v_hash := md5(format('%s|%s|%s', p_table, p_product, p_quantity));
  select i.* into v_item from public.order_items i where i.organization_id = v_org and i.client_key = p_client_key;
  if found then
    if v_item.request_hash <> v_hash then
      raise exception 'client_key_reused' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'order_id', v_item.order_id, 'item_id', v_item.id, 'product_name', v_item.product_name, 'quantity', v_item.quantity,
      'base_price_cents', v_item.base_price_cents, 'unit_price_cents', v_item.unit_price_cents,
      'promotion_id', v_item.promotion_id, 'promotion_name', v_item.promotion_name, 'replayed', true
    );
  end if;

  select t.label into v_label
  from public.tables t
  where t.id = p_table and t.branch_id = p_branch and t.organization_id = v_org and t.is_active;
  if not found then
    raise exception 'table_not_found' using errcode = 'P0002';
  end if;

  -- El plato tiene que estar publicado (effective_prices no devuelve fila para uno inactivo o de categoría inactiva), no estar
  -- agotado en esta sucursal y no pedir opciones obligatorias (todavía no se anotan).
  select p.name into v_name from public.products p where p.id = p_product and p.organization_id = v_org;
  if not found then
    raise exception 'product_unavailable' using errcode = 'P0002';
  end if;
  select ep.base_price_cents, ep.price_cents, ep.promotion_id, ep.promotion_name
  into v_base, v_price, v_promo, v_promo_name
  from public.effective_prices(p_branch, p_product) ep;
  if not found then
    raise exception 'product_unavailable' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.product_availability pa where pa.branch_id = p_branch and pa.product_id = p_product and not pa.is_available
  ) then
    raise exception 'product_unavailable' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.option_groups g
    where g.product_id = p_product and g.organization_id = v_org and g.is_active and g.min_choices >= 1
  ) then
    raise exception 'options_required' using errcode = '22023';
  end if;

  -- El pedido abierto de la mesa (o uno nuevo). Dos primeras líneas a la vez terminan en el mismo pedido.
  select o.id into v_order from public.orders o where o.table_id = p_table and o.status = 'open' for update;
  if not found then
    insert into public.orders (organization_id, branch_id, table_id, table_label, opened_by)
    values (v_org, p_branch, p_table, v_label, v_uid)
    on conflict (table_id) where status = 'open' and table_id is not null do nothing
    returning id into v_order;
    if v_order is null then
      select o.id into v_order from public.orders o where o.table_id = p_table and o.status = 'open' for update;
      if not found then
        raise exception 'order_conflict' using errcode = '40001';
      end if;
    end if;
  end if;

  -- Después de esperar los candados (clave y pedido) se vuelve a comprobar quién anota: una membresía, un plan o una mora que
  -- cambiaron mientras esta llamada esperaba no la dejan pasar con la autorización de antes.
  if not private.can_take_orders(v_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;

  select count(*) into v_count from public.order_items i where i.order_id = v_order;
  if v_count >= 200 then
    raise exception 'order_full' using errcode = '53400';
  end if;

  insert into public.order_items (
    organization_id, order_id, product_id, product_name, quantity, base_price_cents, unit_price_cents,
    promotion_id, promotion_name, client_key, request_hash, created_by
  )
  values (v_org, v_order, p_product, v_name, p_quantity, v_base, v_price, v_promo, v_promo_name, p_client_key, v_hash, v_uid)
  returning * into v_item;

  return jsonb_build_object(
    'order_id', v_order, 'item_id', v_item.id, 'product_name', v_item.product_name, 'quantity', v_item.quantity,
    'base_price_cents', v_item.base_price_cents, 'unit_price_cents', v_item.unit_price_cents,
    'promotion_id', v_item.promotion_id, 'promotion_name', v_item.promotion_name, 'replayed', false
  );
end;
$$;
comment on function public.add_order_item(uuid, uuid, uuid, integer, uuid) is
  'Anota una línea sin opciones en el pedido abierto de la mesa (lo abre si no hay), con el precio efectivo que calcula la base (ADR 0041). Solo un miembro con la función en el plan y la cuenta al día. Repetir con la misma clave devuelve la línea ya creada.';
revoke all on function public.add_order_item(uuid, uuid, uuid, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.add_order_item(uuid, uuid, uuid, integer, uuid) to authenticated;

commit;
