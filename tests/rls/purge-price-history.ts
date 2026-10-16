import { execFileSync } from "node:child_process";

/**
 * Limpieza de PRUEBAS (RLS y E2E, siempre contra el Supabase LOCAL): borra filas de `price_history`.
 *
 * El historial solo se agrega: ni la API ni `service_role` pueden borrarlo, y una organización con historial no se
 * puede borrar (`ON DELETE RESTRICT`). Para dejar la base limpia se hace como dueño de la tabla (psql dentro del
 * contenedor), apagando un momento el trigger de solo-agregado en una sola transacción. `SUPABASE_DB_CONTAINER`
 * apunta a otra instancia local (p. ej. una aislada).
 *
 * Como apaga una protección, antes de ejecutar SQL comprueba el destino REAL de Docker (no solo la URL de la API):
 * el daemon tiene que ser local y el contenedor tiene que ser uno de Supabase local (`supabase_db_*`).
 *
 * `condicion` es SQL propio de la prueba (ids o prefijos de slug de datos de prueba), nunca entrada externa.
 */

/** Contenedores de base de datos del Supabase local (`supabase_db_<project_id>`). */
export function esContenedorDePruebas(nombre: string): boolean {
  return /^supabase_db_[a-z0-9][a-z0-9_-]*$/.test(nombre);
}

/** El daemon es local si habla por pipe/socket del propio equipo o por TCP a la propia máquina. `ssh://`, `tcp://` remoto o vacío: no. */
export function esDaemonDockerLocal(host: string): boolean {
  const h = host.trim();
  if (/^(npipe|unix):\/\//.test(h)) return true;
  return /^tcp:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(h);
}

type Entorno = Record<string, string | undefined>;
/** Devuelve el daemon (`Endpoints.docker.Host`) de un contexto de Docker; sin nombre, el del contexto activo. */
type InspeccionarContexto = (nombre?: string) => string;

const inspeccionarContextoDeDocker: InspeccionarContexto = (nombre) => {
  if (nombre?.startsWith("-")) throw new Error(`Nombre de contexto de Docker no válido: ${nombre}`);
  const args = ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}", ...(nombre ? [nombre] : [])];
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
};

/**
 * Daemon que usará `docker` en este proceso. Precedencia oficial de Docker: `DOCKER_CONTEXT` anula a `DOCKER_HOST`;
 * sin contexto en el entorno manda `DOCKER_HOST`; sin ninguno, el contexto activo.
 */
export function daemonEfectivo(env: Entorno, inspeccionar: InspeccionarContexto): string {
  const contexto = env.DOCKER_CONTEXT?.trim();
  if (contexto) return inspeccionar(contexto);
  const host = env.DOCKER_HOST?.trim();
  if (host) return host;
  return inspeccionar();
}

let destinoVerificado: string | undefined;

/**
 * Lanza si el contenedor no es de pruebas o si Docker apunta a un daemon que no es el local. Con el entorno real se
 * verifica una vez por proceso y contenedor; `entorno` e `inspeccionar` existen para probarlo sin Docker.
 */
export function asegurarDestinoLocal(
  contenedor: string,
  entorno: Entorno = process.env,
  inspeccionar: InspeccionarContexto = inspeccionarContextoDeDocker,
): void {
  const real = entorno === process.env && inspeccionar === inspeccionarContextoDeDocker;
  if (real && destinoVerificado === contenedor) return;
  if (!esContenedorDePruebas(contenedor)) {
    throw new Error(`Se rechaza el contenedor «${contenedor}»: la limpieza de pruebas solo corre en contenedores supabase_db_*.`);
  }
  let host: string;
  try {
    host = daemonEfectivo(entorno, inspeccionar);
  } catch (error) {
    throw new Error(`No se pudo determinar el daemon de Docker; se rechaza la limpieza por seguridad: ${String(error)}`);
  }
  if (!esDaemonDockerLocal(host)) {
    throw new Error(`Se rechaza el daemon de Docker «${host}»: la limpieza de pruebas solo corre contra el Docker local.`);
  }
  if (real) destinoVerificado = contenedor;
}

/** Igual para `audit_log` (SuperAdmin): solo se agrega, así que la limpieza de pruebas apaga su trigger un momento. */
export function purgeAuditLogWhere(condicion: string): void {
  const contenedor = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
  asegurarDestinoLocal(contenedor);
  const consulta =
    `begin; alter table public.audit_log disable trigger audit_log_no_update_delete; ` +
    `delete from public.audit_log where ${condicion}; ` +
    `alter table public.audit_log enable trigger audit_log_no_update_delete; commit`;
  try {
    execFileSync("docker", ["exec", contenedor, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", consulta], {
      encoding: "utf8",
    });
  } catch (error) {
    throw new Error(`No se pudo limpiar audit_log en el contenedor ${contenedor}: ${String(error)}`);
  }
}

/** Igual para `payments` (pagos del SuperAdmin): solo se agrega, así que la limpieza de pruebas apaga su trigger un momento. */
export function purgePaymentsWhere(condicion: string): void {
  const contenedor = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
  asegurarDestinoLocal(contenedor);
  const consulta =
    `begin; alter table public.payments disable trigger payments_no_update_delete; ` +
    `delete from public.payments where ${condicion}; ` +
    `alter table public.payments enable trigger payments_no_update_delete; commit`;
  try {
    execFileSync("docker", ["exec", contenedor, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", consulta], {
      encoding: "utf8",
    });
  } catch (error) {
    throw new Error(`No se pudo limpiar payments en el contenedor ${contenedor}: ${String(error)}`);
  }
}

/**
 * Limpia de una vez lo que bloquea el borrado de una organización de prueba: historial de precios y pagos del
 * SuperAdmin (ambos RESTRICT y solo-agregado) de las organizaciones que cumplan `condicionOrg` (SQL sobre
 * `public.organizations o`). Una sola transacción y un solo `docker exec`, con los dos triggers apagados un momento.
 * La auditoría NO se toca acá: no bloquea el borrado (sin clave foránea) y hay pruebas que comprueban que sobrevive.
 */
export function purgeOrgRecordsWhere(condicionOrg: string): void {
  const contenedor = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
  asegurarDestinoLocal(contenedor);
  const orgs = `(select o.id from public.organizations o where ${condicionOrg})`;
  const consulta =
    `begin; ` +
    `alter table public.price_history disable trigger price_history_no_update_delete; ` +
    `alter table public.payments disable trigger payments_no_update_delete; ` +
    `delete from public.price_history where organization_id in ${orgs}; ` +
    `delete from public.payments where organization_id in ${orgs}; ` +
    `alter table public.price_history enable trigger price_history_no_update_delete; ` +
    `alter table public.payments enable trigger payments_no_update_delete; commit`;
  try {
    execFileSync("docker", ["exec", contenedor, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", consulta], {
      encoding: "utf8",
    });
  } catch (error) {
    throw new Error(`No se pudo limpiar el historial de la organización en el contenedor ${contenedor}: ${String(error)}`);
  }
}

export function purgePriceHistoryWhere(condicion: string): void {
  const contenedor = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
  asegurarDestinoLocal(contenedor);
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
