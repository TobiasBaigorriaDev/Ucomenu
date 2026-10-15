/**
 * Tipos y reglas puras del panel de sala. Sin dependencias de servidor: los usa tanto la ruta de consulta como la
 * pantalla del navegador. Se prueban en `sala.test.ts`.
 */

export type CallKind = "waiter" | "bill";

export type SalaCall = {
  id: string;
  kind: CallKind;
  tableLabel: string;
  /** Nombre de la sucursal; la pantalla solo lo muestra si el local tiene más de una. */
  branchName: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601: cuándo abrió el comensal la carta (ticket de visita). `null` si no se sabe (informativo). */
  visitStartedAt: string | null;
};

export type SalaState = {
  /** Hora del servidor al armar la respuesta (ISO). La pantalla calcula «hace N» con ella, no con su reloj. */
  serverNow: string;
  /** `false` si el plan o la cuenta no permiten el llamado: no hay lista ni sondeo. */
  enabled: boolean;
  /** Hay más de una sucursal (la tarjeta muestra cuál). */
  multiBranch: boolean;
  /** Pendientes con menos de 30 minutos, el que más espera primero. */
  calls: SalaCall[];
};

/** Un pendiente más viejo vence solo (ADR 0010): la sala no lo muestra. */
export const EXPIRY_MS = 30 * 60 * 1000;
/** Desde acá una espera se marca como urgente (con texto, no solo color). */
export const URGENT_MS = 5 * 60 * 1000;
/** Desde acá, que haya llamado tanto después de escanear es raro (puede ser una pestaña olvidada): la tarjeta lo advierte. */
export const STALE_VISIT_MS = 2 * 60 * 60 * 1000;

export const KIND_LABEL: Record<CallKind, string> = { waiter: "Llama al mozo", bill: "Pide la cuenta" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseCall(raw: unknown): SalaCall | null {
  if (!isRecord(raw)) return null;
  const { id, kind, tableLabel, branchName, createdAt, visitStartedAt } = raw;
  if (typeof id !== "string" || (kind !== "waiter" && kind !== "bill")) return null;
  if (typeof tableLabel !== "string" || typeof branchName !== "string") return null;
  if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))) return null;
  // Opcional: sin la clave, nula o ilegible es «no se sabe» (la tarjeta no muestra nada).
  const visit = typeof visitStartedAt === "string" && !Number.isNaN(Date.parse(visitStartedAt)) ? visitStartedAt : null;
  return { id, kind, tableLabel, branchName, createdAt, visitStartedAt: visit };
}

/** Lee la respuesta de la ruta de consulta. Cualquier forma inesperada es `null` (la pantalla lo trata como error). */
export function parseSalaState(raw: unknown): SalaState | null {
  if (!isRecord(raw)) return null;
  const { serverNow, enabled, multiBranch, calls } = raw;
  if (typeof serverNow !== "string" || Number.isNaN(Date.parse(serverNow))) return null;
  if (typeof enabled !== "boolean" || typeof multiBranch !== "boolean" || !Array.isArray(calls)) return null;
  const parsed = calls.map(parseCall);
  if (parsed.some((call) => call === null)) return null;
  return { serverNow, enabled, multiBranch, calls: parsed as SalaCall[] };
}

/** Milisegundos que lleva esperando un llamado, con la hora del servidor como referencia. */
export function waitingMs(call: Pick<SalaCall, "createdAt">, nowMs: number): number {
  return Math.max(0, nowMs - Date.parse(call.createdAt));
}

export const isUrgent = (ms: number) => ms >= URGENT_MS;

/**
 * Cuánto había pasado entre que el comensal abrió la carta y llamó (ms), o `null` si no se sabe. Nunca negativo.
 */
export function visitAgeMs(call: Pick<SalaCall, "createdAt" | "visitStartedAt">): number | null {
  if (!call.visitStartedAt) return null;
  return Math.max(0, Date.parse(call.createdAt) - Date.parse(call.visitStartedAt));
}

export const isStaleVisit = (ms: number) => ms >= STALE_VISIT_MS;

/** «45 s» · «2 min» · «1 h 5 min» (sin el «hace»). */
export function durationLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** «hace 45 s» · «hace 2 min» · «hace 1 h 5 min». */
export function elapsedLabel(ms: number): string {
  return `hace ${durationLabel(ms)}`;
}

/** Los llamados de `next` que la pantalla todavía no había visto. */
export function newCalls(seen: ReadonlySet<string>, next: readonly SalaCall[]): SalaCall[] {
  return next.filter((call) => !seen.has(call.id));
}

/** El más viejo primero; ante igual antigüedad, por mesa para que el orden sea estable. */
export function sortOldestFirst(calls: readonly SalaCall[]): SalaCall[] {
  return [...calls].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.tableLabel.localeCompare(b.tableLabel, "es-AR", { numeric: true }));
}

export const VISIBLE_POLL_MS = 3_000;
export const HIDDEN_POLL_MS = 15_000;
export const MAX_BACKOFF_MS = 15_000;

/**
 * Cuánto esperar para el próximo sondeo: ~3 s con la pestaña visible, ~15 s oculta; tras errores seguidos se espacia
 * (hasta 15 s) para no martillar un servidor caído, y vuelve al ritmo normal al primer éxito.
 */
export function nextPollDelay(visible: boolean, failures: number): number {
  const base = visible ? VISIBLE_POLL_MS : HIDDEN_POLL_MS;
  if (failures <= 0) return base;
  return Math.min(MAX_BACKOFF_MS, Math.max(base, base * 2 ** Math.min(failures, 4)));
}

/** Texto del título de la pestaña: «(2) Sala en vivo» con pendientes, «Sala en vivo» sin ellos. */
export function pageTitle(count: number): string {
  return count > 0 ? `(${count}) Sala en vivo` : "Sala en vivo";
}
