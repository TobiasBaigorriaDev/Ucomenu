-- Gestión de sucursales por el Dueño (ficha gestion-de-sucursales).
--
-- Hasta ahora las sucursales solo se creaban desde el servidor (service_role: el alta del SuperAdmin o un script).
-- Esta migración deja que el DUEÑO cree las suyas desde el panel. Nada más cambia de permisos:
--   * Alta: política de INSERT solo para el owner de la organización y con la cuenta al día (private.org_can_write:
--     activa o en gracia), más el GRANT por columna (organization_id, slug, name). `id`, `created_at` y
--     `waiter_call_cooldown_seconds` los pone la base (el cooldown se cambia en «Llamados»).
--   * El tope de sucursales del plan YA se hace cumplir en el trigger `branches_enforce_limit` (BEFORE INSERT,
--     ADR 0006): no se toca ni se duplica. Con el tope alcanzado el alta falla con 53400 `limit_exceeded:branches`.
--   * `slug` se elige al crear y NO se puede cambiar después (ADR 0005: está en la dirección pública /m/{org}/{sucursal};
--     el UPDATE de `slug`, `organization_id` y `id` sigue sin permiso). Renombrar (`name`) ya era del owner.
--   * Sin DELETE ni columna `is_active` en sucursales: no se agregan (ver la ficha: la baja de una sucursal exige una
--     decisión de producto sobre sus QR, llamados y cupo del plan).
--   * Largo del nombre: tope de 80 caracteres en la base, porque ahora la API puede escribirlo (hasta hoy solo el servidor,
--     que ya lo validaba). `not valid`: no revisa filas existentes (que pudieron cargarse por script) y rige para altas
--     y cambios nuevos.
--
-- Rollback (el alta vuelve a ser solo del servidor):
--   drop policy "branches: el owner crea las suyas con la cuenta al día" on public.branches;
--   revoke insert (organization_id, slug, name) on table public.branches from authenticated;
--   alter table public.branches drop constraint branches_name_max_length;

alter table public.branches
  add constraint branches_name_max_length check (char_length(name) <= 80) not valid;

create policy "branches: el owner crea las suyas con la cuenta al día"
  on public.branches for insert
  to authenticated
  with check (private.is_org_owner(organization_id) and private.org_can_write(organization_id));

grant insert (organization_id, slug, name) on table public.branches to authenticated;
