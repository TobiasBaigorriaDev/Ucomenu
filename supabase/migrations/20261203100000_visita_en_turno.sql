-- ¿La visita sigue vigente en el turno de la mesa? (ficha agile/cambios/turno-de-mesa.md, ADR 0044, enmienda del 2026-10-25), sobre
-- 20261202100000_llamados_del_turno.sql.
--
-- `visit_in_turn(p_token, p_ticket_at)`: devuelve true si el ticket de visita (su emisión, en segundos enteros) NO es anterior al turno actual de
-- la mesa, con la MISMA regla y la misma tolerancia de 1 segundo que `create_waiter_call` (`p_ticket_at + 1 s <= turn_started_at` = visita
-- terminada). Token desconocido o malformado, o sin ticket: false. Solo la usa la página pública `/t/{token}` para no mostrar los botones de llamado
-- a quien recarga una visita ya terminada; la AUTORIDAD sigue siendo `create_waiter_call` (que rechaza igual).
--
--  * `SECURITY DEFINER`, `search_path` vacío y solo `service_role` (ADR 0038): la llama el servidor de la app después de verificar el ticket.
--    Devuelve un booleano: no revela el token, el id de la mesa ni cuándo empezó el turno.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos: `drop function public.visit_in_turn(text, timestamptz);`.

begin;

create function public.visit_in_turn(p_token text, p_ticket_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select not (p_ticket_at + interval '1 second' <= t.turn_started_at)
      from public.tables t
      where p_ticket_at is not null
        and p_token ~ '^[0-9a-f]{32}$'
        and t.qr_token = p_token
    ),
    false
  );
$$;
comment on function public.visit_in_turn(text, timestamptz) is
  'Solo service_role (ADR 0038, 0044): ¿el ticket de visita es de este turno de la mesa? Misma regla y tolerancia de 1 s que create_waiter_call; devuelve solo un booleano.';

revoke all on function public.visit_in_turn(text, timestamptz) from public, anon, authenticated;
grant execute on function public.visit_in_turn(text, timestamptz) to service_role;

commit;
