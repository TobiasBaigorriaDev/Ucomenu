-- Acceso del personal (nivel C): una organización nunca se queda sin owner.
-- Ver agile/cambios/acceso-del-personal.md.
--
-- Solo aditiva: una función y un trigger; no toca datos.
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos:
--   drop trigger memberships_guard_last_owner on public.memberships;
--   drop function private.guard_last_owner();
--
-- La regla vale para TODOS los caminos, `service_role` incluido: es un invariante, no un permiso.
--  * DELETE de un owner, o UPDATE que lo baja de rol o lo mueve de organización: se rechaza si
--    en esa organización no queda otro owner.
--  * Borrar la organización entera (cascada) y borrar al usuario de Auth (cascada) pasan por acá:
--    lo primero se permite (la organización ya no existe), lo segundo se rechaza si era el último owner.
--  * Un advisory lock por organización serializa dos bajas simultáneas de los dos únicos dueños.
--  * Crear una organización sin dueños (alta desde el servidor) no se ve afectado: la guarda solo
--    actúa al quitar un owner existente.

create function private.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Solo importa si la fila vieja era owner y deja de serlo en esa organización.
  if old.role <> 'owner' then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE'
     and new.role = 'owner'
     and new.organization_id = old.organization_id then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('owners:' || old.organization_id::text, 0));

  -- Borrado en cascada de la organización: ya no existe, no hay nada que proteger.
  if not exists (select 1 from public.organizations o where o.id = old.organization_id) then
    return coalesce(new, old);
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.organization_id = old.organization_id
      and m.role = 'owner'
      and m.id <> old.id
  ) then
    raise exception 'last_owner_required'
      using errcode = '23514',
            hint = 'La organización necesita al menos un owner.';
  end if;

  return coalesce(new, old);
end;
$$;
comment on function private.guard_last_owner() is
  'Impide dejar a una organización sin owner (baja, descenso o traslado del último). Vale también para service_role.';

revoke all on function private.guard_last_owner() from public, anon, authenticated;

create trigger memberships_guard_last_owner
  before update or delete on public.memberships
  for each row execute function private.guard_last_owner();
