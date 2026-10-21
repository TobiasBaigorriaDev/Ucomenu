-- Carta central con precio, disponibilidad y visibilidad por sucursal (nivel C; ficha agile/cambios/carta-por-sucursal.md,
-- ADR 0035). Aditiva: dos columnas, una columna del historial, un trigger y una RPC. No cambia ninguna política, límite de plan
-- ni permiso de lectura existente.
--
-- La organización conserva UN catálogo. Cada sucursal puede, sin afectar a las demás, tener un precio propio de un plato,
-- marcarlo agotado (ya existía) y ocultarlo. Un ajuste es una fila de `product_availability`; la fila es opcional: sin fila =
-- visible, disponible y con el precio base (comportamiento de siempre).
--
--  * product_availability.price_cents: precio propio de la sucursal (centavos enteros, igual que products.price_cents). NULL =
--    hereda el precio base; 0 es un precio válido (no es «sin precio»).
--  * product_availability.is_visible: false = el plato no aparece en la carta de esa sucursal (listado, búsqueda ni detalle).
--    Es presentación, no confidencialidad: el catálogo central sigue siendo público por RLS.
--  * price_history.branch_id: NULL = precio base. Un trigger registra cada cambio EFECTIVO del precio de una sucursal (el precio
--    propio contra el efectivo anterior, que puede ser el base); un precio igual al efectivo no registra nada.
--  * create_product_in_branches: crea un plato y lo oculta en las sucursales pedidas en UNA transacción (SECURITY INVOKER: manda
--    la RLS de quien llama, así que el cupo del plan, la cuenta editable y el aislamiento siguen siendo los de siempre).
--
-- Los límites del plan no cambian (`enforce_product_limit` cuenta products.is_active por organización): un plato en varias
-- sucursales cuenta una vez y los ajustes locales no consumen ni liberan cupo.
--
-- Rollback (los ajustes de precio y visibilidad se pierden; el agotado y el catálogo no se tocan). ORDEN: desplegar primero el
-- código ANTERIOR (el nuevo llama a la RPC y lee las columnas nuevas) y recién después:
--   drop function public.create_product_in_branches(uuid, uuid, text, text, integer, integer, boolean, text[], uuid[]);
--   drop trigger product_availability_record_price_insert on public.product_availability;
--   drop trigger product_availability_record_price_update on public.product_availability;
--   drop function private.record_branch_price_change();
--   alter table public.product_availability drop column price_cents, drop column is_visible;
--   -- price_history.branch_id: CONSERVAR la columna y sus filas (es un registro de auditoría de solo-agregado: no se borra ni se
--   -- copia a otra tabla sin sus protecciones y su purga, ADR 0026). Si no hay filas con branch_id: 
--   --   alter table public.price_history drop column branch_id;
-- LIMITACIÓN DEL ROLLBACK (decisión pendiente, ver la ficha): el código anterior lee `price_history` sin conocer `branch_id`, así que
-- las filas de una sucursal se mostrarían mezcladas con las del precio general. Los datos no se pierden; para leerlos bien hay que
-- volver al código nuevo o consultar la columna `branch_id` directamente.

alter table public.product_availability
  add column is_visible boolean not null default true,
  add column price_cents integer check (price_cents >= 0);

comment on table public.product_availability is
  'Ajustes de UNA sucursal sobre un plato del catálogo central (opcionales: sin fila = visible, disponible y con el precio base): agotado (is_available), oculto (is_visible = false) y precio propio (price_cents; NULL = hereda, 0 es un precio). Ver ADR 0035.';
comment on column public.product_availability.price_cents is
  'Precio propio de la sucursal en centavos; NULL = hereda products.price_cents (0 es un precio válido).';
comment on column public.product_availability.is_visible is
  'false = el plato no aparece en la carta de esta sucursal (listado, búsqueda ni detalle). Presentación, no confidencialidad.';

-- Las claves siguen siendo inmutables; se suman a los permisos de escritura las dos columnas nuevas (las políticas de INSERT y
-- UPDATE ya exigen miembro de la organización y cuenta editable).
grant insert (is_visible, price_cents) on public.product_availability to authenticated;
grant update (is_visible, price_cents) on public.product_availability to authenticated;

-- ---------------------------------------------------------------------------
-- Historial de precios por sucursal
-- ---------------------------------------------------------------------------

alter table public.price_history add column branch_id uuid;
comment on column public.price_history.branch_id is
  'NULL = cambio del precio base (products.price_cents). Con valor = cambio del precio propio de esa sucursal, de precio efectivo a precio efectivo. Sin clave foránea: sobrevive a la sucursal.';

create function private.record_branch_price_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base integer;
  v_old integer;
  v_new integer;
begin
  select p.price_cents into v_base
  from public.products p
  where p.id = new.product_id and p.organization_id = new.organization_id;
  if not found then
    return null;
  end if;

  -- Precio EFECTIVO antes y después: el propio de la sucursal o, si no tiene, el base.
  v_old := case when tg_op = 'INSERT' then v_base else coalesce(old.price_cents, v_base) end;
  v_new := coalesce(new.price_cents, v_base);

  if v_old is distinct from v_new then
    insert into public.price_history (organization_id, product_id, branch_id, changed_by, old_price_cents, new_price_cents)
    values (new.organization_id, new.product_id, new.branch_id, (select auth.uid()), v_old, v_new);
  end if;
  return null;
end;
$$;

-- AFTER: la fila ya pasó la RLS y las demás comprobaciones. INSERT y UPDATE van en triggers separados porque OLD no existe en
-- un INSERT.
create trigger product_availability_record_price_insert
  after insert on public.product_availability
  for each row
  when (new.price_cents is not null)
  execute function private.record_branch_price_change();

create trigger product_availability_record_price_update
  after update of price_cents on public.product_availability
  for each row
  when (old.price_cents is distinct from new.price_cents)
  execute function private.record_branch_price_change();

revoke all on function private.record_branch_price_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Alta de un plato decidiendo en qué sucursales se muestra
-- ---------------------------------------------------------------------------

create function public.create_product_in_branches(
  p_org uuid,
  p_category uuid,
  p_name text,
  p_description text,
  p_price_cents integer,
  p_sort_order integer,
  p_is_active boolean,
  p_dietary_tags text[],
  p_hidden_branches uuid[]
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_product uuid;
begin
  insert into public.products (organization_id, category_id, name, description, price_cents, sort_order, is_active, dietary_tags)
  values (p_org, p_category, p_name, p_description, p_price_cents, p_sort_order, p_is_active, coalesce(p_dietary_tags, '{}'::text[]))
  returning id into v_product;

  -- Una fila de «oculto» por sucursal pedida. La clave foránea compuesta (sucursal, organización) rechaza una sucursal de otra
  -- organización; cualquier error revierte también el plato.
  insert into public.product_availability (organization_id, branch_id, product_id, is_visible)
  select p_org, b, v_product, false
  from (select distinct unnest(coalesce(p_hidden_branches, '{}'::uuid[])) as b) h;

  return v_product;
end;
$$;
comment on function public.create_product_in_branches(uuid, uuid, text, text, integer, integer, boolean, text[], uuid[]) is
  'Crea un plato y lo oculta en las sucursales pedidas, todo en una transacción. SECURITY INVOKER: manda la RLS de quien llama (cupo del plan, cuenta editable, aislamiento).';

revoke all on function public.create_product_in_branches(uuid, uuid, text, text, integer, integer, boolean, text[], uuid[]) from public, anon;
grant execute on function public.create_product_in_branches(uuid, uuid, text, text, integer, integer, boolean, text[], uuid[]) to authenticated;
