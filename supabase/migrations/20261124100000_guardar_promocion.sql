-- Guardar una promoción con sus platos, categorías y sucursales en UNA transacción (nivel M). Ficha:
-- agile/cambios/panel-de-promociones.md · ADR 0040 · migración base 20261123100000_promociones_y_precio_efectivo.sql.
--
-- `public.save_promotion(...)` crea (p_id nulo) o edita una promoción y deja sus objetivos y sus sucursales exactamente como las listas
-- pedidas: quita los que sobran y agrega los que faltan. Sin esto el panel tendría que hacer varias llamadas y un fallo en el medio
-- dejaría una promoción a medias (por ejemplo, sin sus platos).
--
-- SECURITY INVOKER a propósito: corre con los permisos y la RLS de quien llama, así que solo la guarda el Dueño con la cuenta al día y
-- la función en el plan (`private.can_manage_promotions`), con los mismos privilegios por columna, las mismas claves compuestas
-- (un plato o una sucursal de otra organización falla con 23503) y el mismo historial por trigger que las escrituras directas. No
-- amplía ningún permiso. Cualquier error revierte todo.
--
-- Errores: `promotion_not_found` (P0002) si `p_id` no existe en `p_org`; los demás son los de las tablas (23514 valores fuera de regla,
-- 23503 objetos de otra organización, 42501 sin permiso).
--
-- Rollback: `drop function public.save_promotion(uuid, uuid, text, text, integer, integer, integer, integer, date, date, boolean, boolean, uuid[], uuid[], uuid[]);`
-- (las promociones guardadas no se tocan).

create function public.save_promotion(
  p_org uuid,
  p_id uuid,
  p_name text,
  p_discount_type text,
  p_discount_value integer,
  p_weekdays_mask integer,
  p_start_minute integer,
  p_end_minute integer,
  p_starts_on date,
  p_ends_on date,
  p_all_branches boolean,
  p_is_active boolean,
  p_products uuid[],
  p_categories uuid[],
  p_branches uuid[]
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_products uuid[] := coalesce(p_products, '{}'::uuid[]);
  v_categories uuid[] := coalesce(p_categories, '{}'::uuid[]);
  v_branches uuid[] := case when p_all_branches then '{}'::uuid[] else coalesce(p_branches, '{}'::uuid[]) end;
begin
  if p_id is null then
    insert into public.promotions
      (organization_id, name, discount_type, discount_value, weekdays_mask, start_minute, end_minute, starts_on, ends_on, all_branches, is_active)
    values
      (p_org, p_name, p_discount_type, p_discount_value, p_weekdays_mask, p_start_minute, p_end_minute, p_starts_on, p_ends_on, p_all_branches, p_is_active)
    returning id into v_id;
  else
    update public.promotions
    set name = p_name, discount_type = p_discount_type, discount_value = p_discount_value, weekdays_mask = p_weekdays_mask,
        start_minute = p_start_minute, end_minute = p_end_minute, starts_on = p_starts_on, ends_on = p_ends_on,
        all_branches = p_all_branches, is_active = p_is_active
    where id = p_id and organization_id = p_org
    returning id into v_id;
    if v_id is null then
      raise exception 'promotion_not_found' using errcode = 'P0002';
    end if;
  end if;

  -- Platos y categorías: quita los que ya no están y agrega los nuevos (las filas que se mantienen no se tocan: no dejan constancia).
  delete from public.promotion_targets t
  where t.promotion_id = v_id
    and not ((t.product_id is not null and t.product_id = any (v_products))
          or (t.category_id is not null and t.category_id = any (v_categories)));

  insert into public.promotion_targets (organization_id, promotion_id, product_id)
  select p_org, v_id, x from (select distinct unnest(v_products) as x) s
  on conflict (promotion_id, product_id) where product_id is not null do nothing;

  insert into public.promotion_targets (organization_id, promotion_id, category_id)
  select p_org, v_id, x from (select distinct unnest(v_categories) as x) s
  on conflict (promotion_id, category_id) where category_id is not null do nothing;

  -- Sucursales: con «todas» no queda ninguna fila.
  delete from public.promotion_branches b
  where b.promotion_id = v_id and not (b.branch_id = any (v_branches));

  insert into public.promotion_branches (organization_id, promotion_id, branch_id)
  select p_org, v_id, x from (select distinct unnest(v_branches) as x) s
  on conflict (promotion_id, branch_id) do nothing;

  return v_id;
end;
$$;
comment on function public.save_promotion(uuid, uuid, text, text, integer, integer, integer, integer, date, date, boolean, boolean, uuid[], uuid[], uuid[]) is
  'Crea (p_id nulo) o edita una promoción y deja sus platos, categorías y sucursales como las listas pedidas, en una transacción. SECURITY INVOKER: manda la RLS del Dueño (ADR 0040).';

revoke all on function public.save_promotion(uuid, uuid, text, text, integer, integer, integer, integer, date, date, boolean, boolean, uuid[], uuid[], uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.save_promotion(uuid, uuid, text, text, integer, integer, integer, integer, date, date, boolean, boolean, uuid[], uuid[], uuid[])
  to authenticated;
