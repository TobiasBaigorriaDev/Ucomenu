-- Turno de mesa (ficha agile/cambios/turno-de-mesa.md, ADR 0044), sobre 20261128100000.
--
-- Qué hace:
--  * `tables.turn_started_at`: inicio del turno vigente de la mesa. Las mesas existentes arrancan en la fecha de esta migración.
--    Ningún rol de la API puede escribirla (los permisos de columna de `tables` no la incluyen): solo la mueven `close_order`,
--    `void_order` y `reset_table_turn`.
--  * `close_order` y `void_order` (misma firma, mismos permisos, `create or replace`): cuando cambian el estado de un pedido con mesa,
--    mueven el turno de esa mesa en la MISMA transacción. Repetir un cierre o una anulación (`unchanged`) no lo mueve. Siguen sin
--    bloquearse por mora, suspensión ni plan.
--  * `reset_table_turn(p_table)`: cualquier miembro de la organización de la mesa reinicia el turno a mano. Mesa inexistente o de otra
--    organización: el mismo error. Nunca depende del plan ni de la mora.
--  * `private.ticket_in_turn(p_table, p_ticket_at)`: ¿el ticket de visita se emitió DESPUÉS del inicio del turno? Comparación estricta
--    (un ticket de la misma emisión que la rotación no vale: ante la duda se pide escanear de nuevo). La usa la cuenta del comensal.
--
-- El `qr_token` y la ruta `/t/{token}` no cambian: lo que se renueva es qué tickets ven la cuenta, no el QR impreso.
--
-- Orden de bloqueos: pedido (`for update`) y después la fila de la mesa (UPDATE de una columna que no es clave: no choca con el
-- `FOR KEY SHARE` que toma la clave foránea de `orders` ni con `add_order_item`, que solo lee la mesa).
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos:
--   begin;
--   drop function public.reset_table_turn(uuid);
--   drop function private.ticket_in_turn(uuid, timestamptz);
--   -- volver a crear close_order y void_order con el cuerpo de 20261128100000 (sin el UPDATE de la mesa);
--   alter table public.tables drop column turn_started_at;
--   commit;

begin;

alter table public.tables add column turn_started_at timestamptz not null default now();
comment on column public.tables.turn_started_at is
  'Inicio del turno vigente de la mesa. Lo mueven close_order, void_order y reset_table_turn; un ticket de visita emitido antes ya no ve la cuenta (ADR 0044).';

create function private.ticket_in_turn(p_table uuid, p_ticket_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_ticket_at is not null
    and exists (select 1 from public.tables t where t.id = p_table and p_ticket_at > t.turn_started_at);
$$;
revoke all on function private.ticket_in_turn(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.close_order(p_order uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_table uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  select o.organization_id, o.table_id into v_org, v_table from public.orders o where o.id = p_order;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  -- Solo ser miembro: cerrar nunca depende del plan ni de la mora (ADR 0041, decisión 5).
  if not private.is_org_member(v_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  select o.status, o.table_id into v_status, v_table from public.orders o where o.id = p_order for update;
  if not private.is_org_member(v_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  if v_status = 'closed' then
    return jsonb_build_object('order_id', p_order, 'status', v_status, 'unchanged', true);
  end if;
  if v_status <> 'open' then
    raise exception 'order_not_open' using errcode = '55000';
  end if;
  update public.orders set status = 'closed', closed_at = clock_timestamp(), closed_by = v_uid where id = p_order;
  -- El turno de la mesa termina con el cobro (ADR 0044). Una mesa borrada (table_id nulo) no tiene turno que mover.
  if v_table is not null then
    update public.tables set turn_started_at = clock_timestamp() where id = v_table;
  end if;
  return jsonb_build_object('order_id', p_order, 'status', 'closed', 'unchanged', false);
end;
$$;
comment on function public.close_order(uuid) is
  'Cierra un pedido abierto y reinicia el turno de su mesa. Solo ser miembro de la organización: nunca se bloquea por mora, suspensión ni plan (ADR 0041, 0044). Repetir devuelve unchanged y no mueve el turno.';

create or replace function public.void_order(p_order uuid, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_table uuid;
  v_status text;
  v_reason text;
begin
  if v_uid is null then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  select o.organization_id, o.table_id into v_org, v_table from public.orders o where o.id = p_order;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if not private.is_org_member(v_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if char_length(v_reason) > 200 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  select o.status, o.table_id into v_status, v_table from public.orders o where o.id = p_order for update;
  if not private.is_org_member(v_org) then
    raise exception 'orders_not_allowed' using errcode = '42501';
  end if;
  if v_status = 'void' then
    return jsonb_build_object('order_id', p_order, 'status', v_status, 'unchanged', true);
  end if;
  if v_status <> 'open' then
    raise exception 'order_not_open' using errcode = '55000';
  end if;
  update public.orders
  set status = 'void', closed_at = clock_timestamp(), closed_by = v_uid, void_reason = v_reason
  where id = p_order;
  if v_table is not null then
    update public.tables set turn_started_at = clock_timestamp() where id = v_table;
  end if;
  return jsonb_build_object('order_id', p_order, 'status', 'void', 'unchanged', false);
end;
$$;
comment on function public.void_order(uuid, text) is
  'Anula un pedido abierto, con motivo, y reinicia el turno de su mesa. Solo ser miembro de la organización: nunca se bloquea por mora, suspensión ni plan (ADR 0041, 0044). Repetir devuelve unchanged y no mueve el turno.';

create function public.reset_table_turn(p_table uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_turn timestamptz;
begin
  -- Sin sesión, mesa inexistente o de otra organización: el mismo error, para no revelar qué mesas existen.
  if v_uid is null or p_table is null then
    raise exception 'table_not_found' using errcode = 'P0002';
  end if;
  select t.organization_id into v_org from public.tables t where t.id = p_table;
  if not found or not private.is_org_member(v_org) then
    raise exception 'table_not_found' using errcode = 'P0002';
  end if;
  update public.tables set turn_started_at = clock_timestamp() where id = p_table returning turn_started_at into v_turn;
  if not found then
    raise exception 'table_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('table_id', p_table, 'turn_started_at', v_turn);
end;
$$;
comment on function public.reset_table_turn(uuid) is
  'Reinicia a mano el turno de una mesa: los tickets de visita anteriores dejan de ver la cuenta (ADR 0044). Cualquier miembro de la organización; nunca depende del plan ni de la mora. El QR no cambia.';

revoke all on function public.reset_table_turn(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reset_table_turn(uuid) to authenticated;
-- close_order y void_order conservan los permisos de 20261128100000 (`create or replace` no los toca).

commit;
