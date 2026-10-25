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
-- Además reemplaza `create_waiter_call` (misma firma y permisos): el cooldown por mesa y tipo cuenta solo los llamados del turno vigente
-- (`turn_started_at`), para que la mesa nueva pueda pedir la cuenta enseguida aunque quienes se fueron la pidieran hace segundos.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos: `drop function public.get_table_account(text, timestamptz);` y
-- volver a crear `create_waiter_call` con el cuerpo de 20261023100000_desactivar_sucursales.sql (sin la condición del turno en el cooldown).

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

-- ---------------------------------------------------------------------------
-- create_waiter_call: el cooldown cuenta solo los llamados del turno vigente de la mesa (hallazgo de la revisión de la cuenta del
-- comensal, ronda 2). Idéntica a la de 20261023100000 salvo la lectura de `turn_started_at` y esa condición del cooldown. Misma firma,
-- mismos permisos (solo `service_role`, 20261116100000): `create or replace` no los toca.
-- ---------------------------------------------------------------------------
create or replace function public.create_waiter_call(
  p_token text,
  p_kind text,
  p_client text default null,
  p_visit_started_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_table record;
  v_branch_active boolean;
  v_client text;
  v_visit timestamptz;
  v_last timestamptz;
  v_count integer;
  v_oldest timestamptz;
  v_retry integer;
  v_turn timestamptz;
begin
  if p_kind is null or p_kind not in ('waiter', 'bill')
     or p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('status', 'not_found');
  end if;

  select t.id, t.organization_id, t.branch_id, t.is_active, t.muted_until, t.turn_started_at,
         b.waiter_call_cooldown_seconds as cooldown
    into v_table
  from public.tables t
  join public.branches b on b.id = t.branch_id
  join public.organizations o on o.id = t.organization_id
  where t.qr_token = p_token
    and o.is_active;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Serializa los llamados de una misma mesa: dos toques simultáneos no crean dos pendientes.
  perform pg_advisory_xact_lock(hashtextextended('waiter_call:' || v_table.id::text, 0));

  -- El estado de la sucursal se lee DESPUÉS del lock de la mesa y con FOR SHARE: un llamado que esperaba el lock no usa un
  -- valor viejo, y una desactivación en curso (que necesita el bloqueo exclusivo de la fila) espera a que este llamado
  -- termine o ya fue confirmada y se ve acá. Orden de bloqueos fijo (mesa, luego sucursal): no hay interbloqueo.
  select b.is_active into v_branch_active
  from public.branches b
  where b.id = v_table.branch_id
  for share;

  -- El inicio del turno se lee DESPUÉS del candado de la mesa: si un cierre confirmó mientras este llamado esperaba, el turno que vale es el
  -- nuevo (el valor leído arriba es el anterior y haría contar el llamado de quienes ya se fueron).
  select t.turn_started_at into v_turn from public.tables t where t.id = v_table.id;

  if not v_table.is_active
     or not coalesce(v_branch_active, false)
     or (v_table.muted_until is not null and v_table.muted_until > now())
     or not private.has_feature(v_table.organization_id, 'waiter_call') then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- Verosímil = de las últimas 24 horas y no del futuro; si no, NULL. Se guarda para la sala y decide el cierre de sesión.
  v_visit := case
    when p_visit_started_at >= now() - interval '24 hours' and p_visit_started_at <= now() + interval '1 minute'
      then p_visit_started_at
  end;

  -- Sesión cerrada: si después de emitido el ticket (el ticket guarda segundos enteros: la emisión cae en
  -- [v_visit, v_visit + 1 s)) el personal atendió un «Pedir la cuenta» de esta mesa y pasaron más de 10 minutos de
  -- gracia, esa visita terminó. Sin ticket verosímil no hay nada que comparar (llamar directo a la API se salta esto,
  -- como el resto de lo que valida la app).
  if v_visit is not null and exists (
    select 1 from public.waiter_calls
    where table_id = v_table.id
      and kind = 'bill'
      and status = 'attended'
      and attended_at >= v_visit + interval '1 second'
      and attended_at <= now() - interval '10 minutes'
  ) then
    return jsonb_build_object('status', 'session_closed');
  end if;

  -- Un pendiente de más de 30 minutos vence solo: no puede bloquear el índice único.
  update public.waiter_calls
  set status = 'expired'
  where table_id = v_table.id
    and status = 'pending'
    and created_at <= now() - interval '30 minutes';

  if exists (
    select 1 from public.waiter_calls
    where table_id = v_table.id and kind = p_kind and status = 'pending'
  ) then
    return jsonb_build_object('status', 'already_pending');
  end if;

  -- Límite por cliente (segunda línea de defensa). Un valor ausente o con otro formato no se cuenta.
  v_client := case when p_client ~ '^[0-9a-f]{32}$' then p_client end;
  if v_client is not null then
    -- El contador abarca TODAS las mesas del cliente y el lock de arriba es por mesa: sin esto, dos pedidos
    -- simultáneos del mismo cliente a mesas distintas leerían el mismo conteo e insertarían ambos (31 avisos).
    -- El lock se toma SIEMPRE después del de la mesa (mesa, luego cliente): el orden fijo evita interbloqueos.
    -- Se libera al terminar la transacción, o sea después del insert; en READ COMMITTED el conteo siguiente ya
    -- ve lo que confirmó quien tenía el lock.
    perform pg_advisory_xact_lock(hashtextextended('waiter_client:' || v_client, 0));

    select count(*), min(created_at) into v_count, v_oldest
    from public.waiter_calls
    where client_key = v_client
      and created_at > now() - interval '10 minutes';

    if v_count >= 30 then
      v_retry := greatest(1, ceil(extract(epoch from (v_oldest + interval '10 minutes' - now())))::integer);
      return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', v_retry);
    end if;
  end if;

  -- Cooldown por mesa y tipo, contado desde la creación del llamado anterior aunque ya esté atendido, pero solo de los DEL TURNO
  -- vigente (ADR 0044): cuando el mozo cobra o reinicia el QR llega una mesa nueva, que no tiene que esperar por quienes ya se fueron.
  select max(created_at) into v_last
  from public.waiter_calls
  where table_id = v_table.id and kind = p_kind and created_at > coalesce(v_turn, v_table.turn_started_at);

  if v_last is not null and v_last + make_interval(secs => v_table.cooldown) > now() then
    v_retry := greatest(1, ceil(extract(epoch from (v_last + make_interval(secs => v_table.cooldown) - now())))::integer);
    return jsonb_build_object('status', 'cooldown', 'retry_after_seconds', v_retry);
  end if;

  -- El lock de arriba serializa los llamados de la mesa; si aun así otro pendiente del mismo tipo se coló (índice
  -- único parcial), se responde igual que si se hubiera visto antes: nunca un error ni un segundo pendiente.
  begin
    insert into public.waiter_calls (organization_id, branch_id, table_id, kind, client_key, visit_started_at)
    values (v_table.organization_id, v_table.branch_id, v_table.id, p_kind, v_client, v_visit);
  exception when unique_violation then
    return jsonb_build_object('status', 'already_pending');
  end;

  return jsonb_build_object('status', 'created');
end;
$$;
comment on function public.create_waiter_call(text, text, text, timestamptz) is
  'Única puerta de escritura de waiter_calls (ADR 0010). Público: valida token, disponibilidad (mesa y sucursal activas), sesión cerrada 10 minutos después de atender la cuenta, vencimiento, un pendiente por tipo, límite por cliente y cooldown (solo de los llamados del turno vigente de la mesa, ADR 0044). p_visit_started_at (ticket de visita): informativo y, si es verosímil, decide el cierre de sesión.';

commit;
