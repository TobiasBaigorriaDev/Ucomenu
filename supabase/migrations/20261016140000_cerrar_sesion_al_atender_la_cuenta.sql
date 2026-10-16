-- Cerrar la sesión de la mesa 10 minutos después de atender «Pedir la cuenta» (B1 de la ficha ticket-de-visita; ficha
-- agile/cambios/cerrar-sesion-al-atender-la-cuenta.md).
--
-- Reemplaza create_waiter_call (misma firma: sigue habiendo una sola puerta, con los mismos permisos). Agrega una regla:
-- si el personal atendió un «Pedir la cuenta» de la mesa hace MÁS de 10 minutos y DESPUÉS de emitido el ticket de
-- visita, la función responde 'session_closed' y no crea nada. Los 10 minutos son de gracia: quien pidió la cuenta
-- puede seguir pagando o pedir un café sin volver a escanear. Quien vuelva a escanear (o recargue) recibe un ticket
-- nuevo, posterior, y llama con normalidad. Sin esquema nuevo: usa waiter_calls.attended_at y el índice
-- (table_id, kind, created_at) que ya existen.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos: volver a aplicar create_waiter_call con la
-- definición de 20261014200000_ticket_de_visita.sql (sin esquema ni datos que deshacer).

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
  v_client text;
  v_visit timestamptz;
  v_last timestamptz;
  v_count integer;
  v_oldest timestamptz;
  v_retry integer;
begin
  if p_kind is null or p_kind not in ('waiter', 'bill')
     or p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('status', 'not_found');
  end if;

  select t.id, t.organization_id, t.branch_id, t.is_active, t.muted_until,
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

  if not v_table.is_active
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

  -- Cooldown por mesa y tipo, contado desde la creación del llamado anterior aunque ya esté atendido.
  select max(created_at) into v_last
  from public.waiter_calls
  where table_id = v_table.id and kind = p_kind;

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
  'Única puerta de escritura de waiter_calls (ADR 0010). Público: valida token, disponibilidad, sesión cerrada 10 minutos después de atender la cuenta, vencimiento, un pendiente por tipo, límite por cliente y cooldown. p_visit_started_at (ticket de visita): informativo y, si es verosímil, decide el cierre de sesión.';
