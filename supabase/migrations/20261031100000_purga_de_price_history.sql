-- Retención y purga de `price_history` (nivel C: eliminación irreversible de un registro de auditoría de precios).
-- Ficha: agile/cambios/purga-de-price-history.md · ADR 0026 (política) sobre ADR 0012 (la tabla).
--
-- Aditiva: UNA función privada nueva. No cambia la tabla, sus triggers, sus permisos ni ninguna función existente.
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos no hay nada que deshacer en los datos (la función
-- no corre sola); basta con: drop function private.purge_organization_price_history(uuid);
--
-- Política (usuario, 2026-10-20):
--  * Mientras la organización exista, su historial se conserva entero: no hay purga por antigüedad.
--  * Al BORRAR la organización, su historial se purga en la misma transacción. Nadie más puede leerlo (la RLS es de
--    miembros) y trae ids de personas: no hay razón para guardarlo.
--  * Solo se purga una organización dada de baja (`is_active = false`) hace 30 días o más, comprobado en `audit_log`.
--
-- Cómo se apaga el trigger de solo-agregado, a propósito y sin dejarlo apagado:
--  * Es la ÚNICA vía de purga. La función es SECURITY DEFINER de `postgres` (dueño de la tabla, único que puede apagar el
--    trigger), con `search_path` vacío, y NADIE la ejecuta por la API: ni anon, ni authenticated, ni service_role. Solo la
--    llamará la función de borrado de organizaciones (SuperAdmin), que también exigirá el slug escrito, el motivo y la
--    auditoría `organization.deleted` en la misma transacción.
--  * `alter table … disable trigger` es transaccional: si algo falla después, o el llamador revierte, el trigger vuelve a
--    estar encendido y las filas siguen. Toma SHARE ROW EXCLUSIVE: los cambios de precio esperan, un instante, a que termine
--    (el volumen es una fila por cambio de precio). Solo se apaga el trigger de UPDATE/DELETE; el de TRUNCATE sigue.
--  * Idempotente: sin filas devuelve 0. Si el servicio técnico (service_role) cambió un precio de esa organización después,
--    la fila nueva se purga en la llamada siguiente; el borrado de la organización la llama dentro de su transacción.
--
-- Errores estables (como las demás acciones de SuperAdmin):
--   organization_not_found      (P0002)  la organización no existe
--   organization_still_active   (55000)  `is_active = true`: primero se da de baja
--   deactivation_not_audited    (55000)  inactiva, pero el último evento de ciclo de vida no es una baja auditada
--                                         (p. ej. `is_active` puesto a mano, o reactivada después)
--   deactivation_too_recent     (55000)  la baja auditada tiene menos de 30 días

create function private.purge_organization_price_history(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations%rowtype;
  v_event record;
  v_deleted integer;
begin
  -- NO KEY UPDATE: el mismo lock que toma la baja/reactivación (admin_set_organization_active), así que se serializan:
  -- una reactivación en vuelo termina antes de esta comprobación o espera a que termine esta transacción.
  select * into v_org from public.organizations o where o.id = p_org for no key update;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  if v_org.is_active then
    raise exception 'organization_still_active' using errcode = '55000';
  end if;

  -- El último evento de ciclo de vida tiene que ser una baja. `is_active = false` solo no alcanza: se pudo poner a mano.
  select a.action, a.created_at into v_event
  from public.audit_log a
  where a.organization_id = p_org and a.action in ('organization.deactivated', 'organization.reactivated')
  order by a.created_at desc, a.id desc
  limit 1;
  if not found or v_event.action <> 'organization.deactivated' then
    raise exception 'deactivation_not_audited' using errcode = '55000';
  end if;
  -- clock_timestamp(): el instante real tras el lock, no el inicio de la transacción (que pudo esperar).
  if v_event.created_at > clock_timestamp() - interval '30 days' then
    raise exception 'deactivation_too_recent' using errcode = '55000';
  end if;

  alter table public.price_history disable trigger price_history_no_update_delete;
  delete from public.price_history where organization_id = p_org;
  get diagnostics v_deleted = row_count;
  alter table public.price_history enable trigger price_history_no_update_delete;

  return v_deleted;
end;
$$;
comment on function private.purge_organization_price_history(uuid) is
  'Purga el historial de precios de una organización dada de baja hace 30 días o más (auditada). Apaga el trigger de solo-agregado dentro de la transacción. Sin EXECUTE para ningún rol de la API: solo la llamará el borrado de organizaciones (ADR 0026).';

-- Nadie de la API la ejecuta (tampoco service_role): sin esto Supabase la dejaría llamar por los privilegios por defecto.
revoke all on function private.purge_organization_price_history(uuid) from public, anon, authenticated, service_role;
