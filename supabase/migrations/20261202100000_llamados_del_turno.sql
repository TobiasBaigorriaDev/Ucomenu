-- Los llamados también terminan con el turno de la mesa (feedback del usuario en staging: al «Reiniciar QR de la mesa» el cliente podía
-- seguir llamando al mozo; ficha agile/cambios/turno-de-mesa.md, ADR 0044), sobre 20261201100000_cuenta_del_comensal.sql.
--
-- Reemplaza `create_waiter_call` (misma firma y permisos: solo `service_role`, 20261116100000): idéntica a la de 20261201100000 salvo una regla
-- nueva. Si el turno de la mesa (`turn_started_at`, ya leído después del candado) empezó DESPUÉS de emitido el ticket de visita, responde
-- `session_closed` y no crea nada: el comensal ve «Esta sesión venció. Escaneá de nuevo el QR» (el mismo aviso de siempre). Vale para el cobro
-- (`close_order`, `void_order`) y para el reinicio manual. Una mesa nueva, una visita que escanea después del turno y quien llama sin ticket
-- (directo a la API, que la app no usa) no se ven afectados.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos: volver a crear `create_waiter_call` con el cuerpo de
-- 20261201100000_cuenta_del_comensal.sql (sin la regla del turno).

begin;

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

  -- Turno terminado (ADR 0044): si la mesa cobró o se reinició su QR DESPUÉS de emitido el ticket, esa visita terminó y hay que escanear de
  -- nuevo, igual que con la cuenta atendida pero sin los 10 minutos de gracia (el personal lo decide a mano o ya cobró). El ticket guarda
  -- segundos enteros: solo cuenta como «anterior» si su segundo completo cayó antes del inicio del turno (la misma tolerancia de 1 s del cierre
  -- de arriba), para no rechazar a quien escanea justo después. Sin ticket verosímil no hay nada que comparar (llamar directo a la API se salta
  -- esto, como el resto de lo que valida la app).
  if v_visit is not null and v_visit + interval '1 second' <= coalesce(v_turn, v_table.turn_started_at) then
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
  'Única puerta de escritura de waiter_calls (ADR 0010). Público: valida token, disponibilidad (mesa y sucursal activas), sesión cerrada 10 minutos después de atender la cuenta o al terminar el turno de la mesa (cobro o reinicio del QR, ADR 0044), vencimiento, un pendiente por tipo, límite por cliente y cooldown (solo de los llamados del turno vigente). p_visit_started_at (ticket de visita): informativo y, si es verosímil, decide el cierre de sesión.';

commit;
