-- Borrado de mesas (nivel C: eliminación irreversible). Ficha: agile/cambios/borrado-de-mesas.md.
--
-- Aditiva: una política y un permiso. No toca datos ni el esquema.
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos (las mesas ya borradas no vuelven):
--   drop policy "tables: los miembros borran con la cuenta al día" on public.tables;
--   revoke delete on table public.tables from authenticated;
--
-- Reglas de fondo:
--  * Borra una mesa quien es miembro de su organización y la cuenta puede escribir (el mismo par que el UPDATE):
--    en solo lectura y suspendida no se borra. anon no tiene permiso alguno sobre la tabla.
--  * Los llamados de la mesa se van con ella: waiter_calls.fk (table_id, branch_id, organization_id) es ON DELETE CASCADE
--    (migración waiter_calls). El historial de llamados dura como máximo 14 días (purga, ADR 0014) y ninguna regla de la
--    base lo necesita; la cascada corre con los privilegios del dueño de la tabla, así que ningún rol de la API gana permiso
--    alguno sobre waiter_calls.
--  * El token del QR se borra con la fila: /t/{token} deja de resolver (resolve_table_qr devuelve «no existe»).

create policy "tables: los miembros borran con la cuenta al día"
  on public.tables for delete
  to authenticated
  using (private.is_org_member(organization_id) and private.org_can_write(organization_id));

grant delete on table public.tables to authenticated;
