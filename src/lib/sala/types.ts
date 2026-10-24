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
  /**
   * Solo en «Pide la cuenta»: el pedido abierto de esa mesa (ficha sala-mesas-y-total, ADR 0041): cuántos platos y cuánto suma, en
   * centavos. `null`/ausente = no hay pedido (o no se pudo leer): la tarjeta queda como siempre. Atender el llamado no cierra el pedido.
   */
  account?: { totalCents: number; dishes: number } | null;
};

export type SalaState = {
  /** Hora del servidor al armar la respuesta (ISO). La pantalla calcula «hace N» con ella, no con su reloj. */
  serverNow: string;
  /** `false` si el plan o la cuenta no permiten el llamado: no hay lista ni sondeo. */
  enabled: boolean;
  /** Hay más de una sucursal activa en el local (la tarjeta muestra cuál). Es del local, no de lo que mira cada persona. */
  multiBranch: boolean;
  /** Sucursales activas del local (para el selector de «qué sucursales miro»). */
  branches: SalaBranch[];
  /** Vista efectiva de la persona: ids de las sucursales que mira. Vacío = todas. */
  view: string[];
  /** Pendientes de las sucursales que la persona NO mira (se informa la cantidad, sin detalle: no suena ni avisa). */
  othersPending: number;
  /** Pendientes con menos de 30 minutos de la vista de la persona, el que más espera primero. */
  calls: SalaCall[];
};

export type SalaBranch = { id: string; name: string };

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
  // Opcional también: una forma ilegible es «sin pedido», nunca un total inventado.
  const account = isRecord(raw.account) ? raw.account : null;
  const total = account?.totalCents;
  const dishes = account?.dishes;
  const parsedAccount =
    typeof total === "number" && Number.isSafeInteger(total) && total >= 0 && typeof dishes === "number" && Number.isSafeInteger(dishes) && dishes >= 0
      ? { totalCents: total, dishes }
      : null;
  return { id, kind, tableLabel, branchName, createdAt, visitStartedAt: visit, ...(parsedAccount ? { account: parsedAccount } : {}) };
}

/** Lee la respuesta de la ruta de consulta. Cualquier forma inesperada es `null` (la pantalla lo trata como error). */
export function parseSalaState(raw: unknown): SalaState | null {
  if (!isRecord(raw)) return null;
  const { serverNow, enabled, multiBranch, branches, view, othersPending, calls } = raw;
  if (typeof serverNow !== "string" || Number.isNaN(Date.parse(serverNow))) return null;
  if (typeof enabled !== "boolean" || typeof multiBranch !== "boolean" || !Array.isArray(calls)) return null;
  if (!Array.isArray(branches) || !Array.isArray(view) || !view.every((id) => typeof id === "string")) return null;
  if (typeof othersPending !== "number" || !Number.isInteger(othersPending) || othersPending < 0) return null;
  const parsedBranches = branches.map((branch) =>
    isRecord(branch) && typeof branch.id === "string" && typeof branch.name === "string" ? { id: branch.id, name: branch.name } : null,
  );
  if (parsedBranches.some((branch) => branch === null)) return null;
  const parsed = calls.map(parseCall);
  if (parsed.some((call) => call === null)) return null;
  return { serverNow, enabled, multiBranch, branches: parsedBranches as SalaBranch[], view: view as string[], othersPending, calls: parsed as SalaCall[] };
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

/**
 * Cómo se nombra la mesa de un llamado ante quien no ve la tarjeta (lector de pantalla, avisos): en un local con varias
 * sucursales la etiqueta sola no alcanza («Mesa 1» puede existir en cada una), así que se agrega la sucursal.
 */
export function callName(call: Pick<SalaCall, "tableLabel" | "branchName">, multiBranch: boolean): string {
  return multiBranch ? `${call.tableLabel}, sucursal ${call.branchName}` : call.tableLabel;
}

/** Anuncio de los llamados nuevos de un sondeo: uno se nombra completo; varios, por cantidad. Vacío si no hay ninguno. */
export function newCallsAnnouncement(incoming: readonly SalaCall[], multiBranch: boolean): string {
  if (incoming.length === 0) return "";
  if (incoming.length > 1) return `${incoming.length} llamados nuevos.`;
  const [call] = incoming;
  return `Nuevo llamado: ${callName(call, multiBranch)}, ${KIND_LABEL[call.kind].toLowerCase()}.`;
}

/** Los llamados de `next` que la pantalla todavía no había visto. */
export function newCalls(seen: ReadonlySet<string>, next: readonly SalaCall[]): SalaCall[] {
  return next.filter((call) => !seen.has(call.id));
}

/**
 * Los llamados que una respuesta nueva anuncia (sonido y aviso). Sin cambio de vista: los que la pantalla no había visto. Con cambio
 * de vista (la persona eligió otras sucursales, desde esta pantalla u otro dispositivo): lo que aparece ahora y la pantalla ya había
 * recibido —pero ocultado por la vista anterior— es base y NO se anuncia; un llamado creado DESPUÉS de la última actualización
 * (`previousSnapshotMs`, hora del servidor) nunca se mostró en ningún lado y sí se anuncia. Todo con horas del servidor: no depende
 * del reloj del dispositivo ni de cuándo se tocó el selector. Ante la duda se anuncia (un aviso de más, no un llamado perdido).
 */
export function announceableCalls(
  seen: ReadonlySet<string>,
  next: readonly SalaCall[],
  viewChanged: boolean,
  previousSnapshotMs: number,
): SalaCall[] {
  const unseen = newCalls(seen, next);
  return viewChanged ? unseen.filter((call) => Date.parse(call.createdAt) > previousSnapshotMs) : unseen;
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
