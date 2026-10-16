#!/usr/bin/env node
/**
 * Respaldo propio de UcoMenu (docs/operacion.md): base de datos + fotos de Storage, con un manifiesto verificable.
 * Existe porque el plan Free de Supabase no hace respaldos y porque NINGÚN plan incluye los archivos de Storage en ellos.
 *
 * Uso (desde la raíz):
 *   pnpm respaldo --local --destino C:\respaldos\ucomenu            (Supabase local, Docker encendido)
 *   pnpm respaldo --remoto --env C:\secretos\produccion.env --destino C:\respaldos\ucomenu   (proyecto en la nube)
 *
 * Qué hace: crea `<destino>/<AAAA-MM-DDTHH-MM-SSZ>/` con
 *   esquema.sql   estructura (`supabase db dump`)
 *   datos.sql     datos de `public` (menos `waiter_calls`) y las cuentas (`auth.users` y `auth.identities`), sin sesiones ni tokens
 *   storage/…     cada archivo del bucket `product-images`, con la misma ruta
 *   manifiesto.json   fecha, entorno, tamaños y SHA-256 de cada archivo; sirve para comprobar el respaldo
 * y al final lo vuelve a leer y lo verifica.
 *
 * Seguridad:
 *  - El respaldo contiene correos y hashes de contraseña: es un dato personal. El destino TIENE que estar fuera del
 *    repositorio y en un lugar cifrado o de acceso restringido; el script se niega a escribir dentro del repositorio.
 *  - Contra un proyecto remoto exige `--remoto` y `--env <archivo>` con NEXT_PUBLIC_SUPABASE_URL,
 *    SUPABASE_SERVICE_ROLE_KEY y RESPALDO_DB_URL (cadena de conexión directa de la base). Esa cadena NUNCA va como
 *    argumento (quedaría en el historial y en la lista de procesos).
 *  - Solo lee: no modifica nada en el proyecto. Aun así, ejecutarlo contra producción requiere aprobación.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";

export const BUCKET = "product-images";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Tablas de Auth que NO se respaldan: sesiones, tokens y registros que no sirven para recuperar cuentas. */
export const AUTH_EXCLUIDAS = [
  "audit_log_entries", "flow_state", "sessions", "refresh_tokens", "one_time_tokens", "mfa_amr_claims", "mfa_challenges",
  "mfa_factors", "mfa_recovery_code_sets", "mfa_recovery_codes", "oauth_authorizations", "oauth_client_states",
  "oauth_consents", "oauth_clients", "custom_oauth_providers", "sso_providers", "saml_providers", "saml_relay_states",
  "scim_tokens", "scim_users", "sso_domains", "webauthn_challenges", "webauthn_credentials", "instances",
].map((t) => `auth.${t}`);

/**
 * Tablas de `public` que NO se respaldan. `waiter_calls` guarda el identificador de cliente derivado de la IP, que la
 * política de privacidad promete borrar a los 14 días (ADR 0014): copiarlo a un respaldo que se conserva meses rompería
 * esa promesa, y son avisos efímeros sin valor de recuperación.
 */
export const TABLAS_EXCLUIDAS = [...AUTH_EXCLUIDAS, "public.waiter_calls"];

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i;

export class Fallo extends Error {}

export function leerArgumentos(argv) {
  const { values } = parseArgs({
    args: argv.filter((a) => a !== "--"), // pnpm pasa el "--" tal cual
    options: {
      local: { type: "boolean", default: false },
      remoto: { type: "boolean", default: false },
      env: { type: "string" },
      destino: { type: "string" },
    },
  });
  if (values.local === values.remoto) throw new Fallo("Indicá exactamente uno: --local o --remoto.");
  if (!values.destino) throw new Fallo("Falta --destino <carpeta> (fuera del repositorio).");
  if (values.remoto && !values.env) throw new Fallo("--remoto exige --env <archivo> con las variables del proyecto.");
  return values;
}

/** El destino no puede estar dentro del repositorio (ni ser el repositorio): el respaldo trae datos personales. */
export function validarDestino(destino, raiz = ROOT) {
  const absoluto = path.resolve(destino);
  const relativo = path.relative(raiz, absoluto);
  const dentro = relativo === "" || (!relativo.startsWith("..") && !path.isAbsolute(relativo));
  if (dentro) throw new Fallo(`El destino (${absoluto}) está dentro del repositorio: elegí una carpeta fuera de él.`);
  return absoluto;
}

/** `AAAA-MM-DDTHH-MM-SSZ`: sirve de nombre de carpeta en cualquier sistema de archivos. */
export const marcaDeTiempo = (fecha = new Date()) => fecha.toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-");

export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Entorno (variables) según el modo; el remoto sale de `--env`, el local de .env.local / .env.test.local. */
export function cargarEntorno({ env }) {
  if (env) {
    try {
      return parseEnv(readFileSync(env, "utf8"));
    } catch (e) {
      throw new Fallo(`No se pudo leer ${env}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const salida = { ...process.env };
  for (const file of [".env.local", ".env.test.local"]) {
    try {
      Object.assign(salida, { ...parseEnv(readFileSync(path.join(ROOT, file), "utf8")), ...salida });
    } catch {
      // Si falta alguno, se avisa abajo por la variable que falte.
    }
  }
  return salida;
}

export function validarEntorno(entorno, { local }) {
  const url = entorno.NEXT_PUBLIC_SUPABASE_URL;
  const clave = entorno.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) throw new Fallo("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Fallo("NEXT_PUBLIC_SUPABASE_URL no es una dirección válida.");
  }
  const esLocal = LOCAL_HOST.test(host);
  if (local && !esLocal) throw new Fallo("--local pero NEXT_PUBLIC_SUPABASE_URL no es el Supabase local: no se hace nada.");
  if (!local && esLocal) throw new Fallo("--remoto pero NEXT_PUBLIC_SUPABASE_URL es el Supabase local.");
  if (!local && !entorno.RESPALDO_DB_URL) throw new Fallo("Falta RESPALDO_DB_URL en el archivo de entorno (conexión directa a la base).");
  return { url, clave, esLocal };
}

export function armarManifiesto({ entorno, fecha, archivos }) {
  return {
    version: 1,
    creado: fecha.toISOString(),
    entorno,
    bucket: BUCKET,
    archivos: [...archivos].sort((a, b) => a.ruta.localeCompare(b.ruta)),
  };
}

/** Vuelve a leer lo escrito y lo compara con el manifiesto. Devuelve la lista de problemas (vacía = respaldo sano). */
export function verificarRespaldo(carpeta) {
  const problemas = [];
  let manifiesto;
  try {
    manifiesto = JSON.parse(readFileSync(path.join(carpeta, "manifiesto.json"), "utf8"));
  } catch {
    return ["No se pudo leer manifiesto.json."];
  }
  for (const archivo of manifiesto.archivos) {
    const ruta = path.join(carpeta, archivo.ruta);
    if (!existsSync(ruta)) {
      problemas.push(`Falta ${archivo.ruta}.`);
      continue;
    }
    const contenido = readFileSync(ruta);
    if (contenido.length !== archivo.bytes) problemas.push(`${archivo.ruta}: el tamaño no coincide.`);
    else if (sha256(contenido) !== archivo.sha256) problemas.push(`${archivo.ruta}: el SHA-256 no coincide.`);
  }
  for (const necesario of ["esquema.sql", "datos.sql"]) {
    const dato = manifiesto.archivos.find((a) => a.ruta === necesario);
    if (!dato || dato.bytes === 0) problemas.push(`${necesario} falta o está vacío.`);
  }
  return problemas;
}

/** Script de la CLI de Supabase fijada en el proyecto; se ejecuta con el mismo Node, sin shell (los argumentos no se reinterpretan). */
function scriptSupabase() {
  const archivoPaquete = createRequire(path.join(ROOT, "package.json")).resolve("supabase/package.json");
  const paquete = JSON.parse(readFileSync(archivoPaquete, "utf8"));
  const script = path.join(path.dirname(archivoPaquete), paquete.bin?.supabase ?? "");
  if (!paquete.bin?.supabase || !existsSync(script)) throw new Fallo("No se encontró la CLI de Supabase. ¿Corriste pnpm install?");
  return script;
}

function supabaseCli(args) {
  const r = spawnSync(process.execPath, [scriptSupabase(), ...args], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Fallo(`supabase ${args[0]} ${args[1] ?? ""} falló:
${(r.stderr || r.stdout || "").trim().slice(-800)}`);
}

function volcarBase({ carpeta, local, dbUrl }) {
  const destino = local ? ["--local"] : ["--db-url", dbUrl];
  supabaseCli(["db", "dump", ...destino, "-f", path.join(carpeta, "esquema.sql")]);
  supabaseCli([
    "db", "dump", ...destino, "--data-only", "--use-copy", "-s", "public,auth", "-x", TABLAS_EXCLUIDAS.join(","),
    "-f", path.join(carpeta, "datos.sql"),
  ]);
}

/** Todos los archivos del bucket (recorre carpetas), descargados con la clave de servicio. */
async function copiarStorage({ carpeta, url, clave }) {
  const cliente = createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = cliente.storage.from(BUCKET);
  const archivos = [];

  async function recorrer(prefijo) {
    for (let desde = 0; ; desde += 100) {
      const { data, error } = await bucket.list(prefijo, { limit: 100, offset: desde });
      if (error) throw new Fallo(`No se pudo listar ${BUCKET}/${prefijo}: ${error.message}`);
      for (const item of data) {
        const ruta = prefijo ? `${prefijo}/${item.name}` : item.name;
        if (item.id === null) await recorrer(ruta); // carpeta
        else {
          const descarga = await bucket.download(ruta);
          if (descarga.error) throw new Fallo(`No se pudo descargar ${ruta}: ${descarga.error.message}`);
          const contenido = Buffer.from(await descarga.data.arrayBuffer());
          const relativa = `storage/${ruta}`;
          mkdirSync(path.dirname(path.join(carpeta, relativa)), { recursive: true });
          writeFileSync(path.join(carpeta, relativa), contenido);
          archivos.push({ ruta: relativa, bytes: contenido.length, sha256: sha256(contenido) });
        }
      }
      if (data.length < 100) break;
    }
  }
  await recorrer("");
  return archivos;
}

export async function main(argv) {
  let args;
  try {
    args = leerArgumentos(argv);
    const raizDestino = validarDestino(args.destino);
    const entorno = cargarEntorno(args);
    const { url, clave } = validarEntorno(entorno, { local: args.local });

    const fecha = new Date();
    const carpeta = path.join(raizDestino, marcaDeTiempo(fecha));
    if (existsSync(carpeta)) throw new Fallo(`Ya existe ${carpeta}.`);
    mkdirSync(carpeta, { recursive: true });

    console.log(`Respaldo ${args.local ? "local" : "remoto"} en ${carpeta}`);
    volcarBase({ carpeta, local: args.local, dbUrl: entorno.RESPALDO_DB_URL });
    console.log("  base de datos: esquema y datos listos");
    const fotos = await copiarStorage({ carpeta, url, clave });
    console.log(`  storage: ${fotos.length} archivo(s)`);

    const archivos = [...fotos];
    for (const nombre of ["esquema.sql", "datos.sql"]) {
      const contenido = readFileSync(path.join(carpeta, nombre));
      archivos.push({ ruta: nombre, bytes: contenido.length, sha256: sha256(contenido) });
    }
    writeFileSync(
      path.join(carpeta, "manifiesto.json"),
      JSON.stringify(armarManifiesto({ entorno: args.local ? "local" : "remoto", fecha, archivos }), null, 2),
    );

    const problemas = verificarRespaldo(carpeta);
    if (problemas.length > 0) throw new Fallo(`El respaldo NO pasó la verificación:\n- ${problemas.join("\n- ")}`);
    const total = archivos.reduce((suma, a) => suma + a.bytes, 0);
    console.log(`Verificado: ${archivos.length} archivo(s), ${(total / 1024 / 1024).toFixed(2)} MB. Guardalo fuera del repositorio.`);
    return 0;
  } catch (e) {
    console.error(e instanceof Fallo ? e.message : `Error inesperado: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
