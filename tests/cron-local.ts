import { execFileSync } from "node:child_process";
import { asegurarDestinoLocal } from "./rls/purge-price-history";

/** El cron real no debe competir con fixtures ni relojes simulados. Solo Docker local. */
export function pauseQrResetJob(): () => void {
  const container = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
  asegurarDestinoLocal(container);
  const query = (sql: string) => execFileSync("docker", ["exec", container, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], { encoding: "utf8" }).trim();
  const row = query("select jobid || '|' || active::text from cron.job where jobname='reset-scheduled-table-turns'");
  if (!row) return () => {};
  const [id, active] = row.split("|");
  if (!/^\d+$/.test(id) || !["true", "false"].includes(active)) throw new Error("Estado de cron inesperado.");
  query(`select cron.alter_job(${id}, active := false)`);
  // Desactivar no cancela una ejecución ya iniciada: esperar su salida antes de tocar fixtures.
  const end = Date.now() + 30_000;
  while (query(`select count(*) from cron.job_run_details where jobid=${id} and status in ('starting','running')`) !== "0") {
    if (Date.now() >= end) {
      query(`select cron.alter_job(${id}, active := ${active})`);
      throw new Error("El trabajo de reinicios sigue en curso; no es seguro iniciar las pruebas.");
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  return () => { query(`select cron.alter_job(${id}, active := ${active})`); };
}
