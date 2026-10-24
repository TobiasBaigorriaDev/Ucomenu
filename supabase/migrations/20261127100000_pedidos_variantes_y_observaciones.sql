-- Variantes, adicionales y observaciones en las líneas del pedido (ficha agile/cambios/pedidos-variantes-adicionales-observaciones.md,
-- ADR 0041), sobre 20261126100000_pedidos_esquema.sql.
--
-- Qué hace:
--  * `order_items` gana `note` (observación de una línea, 1 a 200 caracteres) y `options_cents` (suma de las diferencias de las
--    opciones elegidas; bigint porque 50 opciones de hasta 1.000.000.000 no caben en integer).
--  * Tabla `order_item_options`: una fila por opción elegida, con el nombre del grupo, el de la opción y la diferencia COPIADOS.
--    Como el resto de los pedidos: la leen los miembros de la organización y NADIE la escribe por la API (ni `service_role`).
--  * `options` gana `unique (id, organization_id)` (la clave foránea compuesta de la copia: ninguna opción de otra organización).
--  * `public.add_order_item` pasa a siete parámetros (`p_options uuid[]`, `p_note text`, ambos con valor por defecto, así que las
--    llamadas de cinco siguen valiendo). La base valida las opciones contra el catálogo: activas, de un grupo activo DE ESTE
--    plato, sin repetir, y los mínimos y máximos de cada grupo activo del plato. El cliente solo manda ids.
--  * El precio de una unidad es `unit_price_cents` (efectivo, con promoción) + `options_cents`; las promociones no tocan las opciones.
--
-- Errores nuevos (22023): invalid_options (opción ajena, inactiva, repetida, nula, inexistente o más de 50) · options_required
-- (menos que el mínimo de un grupo activo, o grupo obligatorio sin opciones activas) · options_exceeded (más que el máximo) ·
-- invalid_note. Los demás son los de la migración anterior.
--
-- Aditiva salvo el reemplazo de la función. Rollback (local): git revert + `pnpm db:reset`. En una base con datos reales: exportar
-- `order_item_options` y las columnas nuevas, y después
--   1. drop function public.add_order_item(uuid, uuid, uuid, integer, uuid, uuid[], text);
--   2. volver a crear la función de cinco parámetros con el cuerpo de 20261126100000_pedidos_esquema.sql (con sus permisos);
--   3. drop table public.order_item_options; alter table public.order_items drop column note, drop column options_cents;
--   4. alter table public.options drop constraint options_id_organization_key.

begin;

alter table public.options add constraint options_id_organization_key unique (id, organization_id);

alter table public.order_items
  add column note text,
  add column options_cents bigint not null default 0,
  add constraint order_items_note_check check (note is null or (note = btrim(note) and char_length(note) between 1 and 200 and note !~ '[[:cntrl:]]')),
  add constraint order_items_options_cents_check check (options_cents >= 0);
-- Necesario para la clave foránea compuesta de las opciones copiadas.
alter table public.order_items add constraint order_items_id_organization_key unique (id, organization_id);

create table public.order_item_options (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  order_item_id uuid not null,
  -- Nulo si se borra la opción: la línea conserva los nombres y la diferencia copiados. `group_id` es solo una copia (sin clave).
  option_id uuid,
  group_id uuid,
  group_name text not null,
  option_name text not null,
  price_delta_cents integer not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint order_item_options_names_check check (char_length(btrim(group_name)) between 1 and 80 and char_length(btrim(option_name)) between 1 and 80),
  constraint order_item_options_delta_check check (price_delta_cents between 0 and 1000000000),
  foreign key (order_item_id, organization_id) references public.order_items (id, organization_id) on delete cascade,
  foreign key (option_id, organization_id) references public.options (id, organization_id) on delete set null (option_id)
);
comment on table public.order_item_options is
  'Opciones (variantes y adicionales) elegidas en una línea de pedido (ADR 0041): nombre del grupo, de la opción y diferencia de precio copiados al anotarla. Se escribe solo con add_order_item.';

create unique index order_item_options_item_option_key on public.order_item_options (order_item_id, option_id) where option_id is not null;
create index order_item_options_item_idx on public.order_item_options (order_item_id);
create index order_item_options_organization_idx on public.order_item_options (organization_id);
create index order_item_options_option_idx on public.order_item_options (option_id) where option_id is not null;

alter table public.order_item_options enable row level security;
revoke all on table public.order_item_options from anon, authenticated;
create policy "order_item_options: lectura de miembros"
  on public.order_item_options for select to authenticated
  using (private.is_org_member(organization_id));
grant select on table public.order_item_options to authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.order_item_options from service_role;

-- ---------------------------------------------------------------------------
-- Alta de una línea con opciones y observación
-- ---------------------------------------------------------------------------

drop function public.add_order_item(uuid, uuid, uuid, integer, uuid);

create function public.add_order_item(
  p_branch uuid,
  p_table uuid,
  p_product uuid,
  p_quantity integer,
  p_client_key uuid,
  p_options uuid[] default '{}',
  p_note text default null
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
  v_options uuid[];
  v_note text;
  v_ins integer;
  v_opts jsonb;
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

  -- Opciones y nota: validación de forma (lo que depende del catálogo se mira después de los candados).
  v_options := coalesce(p_options, '{}'::uuid[]);
  if cardinality(v_options) > 50
     or (select count(distinct s.id) from unnest(v_options) as s(id)) <> cardinality(v_options) then
    raise exception 'invalid_options' using errcode = '22023';
  end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and (char_length(v_note) > 200 or v_note ~ '[[:cntrl:]]') then
    raise exception 'invalid_note' using errcode = '22023';
  end if;

  -- Mismo toque repetido a la vez: se serializa por clave, así la segunda llamada ve la línea de la primera.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || p_client_key::text, 0));
  -- Esperar el candado puede llevar tiempo: también el reintento (que devuelve la línea) revalida quién llama.
  if not private.can_take_orders(v_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  -- Sin opciones ni nota, la huella es la de la migración anterior (mesa|plato|cantidad): un reintento de una línea creada antes
  -- sigue valiendo. Con ellas, también cubre las opciones (ordenadas) y la nota normalizada.
  v_hash := md5(case
    when cardinality(v_options) = 0 and v_note is null then format('%s|%s|%s', p_table, p_product, p_quantity)
    else format('%s|%s|%s|%s|%s', p_table, p_product, p_quantity,
                (select string_agg(s.id::text, ',' order by s.id) from unnest(v_options) as s(id)), v_note)
  end);
  select i.* into v_item from public.order_items i where i.organization_id = v_org and i.client_key = p_client_key;
  if found then
    if v_item.request_hash <> v_hash then
      raise exception 'client_key_reused' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'option_id', x.option_id, 'group_name', x.group_name, 'option_name', x.option_name, 'price_delta_cents', x.price_delta_cents
    ) order by x.created_at, x.id), '[]'::jsonb)
    into v_opts from public.order_item_options x where x.order_item_id = v_item.id;
    return jsonb_build_object(
      'order_id', v_item.order_id, 'item_id', v_item.id, 'product_name', v_item.product_name, 'quantity', v_item.quantity,
      'base_price_cents', v_item.base_price_cents, 'unit_price_cents', v_item.unit_price_cents,
      'options_cents', v_item.options_cents, 'options', v_opts, 'note', v_item.note,
      'promotion_id', v_item.promotion_id, 'promotion_name', v_item.promotion_name, 'replayed', true
    );
  end if;

  select t.label into v_label
  from public.tables t
  where t.id = p_table and t.branch_id = p_branch and t.organization_id = v_org and t.is_active;
  if not found then
    raise exception 'table_not_found' using errcode = 'P0002';
  end if;

  -- El plato tiene que estar publicado (effective_prices no devuelve fila para uno inactivo o de categoría inactiva) y no estar
  -- agotado en esta sucursal.
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

  -- Las opciones se validan contra el catálogo de AHORA (ya sin esperas): cada una, activa y de un grupo activo de este plato; y
  -- cada grupo activo del plato, dentro de su mínimo y su máximo (un grupo obligatorio sin opciones activas no se puede cumplir).
  if exists (
    select 1 from unnest(v_options) as s(id)
    where not exists (
      select 1
      from public.options o
      join public.option_groups g on g.id = o.group_id and g.organization_id = o.organization_id
      where o.id = s.id and o.organization_id = v_org and o.is_active and g.is_active and g.product_id = p_product
    )
  ) then
    raise exception 'invalid_options' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.option_groups g
    where g.product_id = p_product and g.organization_id = v_org and g.is_active
      and (select count(*) from public.options o where o.group_id = g.id and o.id = any (v_options)) < g.min_choices
  ) then
    raise exception 'options_required' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.option_groups g
    where g.product_id = p_product and g.organization_id = v_org and g.is_active
      and (select count(*) from public.options o where o.group_id = g.id and o.id = any (v_options)) > g.max_choices
  ) then
    raise exception 'options_exceeded' using errcode = '22023';
  end if;

  select count(*) into v_count from public.order_items i where i.order_id = v_order;
  if v_count >= 200 then
    raise exception 'order_full' using errcode = '53400';
  end if;

  insert into public.order_items (
    organization_id, order_id, product_id, product_name, quantity, base_price_cents, unit_price_cents, note,
    promotion_id, promotion_name, client_key, request_hash, created_by
  )
  values (v_org, v_order, p_product, v_name, p_quantity, v_base, v_price, v_note, v_promo, v_promo_name, p_client_key, v_hash, v_uid)
  returning * into v_item;

  insert into public.order_item_options (organization_id, order_item_id, option_id, group_id, group_name, option_name, price_delta_cents)
  select v_org, v_item.id, o.id, g.id, g.name, o.name, o.price_delta_cents
  from unnest(v_options) as s(id)
  join public.options o on o.id = s.id and o.organization_id = v_org and o.is_active
  join public.option_groups g on g.id = o.group_id and g.organization_id = v_org and g.is_active and g.product_id = p_product
  -- Orden de la carta (grupo y opción); si empatan, el más antiguo primero: el resultado no depende de los ids.
  order by g.sort_order, g.created_at, g.id, o.sort_order, o.created_at, o.id;
  -- Lo copiado es la fuente de verdad: si una opción dejó de estar activa (o su grupo) entre la validación y la copia, faltan filas y
  -- se rechaza (todo se deshace); y el total de la línea se calcula SOBRE lo copiado, así que nunca contradice las diferencias que
  -- quedaron guardadas aunque el catálogo cambie a mitad de la llamada.
  get diagnostics v_ins = row_count;
  if v_ins <> cardinality(v_options) then
    raise exception 'invalid_options' using errcode = '22023';
  end if;
  update public.order_items i
  set options_cents = (select coalesce(sum(x.price_delta_cents), 0) from public.order_item_options x where x.order_item_id = i.id)
  where i.id = v_item.id
  returning * into v_item;

  select coalesce(jsonb_agg(jsonb_build_object(
    'option_id', x.option_id, 'group_name', x.group_name, 'option_name', x.option_name, 'price_delta_cents', x.price_delta_cents
  ) order by x.created_at, x.id), '[]'::jsonb)
  into v_opts from public.order_item_options x where x.order_item_id = v_item.id;

  return jsonb_build_object(
    'order_id', v_order, 'item_id', v_item.id, 'product_name', v_item.product_name, 'quantity', v_item.quantity,
    'base_price_cents', v_item.base_price_cents, 'unit_price_cents', v_item.unit_price_cents,
    'options_cents', v_item.options_cents, 'options', v_opts, 'note', v_item.note,
    'promotion_id', v_item.promotion_id, 'promotion_name', v_item.promotion_name, 'replayed', false
  );
end;
$$;
comment on function public.add_order_item(uuid, uuid, uuid, integer, uuid, uuid[], text) is
  'Anota una línea en el pedido abierto de la mesa (lo abre si no hay), con el precio efectivo y las diferencias de las opciones que calcula la base, las opciones validadas contra el catálogo y una observación (ADR 0041). Solo un miembro con la función en el plan y la cuenta al día. Repetir con la misma clave devuelve la línea ya creada.';
revoke all on function public.add_order_item(uuid, uuid, uuid, integer, uuid, uuid[], text) from public, anon, authenticated, service_role;
grant execute on function public.add_order_item(uuid, uuid, uuid, integer, uuid, uuid[], text) to authenticated;

commit;
