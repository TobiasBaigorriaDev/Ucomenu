-- Purga de waiter_calls por antigüedad (nivel C; ficha agile/cambios/purga-de-waiter-calls.md, ADR 0014).
--
-- Aditiva: una función nueva y un índice. No toca datos existentes ni cambia a ninguna función o política vigente.
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos:
--   drop function public.purge_waiter_calls(interval, integer);
--   drop index public.waiter_calls_created_at_idx;
-- (lo ya purgado no vuelve: el borrado es irreversible; por eso la retención por defecto es holgada y hay un piso).
--
-- Reglas de fondo:
--  * Borra llamados por antigüedad de creación (created_at), sea cual sea su estado: un pendiente de más de 30
--    minutos ya está vencido por derivación, así que uno de semanas no es un aviso vivo.
--  * Piso de retención de 7 días: nada de lo que decide la base (cooldown, límite por cliente de 10 minutos,
--    vencimiento a 30 minutos) ni lo que lee la sala (últimos 30 minutos) depende de filas más viejas. Una
--    retención menor, nula o un lote fuera de rango se rechazan con 22023 (no se purga "por las dudas").
--  * Por lotes y con `for update skip locked`: acota el tiempo de bloqueo y nunca espera ni compite con
--    create_waiter_call o con «atender» sobre una misma fila. Devuelve cuántas filas borró; quien la programe
--    repite hasta que devuelva menos que el lote.
--  * Solo la ejecuta service_role (el servidor o una tarea programada). Ni anon ni authenticated, ni siquiera un
--    SuperAdmin, pueden llamarla por la API. Los privilegios de la tabla no cambian: la API sigue sin borrar.

create index waiter_calls_created_at_idx on public.waiter_calls (created_at);

create function public.purge_waiter_calls(
  p_retention interval default interval '30 days',
  p_batch integer default 5000
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_retention is null or p_retention < interval '7 days' then
    raise exception 'invalid_retention' using errcode = '22023';
  end if;
  if p_batch is null or p_batch < 1 or p_batch > 50000 then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;

  with viejos as (
    select w.id
    from public.waiter_calls w
    where w.created_at < now() - p_retention
    order by w.created_at
    limit p_batch
    for update skip locked
  )
  delete from public.waiter_calls w
  using viejos v
  where w.id = v.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
comment on function public.purge_waiter_calls(interval, integer) is
  'Borra llamados con más de p_retention de antigüedad (piso 7 días, por defecto 30), hasta p_batch por llamada. Devuelve cuántos borró. Solo service_role.';

-- PUBLIC recibe EXECUTE por defecto: se parte de cero.
revoke all on function public.purge_waiter_calls(interval, integer) from public, anon, authenticated;
grant execute on function public.purge_waiter_calls(interval, integer) to service_role;
