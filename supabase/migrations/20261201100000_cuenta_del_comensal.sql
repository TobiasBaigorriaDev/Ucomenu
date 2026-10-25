-- Cuenta del comensal (ficha agile/cambios/cuenta-del-comensal.md, ADR 0044), sobre 20261130100000_turno_de_mesa.sql.
--
-- Qué hace: una función nueva, `get_table_account(p_token, p_ticket_at)`, que le devuelve a quien pidió la cuenta lo que se consumió en
-- su mesa. Es la ÚNICA puerta de lectura de pedidos para un anónimo:
--  * `SECURITY DEFINER`, `search_path` vacío y ejecutable SOLO por `service_role` (ADR 0038): la llama la acción de servidor de
--    `/t/{token}` después de verificar el ticket de visita (HMAC). `anon` y `authenticated` siguen sin permiso sobre `orders`,
--    `order_items` y `order_item_options` y sin EXECUTE sobre la función.
--  * Devuelve datos SOLO si se cumplen todas: el token es de una mesa activa de una sucursal activa de una organización activa con la
--    función de llamado en el plan y la cuenta al día; el ticket es del turno vigente (`private.ticket_in_turn`); hay un «Pedir la
--    cuenta» de la mesa (pendiente o atendido) creado DENTRO del turno; y hay un pedido abierto. Si falta alguna de las dos primeras,
--    `not_found`; si falta el turno o el pedido de cuenta, `unavailable` (sin decir cuál); sin pedido abierto, `empty`.
--  * Solo trae lo que ve el comensal: por línea no cancelada, cantidad, nombre, nombres de las opciones, importe de una unidad con sus
--    opciones e importe de la línea (lo COPIADO al anotar, como la precuenta del mozo), más el total, la cantidad de platos, el local, la
--    sucursal, la mesa y la zona horaria. NUNCA observaciones, motivos de cancelación, personas, ids ni líneas canceladas.
--  * Es de solo lectura (`stable`): lee todo con una sola foto de la base, así que el total y las líneas coinciden.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos: `drop function public.get_table_account(text, timestamptz);`.

begin;

create function public.get_table_account(p_token text, p_ticket_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_table record;
  v_order uuid;
  v_lines jsonb;
  v_total bigint;
  v_dishes bigint;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' or p_ticket_at is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select t.id, t.label, t.turn_started_at, b.name as branch_name, b.timezone as time_zone, o.name as org_name
    into v_table
  from public.tables t
  join public.branches b on b.id = t.branch_id
  join public.organizations o on o.id = t.organization_id
  where t.qr_token = p_token
    and t.is_active
    and b.is_active
    and o.is_active
    and private.has_feature(o.id, 'waiter_call');
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Un ticket anterior al turno ya no ve la cuenta (ADR 0044); tampoco quien no pidió la cuenta en este turno.
  if not private.ticket_in_turn(v_table.id, p_ticket_at)
     or not exists (
       select 1 from public.waiter_calls c
       where c.table_id = v_table.id
         and c.kind = 'bill'
         and c.status in ('pending', 'attended')
         and c.created_at > v_table.turn_started_at
     ) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  select o.id into v_order from public.orders o where o.table_id = v_table.id and o.status = 'open';
  if not found then
    return jsonb_build_object('status', 'empty');
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'quantity', i.quantity,
          'name', i.product_name,
          'options', coalesce(
            (select jsonb_agg(op.option_name order by op.created_at, op.id) from public.order_item_options op where op.order_item_id = i.id),
            '[]'::jsonb
          ),
          'unit_cents', i.unit_price_cents + i.options_cents,
          'line_cents', i.quantity * (i.unit_price_cents + i.options_cents)
        )
        order by i.created_at, i.id
      ),
      '[]'::jsonb
    ),
    coalesce(sum(i.quantity * (i.unit_price_cents + i.options_cents)), 0),
    coalesce(sum(i.quantity), 0)
    into v_lines, v_total, v_dishes
  from public.order_items i
  where i.order_id = v_order and i.status <> 'cancelled';

  return jsonb_build_object(
    'status', 'ok',
    'org_name', v_table.org_name,
    'branch_name', v_table.branch_name,
    'table_label', v_table.label,
    'time_zone', v_table.time_zone,
    'as_of', now(),
    'lines', v_lines,
    'dishes', v_dishes,
    'total_cents', v_total
  );
end;
$$;
comment on function public.get_table_account(text, timestamptz) is
  'Cuenta de la mesa para quien la pidió (ADR 0044). Solo service_role, desde la acción de servidor de /t/{token} tras verificar el ticket. Devuelve platos vigentes, importes y total solo con ticket del turno y un «Pedir la cuenta» dentro del turno; nunca observaciones, motivos, personas ni ids.';

revoke all on function public.get_table_account(text, timestamptz) from public, anon, authenticated;
grant execute on function public.get_table_account(text, timestamptz) to service_role;

commit;
