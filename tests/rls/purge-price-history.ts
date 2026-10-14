import { execFileSync } from "node:child_process";

/**
 * Limpieza de PRUEBAS (RLS y E2E, siempre contra el Supabase LOCAL): borra filas de `price_history`.
 *
 * El historial solo se agrega: ni la API ni `service_role` pueden borrarlo, y una organización con historial no se
 * puede borrar (`ON DELETE RESTRICT`). Para dejar la base limpia se hace como dueño de la tabla (psql dentro del
 * contenedor), apagando un momento el trigger de solo-agregado en una sola transacción. `SUPABASE_DB_CONTAINER`
 * apunta a otra instancia local (p. ej. una aislada).
 *
 * `condicion` es SQL propio de la prueba (ids o prefijos de slug de datos de prueba), nunca entrada externa.
 */
export function purgePriceHistoryWhere(condicion: string): void {
  const contenedor = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
  const consulta =
    `begin; alter table public.price_history disable trigger price_history_no_update_delete; ` +
    `delete from public.price_history where ${condicion}; ` +
    `alter table public.price_history enable trigger price_history_no_update_delete; commit`;
  try {
    execFileSync("docker", ["exec", contenedor, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", consulta], {
      encoding: "utf8",
    });
  } catch (error) {
    throw new Error(`No se pudo limpiar price_history en el contenedor ${contenedor}: ${String(error)}`);
  }
}
