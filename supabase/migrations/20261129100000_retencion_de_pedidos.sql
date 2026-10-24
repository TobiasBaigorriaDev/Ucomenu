-- Retención de pedidos (ficha retencion-de-pedidos, ADR 0043; ADR 0041, decisión 8).
--
-- Los pedidos cerrados o anulados se conservan 2 años desde `closed_at` y después se purgan COMPLETOS (pedido, líneas, opciones copiadas
-- y eventos del registro de solo-agregado), por lotes. Un pedido abierto no se purga nunca.
--
--  * `public.purge_expired_orders(p_retention, p_batch)`: SECURITY DEFINER de `postgres` (nadie escribe ni borra estas tablas por la
--    API, ni siquiera `service_role`), `search_path` vacío, EXECUTE solo para `service_role` (como `purge_waiter_calls`).
--  * Piso de 1 año sobre el corte EFECTIVO (`now() - retención`), no comparando intervalos (ver la ficha de la purga de llamados).
--  * Para borrar el registro apaga `order_events_no_update_delete` DENTRO de la transacción y lo vuelve a encender antes de terminar
--    (el mismo recurso de `private.purge_organization_order_events`): si algo falla o se revierte, el trigger queda encendido. Solo lo
--    apaga si hay algo que borrar. Costo: el registro toma un bloqueo de tabla mientras dura el lote (hasta que termina la transacción).
--  * ORDEN DE BLOQUEOS: primero el del registro (`order_events`), después el de las filas de `orders`: el mismo orden que
--    `admin_delete_organization` (apaga el trigger y después borra los pedidos por cascada). El orden inverso permitía un interbloqueo
--    entre la purga y el borrado de una organización (hallazgo de la revisión, ronda 1). Las filas se toman con `skip locked`, así que la
--    purga nunca espera por ellas. Sin nada vencido no toma ningún bloqueo.
--  * Nada la programa ni la llama la aplicación: la dispara quien despliega (pg_cron; `docs/produccion.md`, paso 4.c).
--
-- Rollback (lo ya purgado no vuelve):
--   drop function public.purge_expired_orders(interval, integer);
--   drop index public.orders_closed_at_idx;

begin;

-- El barrido por antigüedad recorre solo lo cerrado o anulado, en orden de cierre.
create index orders_closed_at_idx on public.orders (closed_at) where closed_at is not null;

create function public.purge_expired_orders(
  p_retention interval default interval '2 years',
  p_batch integer default 500
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_ids uuid[];
  v_events integer := 0;
  v_options integer := 0;
  v_items integer := 0;
  v_orders integer := 0;
begin
  if p_retention is null then
    raise exception 'invalid_retention' using errcode = '22023';
  end if;
  begin
    v_cutoff := now() - p_retention;
  exception when datetime_field_overflow then
    raise exception 'invalid_retention' using errcode = '22023';
  end;
  -- Piso sobre el corte efectivo: no se purga nada con menos de 1 año, ni con un corte futuro.
  if v_cutoff > now() - interval '1 year' then
    raise exception 'invalid_retention' using errcode = '22023';
  end if;
  if p_batch is null or p_batch < 1 or p_batch > 5000 then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;

  -- Sin nada vencido no se toma ningún bloqueo (ni se espera a nadie). Es una mirada sin candados: si algo vence o se libera después, lo
  -- toma la corrida siguiente.
  if not exists (select 1 from public.orders o where o.status in ('closed', 'void') and o.closed_at < v_cutoff) then
    return jsonb_build_object('orders', 0, 'items', 0, 'options', 0, 'events', 0, 'cutoff', v_cutoff);
  end if;

  -- El registro de solo-agregado PRIMERO: se apaga su protección solo mientras dura este borrado, dentro de la transacción. Tomar este
  -- bloqueo antes que el de las filas es lo que evita el interbloqueo con `admin_delete_organization`.
  alter table public.order_events disable trigger order_events_no_update_delete;

  -- Los vencidos más viejos, sin esperar a los que otra transacción tiene bloqueados. Solo cerrados o anulados: un pedido abierto no
  -- tiene `closed_at` (orders_closed_check) y además se excluye por estado.
  select coalesce(array_agg(v.id), '{}'::uuid[]) into v_ids
  from (
    select o.id
    from public.orders o
    where o.status in ('closed', 'void') and o.closed_at < v_cutoff
    order by o.closed_at, o.id
    limit p_batch
    for update skip locked
  ) v;

  if cardinality(v_ids) = 0 then
    -- Se los llevó otra corrida, se borraron con su organización o están bloqueados: se devuelve la protección y no se borra nada.
    alter table public.order_events enable trigger order_events_no_update_delete;
    return jsonb_build_object('orders', 0, 'items', 0, 'options', 0, 'events', 0, 'cutoff', v_cutoff);
  end if;

  delete from public.order_events where order_id = any (v_ids);
  get diagnostics v_events = row_count;
  alter table public.order_events enable trigger order_events_no_update_delete;

  delete from public.order_item_options x
  using public.order_items i
  where x.order_item_id = i.id and i.order_id = any (v_ids);
  get diagnostics v_options = row_count;

  delete from public.order_items where order_id = any (v_ids);
  get diagnostics v_items = row_count;

  -- Se vuelve a exigir lo vencido y cerrado: lo borrado arriba ya es de pedidos que cumplían esto (están bloqueados), y el estado de un
  -- pedido cerrado no cambia más.
  delete from public.orders where id = any (v_ids) and status in ('closed', 'void') and closed_at < v_cutoff;
  get diagnostics v_orders = row_count;

  return jsonb_build_object('orders', v_orders, 'items', v_items, 'options', v_options, 'events', v_events, 'cutoff', v_cutoff);
end;
$$;
comment on function public.purge_expired_orders(interval, integer) is
  'Borra, por lotes, los pedidos CERRADOS o ANULADOS hace más de p_retention (por defecto 2 años; piso 1 año) con sus líneas, opciones y eventos del registro. Nunca un pedido abierto. Devuelve cuántos borró de cada cosa. Solo service_role (ADR 0043).';

-- PUBLIC recibe EXECUTE por defecto: se parte de cero.
revoke all on function public.purge_expired_orders(interval, integer) from public, anon, authenticated, service_role;
grant execute on function public.purge_expired_orders(interval, integer) to service_role;

commit;
