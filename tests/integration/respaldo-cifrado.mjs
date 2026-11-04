// Manual, solo Supabase LOCAL: node tests/integration/respaldo-cifrado.mjs
// Requiere db:start/db:reset y entorno de pruebas. No importa datos a una base ni llama a producción.
import { conexionDeVolcado, main, verificarRespaldo } from "../../tools/respaldar.mjs";
import { abrirRespaldo } from "../../tools/respaldo-cifrado.mjs";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(path.join(tmpdir(), "ucomenu-cipher-integration-"));
const key = randomBytes(32).toString("hex");
const previous = process.env.RESPALDO_ENCRYPTION_KEY;
process.env.RESPALDO_ENCRYPTION_KEY = key;
try {
  if (await main(["--local", "--destino", root]) !== 0) throw new Error("Falló la exportación cifrada local.");
  const names = readdirSync(root);
  if (names.length !== 1 || !names[0].endsWith(".tar.gz.aes")) throw new Error("No quedó exclusivamente la copia cifrada.");
  const restored = path.join(root, "recuperada");
  await abrirRespaldo(path.join(root, names[0]), restored, key);
  if (verificarRespaldo(restored).length) throw new Error("Falló la verificación de la copia recuperada.");
  const sql = readFileSync(path.join(restored, "datos.sql"), "utf8");
  if (!/(?:COPY|INSERT INTO)\s+"?auth"?\."?users"?/i.test(sql)) throw new Error("No se recuperaron datos/cuentas.");
  // Ensaya también el modo URL contra la misma base LOCAL con su contraseña pública de desarrollo.
  const config = conexionDeVolcado("postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  const packageFile = createRequire(import.meta.url).resolve("supabase/package.json");
  const cli = path.join(path.dirname(packageFile), JSON.parse(readFileSync(packageFile, "utf8")).bin.supabase);
  const dumpFile = path.join(root, "conexion-por-url.sql");
  const dump = spawnSync(process.execPath, [cli, "db", "dump", ...config.args,
    "--data-only", "--use-copy", "-s", "auth", "-f", dumpFile],
  { encoding: "utf8", env: { ...process.env, ...config.env }, windowsHide: true });
  if (dump.status !== 0 || !/"?auth"?\."?users"?/.test(readFileSync(dumpFile, "utf8"))) {
    throw new Error("Falló el volcado local por URL sin contraseña en argumentos.");
  }
  console.log("ENSAYO LOCAL OK: exportación real, archivo cifrado único, SQL y cuentas recuperados, manifiesto válido.");
} finally {
  if (previous === undefined) delete process.env.RESPALDO_ENCRYPTION_KEY;
  else process.env.RESPALDO_ENCRYPTION_KEY = previous;
  // Exclusivamente el directorio recién creado para este ensayo local.
  rmSync(root, { recursive: true, force: true });
}
