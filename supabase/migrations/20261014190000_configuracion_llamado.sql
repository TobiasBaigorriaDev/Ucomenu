-- Configuración del llamado (ficha agile/cambios/configuracion-del-llamado.md).
--
-- Aditiva: dos permisos de columna y un trigger. No toca datos ni agrega tablas.
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos:
--   drop trigger tables_limit_mute on public.tables;
--   drop function private.limit_table_mute();
--   revoke update (muted_until) on public.tables from authenticated;
--   revoke update (waiter_call_cooldown_seconds) on public.branches from authenticated;
--
-- Reglas de fondo:
--  * Silenciar una mesa (tables.muted_until): lo hace el personal (Dueño y Staff) con la cuenta al día, igual que el
--    resto de las mesas (la política de UPDATE de `tables` ya lo exige). Un silencio es TEMPORAL: un trigger rechaza
--    fechas a más de 24 horas (con 10 minutos de tolerancia por el desfase entre el reloj de la app y el de la base).
--    Poner una fecha pasada o NULL lo quita. Silenciar no consume cupo de mesas activas (el trigger del tope no
--    cuenta una mesa que ya estaba activa o que sigue inactiva).
--  * Cooldown del llamado (branches.waiter_call_cooldown_seconds): solo el Dueño (la política de UPDATE de
--    `branches` ya es solo del owner y con la cuenta al día; el Staff no administra sucursales). El rango 10 a 3600
--    ya lo impone el CHECK de la columna.
--  * Ninguna otra columna de `tables` ni de `branches` cambia de permisos.

grant update (muted_until) on table public.tables to authenticated;
grant update (waiter_call_cooldown_seconds) on table public.branches to authenticated;

create function private.limit_table_mute()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.muted_until is not null
     and new.muted_until is distinct from old.muted_until
     and new.muted_until > now() + interval '24 hours 10 minutes' then
    raise exception 'mute_too_long'
      using errcode = '22023',
            hint = 'Un silencio dura como máximo 24 horas.';
  end if;
  return new;
end;
$$;

revoke all on function private.limit_table_mute() from public, anon, authenticated;

create trigger tables_limit_mute
  before update of muted_until on public.tables
  for each row execute function private.limit_table_mute();
