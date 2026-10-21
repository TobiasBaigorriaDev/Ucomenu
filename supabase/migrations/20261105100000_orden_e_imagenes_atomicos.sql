-- Reordenamientos y reemplazos de imagen atómicos (nivel C, ficha orden-e-imagenes-atomicos).
--
-- Tres funciones SECURITY INVOKER: corren con los permisos y la RLS de la PERSONA que las llama (rol `authenticated`),
-- así que NO amplían ningún permiso. Los GRANT por columna (`sort_order`, `image_path`, `logo_path`) y las políticas de
-- UPDATE de cada tabla siguen decidiendo quién puede escribir; la función solo agrupa varias escrituras en UNA transacción.
--
--  * reorder_siblings(tabla, organización, ámbito, orden_leído, orden_final): renumera a los «hermanos» (todas las categorías
--    del local; los platos de una categoría; los grupos de un plato; las opciones de un grupo) o no cambia nada. Antes eran N
--    UPDATE sueltos: si uno fallaba quedaba un orden mezclado. Bloquea a TODOS los hermanos (FOR UPDATE, por id: sin
--    interbloqueos) y exige que sigan siendo exactamente los que la persona leyó (mismos ids y mismas posiciones); si otro
--    movimiento se coló en el medio responde 55000 `order_changed` y el servidor reintenta con la lectura nueva. (No es 40001: PostgREST reintenta
--    ese código por su cuenta, y como el estado no cambia el pedido queda reintentándose sin fin.)
--  * replace_product_image(organización, plato, ruta) y replace_organization_logo(organización, ruta): cambian la referencia
--    a una imagen (o la quitan con NULL) y DEVUELVEN la referencia saliente tal como estaba al bloquear la fila. Quien limpia
--    Storage borra exactamente esa ruta, no «lo que leyó antes»: con dos reemplazos simultáneos cada archivo saliente lo
--    borra quien lo desplazó, y nadie borra el vigente ni una subida ajena.
--
-- Errores: 55000 order_changed · 22023 order_invalid / invalid_table · 42501 order_forbidden (nada visible para quien pide:
-- cuenta en solo lectura o sin permiso; el servidor lo explica leyendo el estado de la cuenta).
--
-- Rollback (sin datos que migrar). ORDEN OBLIGATORIO: el código de la aplicación de esta tanda (commit bd52a08 y siguientes)
-- llama a estas tres funciones para mover elementos y para cambiar o quitar fotos y logos; si se las retira con ese código
-- desplegado, esas acciones fallan por función inexistente. Primero se despliega el código ANTERIOR (el commit previo a esa
-- tanda, que escribe fila por fila y no usa las funciones) y recién después:
--   drop function public.reorder_siblings(text, uuid, uuid, jsonb, uuid[]);
--   drop function public.replace_product_image(uuid, uuid, text);
--   drop function public.replace_organization_logo(uuid, text);

create function public.reorder_siblings(
  p_table text,
  p_org uuid,
  p_scope uuid,
  p_current jsonb,
  p_final uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_locked jsonb;
  v_expected jsonb;
  v_need integer;
  v_done integer;
begin
  if p_table not in ('categories', 'products', 'option_groups', 'options') then
    raise exception 'invalid_table' using errcode = '22023';
  end if;
  if p_table <> 'categories' and p_scope is null then
    raise exception 'order_invalid' using errcode = '22023';
  end if;

  -- 1) Bloquear a todos los hermanos, siempre en el mismo orden (por id), y leerlos DESDE el bloqueo: con RLS, `FOR UPDATE` solo
  --    toma las filas que la persona puede actualizar (en solo lectura no toma ninguna), así que lo leído es lo escribible.
  if p_table = 'categories' then
    select coalesce(jsonb_agg(jsonb_build_object('id', l.id::text, 'sort_order', l.sort_order) order by l.id), '[]'::jsonb)
      into v_locked
      from (select t.id, t.sort_order from public.categories t where t.organization_id = p_org order by t.id for update) l;
  elsif p_table = 'products' then
    select coalesce(jsonb_agg(jsonb_build_object('id', l.id::text, 'sort_order', l.sort_order) order by l.id), '[]'::jsonb)
      into v_locked
      from (select t.id, t.sort_order from public.products t where t.organization_id = p_org and t.category_id = p_scope order by t.id for update) l;
  elsif p_table = 'option_groups' then
    select coalesce(jsonb_agg(jsonb_build_object('id', l.id::text, 'sort_order', l.sort_order) order by l.id), '[]'::jsonb)
      into v_locked
      from (select t.id, t.sort_order from public.option_groups t where t.organization_id = p_org and t.product_id = p_scope order by t.id for update) l;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id', l.id::text, 'sort_order', l.sort_order) order by l.id), '[]'::jsonb)
      into v_locked
      from (select t.id, t.sort_order from public.options t where t.organization_id = p_org and t.group_id = p_scope order by t.id for update) l;
  end if;

  -- 2) Lo leído tiene que ser exactamente lo que hay ahora.
  select coalesce(jsonb_agg(jsonb_build_object('id', lower(e->>'id'), 'sort_order', (e->>'sort_order')::integer) order by lower(e->>'id')), '[]'::jsonb)
    into v_expected
  from jsonb_array_elements(coalesce(p_current, '[]'::jsonb)) e;

  if v_locked = '[]'::jsonb and v_expected <> '[]'::jsonb then
    raise exception 'order_forbidden' using errcode = '42501';
  end if;
  if v_locked <> v_expected then
    raise exception 'order_changed' using errcode = '55000';
  end if;

  -- 3) El orden final es una permutación de esos mismos ids.
  if cardinality(p_final) <> jsonb_array_length(v_locked)
     or (select count(distinct f) from unnest(p_final) f) <> cardinality(p_final)
     or exists (select 1 from unnest(p_final) f where not (f::text in (select e->>'id' from jsonb_array_elements(v_locked) e))) then
    raise exception 'order_invalid' using errcode = '22023';
  end if;

  -- 4) Renumerar 0, 1, 2… solo lo que cambia. Cada fila que tenía que cambiar tiene que haber cambiado: un UPDATE filtrado por RLS
  --    afecta 0 filas SIN error, y eso nunca puede pasar por un éxito.
  select count(*) into v_need
  from unnest(p_final) with ordinality as f(id, n)
  join jsonb_array_elements(v_locked) e on e->>'id' = f.id::text
  where (e->>'sort_order')::integer is distinct from f.n::integer - 1;

  if p_table = 'categories' then
    with changed as (
      update public.categories t set sort_order = f.n::integer - 1
        from unnest(p_final) with ordinality as f(id, n)
        where t.id = f.id and t.organization_id = p_org and t.sort_order is distinct from f.n::integer - 1
        returning 1)
    select count(*) into v_done from changed;
  elsif p_table = 'products' then
    with changed as (
      update public.products t set sort_order = f.n::integer - 1
        from unnest(p_final) with ordinality as f(id, n)
        where t.id = f.id and t.organization_id = p_org and t.sort_order is distinct from f.n::integer - 1
        returning 1)
    select count(*) into v_done from changed;
  elsif p_table = 'option_groups' then
    with changed as (
      update public.option_groups t set sort_order = f.n::integer - 1
        from unnest(p_final) with ordinality as f(id, n)
        where t.id = f.id and t.organization_id = p_org and t.sort_order is distinct from f.n::integer - 1
        returning 1)
    select count(*) into v_done from changed;
  else
    with changed as (
      update public.options t set sort_order = f.n::integer - 1
        from unnest(p_final) with ordinality as f(id, n)
        where t.id = f.id and t.organization_id = p_org and t.sort_order is distinct from f.n::integer - 1
        returning 1)
    select count(*) into v_done from changed;
  end if;

  if v_done <> v_need then
    raise exception 'order_forbidden' using errcode = '42501';
  end if;
end;
$$;
comment on function public.reorder_siblings(text, uuid, uuid, jsonb, uuid[]) is
  'Renumera a los hermanos de un orden de la carta en una sola transacción, bloqueándolos y comprobando que siguen como se leyeron (55000 order_changed si no). SECURITY INVOKER: manda la RLS de quien llama.';

create function public.replace_product_image(p_org uuid, p_product uuid, p_path text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous text;
begin
  select p.image_path into v_previous
  from public.products p where p.id = p_product and p.organization_id = p_org for update;
  if not found then
    return jsonb_build_object('updated', false);
  end if;
  update public.products set image_path = p_path where id = p_product and organization_id = p_org;
  if not found then
    return jsonb_build_object('updated', false);
  end if;
  return jsonb_build_object('updated', true, 'previous', v_previous);
end;
$$;
comment on function public.replace_product_image(uuid, uuid, text) is
  'Cambia (o quita, con NULL) la foto de un plato y devuelve la referencia saliente tal como estaba al bloquear la fila. SECURITY INVOKER: manda la RLS de quien llama.';

create function public.replace_organization_logo(p_org uuid, p_path text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous text;
begin
  select o.logo_path into v_previous from public.organizations o where o.id = p_org for update;
  if not found then
    return jsonb_build_object('updated', false);
  end if;
  update public.organizations set logo_path = p_path where id = p_org;
  if not found then
    return jsonb_build_object('updated', false);
  end if;
  return jsonb_build_object('updated', true, 'previous', v_previous);
end;
$$;
comment on function public.replace_organization_logo(uuid, text) is
  'Cambia (o quita, con NULL) el logo de una organización y devuelve la referencia saliente tal como estaba al bloquear la fila. SECURITY INVOKER: manda la RLS de quien llama.';

revoke all on function public.reorder_siblings(text, uuid, uuid, jsonb, uuid[]) from public, anon;
revoke all on function public.replace_product_image(uuid, uuid, text) from public, anon;
revoke all on function public.replace_organization_logo(uuid, text) from public, anon;
grant execute on function public.reorder_siblings(text, uuid, uuid, jsonb, uuid[]) to authenticated;
grant execute on function public.replace_product_image(uuid, uuid, text) to authenticated;
grant execute on function public.replace_organization_logo(uuid, text) to authenticated;
