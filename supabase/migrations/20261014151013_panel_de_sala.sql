-- Panel de sala (ficha agile/cambios/panel-de-sala.md): el personal atiende los llamados.
--
-- Aditiva: una función, una política de UPDATE, un permiso de columna, un trigger y un índice. No toca datos.
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos:
--   drop trigger waiter_calls_stamp_attended on public.waiter_calls;
--   drop function private.stamp_attended_call();
--   drop policy "waiter_calls: los miembros atienden los pendientes" on public.waiter_calls;
--   revoke update (status) on public.waiter_calls from authenticated;
--   drop function private.can_attend_calls(uuid);
--   drop index public.waiter_calls_org_pending_idx;
--
-- Reglas de fondo:
--  * Un miembro de ESA organización puede pasar un llamado de `pending` a `attended`, y nada más: no puede volver
--    uno atendido a pendiente, marcarlo `expired`, ni tocar otra columna. Solo se concede UPDATE sobre `status`.
--  * Solo mientras el llamado no venció: uno de 30 minutos o más (aunque siga `pending` hasta que la función pública
--    lo marque) ya no se puede atender; el borde coincide con el de la lista de la sala (`created_at > now() - 30 min`).
--  * attended_at y attended_by los fija un trigger (now() y auth.uid()): nadie puede atribuir la atención a otra
--    persona ni cambiar la hora.
--  * Atender exige que el local pueda usar el llamado (plan y cuenta al día: has_feature('waiter_call')), igual que
--    crearlo: en solo lectura y suspendida el módulo interactivo está apagado.
--  * La política de lectura de los miembros ya existe (migración de llamados): no cambia.

-- Para las políticas hace falta una función con EXECUTE para `authenticated` (has_feature no lo tiene a propósito).
create function private.can_attend_calls(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_member(org_id) and private.has_feature(org_id, 'waiter_call');
$$;

revoke all on function private.can_attend_calls(uuid) from public, anon, authenticated;
grant execute on function private.can_attend_calls(uuid) to authenticated;

create policy "waiter_calls: los miembros atienden los pendientes"
  on public.waiter_calls for update
  to authenticated
  using (
    status = 'pending'
    and created_at > now() - interval '30 minutes'
    and private.can_attend_calls(organization_id)
  )
  with check (status = 'attended' and private.can_attend_calls(organization_id));

-- Solo `status`: la hora y la persona las pone el trigger.
grant update (status) on table public.waiter_calls to authenticated;

create function private.stamp_attended_call()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'attended' and old.status is distinct from 'attended' then
    new.attended_at := now();
    new.attended_by := (select auth.uid());
  end if;
  return new;
end;
$$;

revoke all on function private.stamp_attended_call() from public, anon, authenticated;

create trigger waiter_calls_stamp_attended
  before update on public.waiter_calls
  for each row execute function private.stamp_attended_call();

-- La sala lista los pendientes de toda la organización, los más viejos primero.
create index waiter_calls_org_pending_idx
  on public.waiter_calls (organization_id, created_at)
  where status = 'pending';
