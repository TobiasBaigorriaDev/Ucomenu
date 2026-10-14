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

export const KIND_LABEL: Record<CallKind, string> = { waiter: "Llama al mozo", bill: "Pide la cuenta" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseCall(raw: unknown): SalaCall | null {
  if (!isRecord(raw)) return null;
  const { id, kind, tableLabel, branchName, createdAt } = raw;
  if (typeof id !== "string" || (kind !== "waiter" && kind !== "bill")) return null;
  if (typeof tableLabel !== "string" || typeof branchName !== "string") return null;
  if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))) return null;
  return { id, kind, tableLabel, branchName, createdAt };
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

/** «hace 45 s» · «hace 2 min» · «hace 1 h 5 min». */
export function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `hace ${hours} h` : `hace ${hours} h ${rest} min`;
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
