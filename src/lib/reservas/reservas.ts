/**
 * Reservas de mesa, fase 1 (ficha reservas-de-mesa, ADR 0051): tipos, textos y reglas puras de la pantalla de la Sala. La base es la
 * autoridad (estados, mesas libres, validaciones): acá solo se lee su respuesta y se arma lo que la persona ve. Se prueba en
 * `reservas.test.ts`.
 */

export const RESERVATION_STATUSES = ["pending_email", "requested", "confirmed", "seated", "rejected", "cancelled", "no_show"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export type Reservation = {
  id: string;
  branchId: string;
  tableId: string | null;
  tableLabel: string | null;
  source: "manual" | "public";
  status: ReservationStatus;
  guestName: string;
  guestPhone: string;
  guestEmail: string | null;
  partySize: number;
  startsAt: string;
  endsAt: string;
  notes: string | null;
};

export type ReservationTable = { id: string; label: string; branchId: string };

/** Cómo se llama cada estado en pantalla (siempre en texto, nunca solo color). */
export const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending_email: "Falta confirmar el email",
  requested: "Por confirmar",
  confirmed: "Confirmada",
  seated: "Ya está en la mesa",
  rejected: "Rechazada",
  cancelled: "Cancelada",
  no_show: "No vino",
};

/** Estados que todavía esperan algo del personal o del comensal; el resto es historia del día. */
export const isActive = (status: ReservationStatus) => status === "pending_email" || status === "requested" || status === "confirmed";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStatus = (value: unknown): value is ReservationStatus => RESERVATION_STATUSES.some((status) => status === value);

/** Lee una fila de `reservations` sin confiar en su forma; `null` si falta algo esencial. */
export function parseReservation(raw: unknown): Reservation | null {
  if (!isRecord(raw)) return null;
  const { id, branch_id, table_id, table_label, source, status, guest_name, guest_phone, guest_email, party_size, starts_at, ends_at, notes } = raw;
  if (typeof id !== "string" || typeof branch_id !== "string" || !isStatus(status)) return null;
  if (typeof guest_name !== "string" || typeof guest_phone !== "string" || typeof party_size !== "number") return null;
  if (typeof starts_at !== "string" || typeof ends_at !== "string" || Number.isNaN(Date.parse(starts_at)) || Number.isNaN(Date.parse(ends_at))) return null;
  return {
    id,
    branchId: branch_id,
    tableId: typeof table_id === "string" ? table_id : null,
    tableLabel: typeof table_label === "string" ? table_label : null,
    source: source === "public" ? "public" : "manual",
    status,
    guestName: guest_name,
    guestPhone: guest_phone,
    guestEmail: typeof guest_email === "string" ? guest_email : null,
    partySize: party_size,
    startsAt: starts_at,
    endsAt: ends_at,
    notes: typeof notes === "string" ? notes : null,
  };
}

/** Orden de la lista del día: lo que sigue vivo primero y por hora; lo terminado al final, también por hora. */
export function sortForDay(reservations: readonly Reservation[]): Reservation[] {
  return [...reservations].sort((a, b) => Number(!isActive(a.status)) - Number(!isActive(b.status)) || Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
}

/**
 * Las mesas ACTIVAS de la sucursal de la reserva que no tienen otra reserva confirmada o sentada que se pise con la suya (la propia
 * no cuenta). Es una ayuda para no ofrecer lo que la base va a rechazar: la base vuelve a comprobarlo (`table_busy`).
 */
export function freeTables(reservation: Reservation, tables: readonly ReservationTable[], all: readonly Reservation[]): ReservationTable[] {
  const start = Date.parse(reservation.startsAt);
  const end = Date.parse(reservation.endsAt);
  const busy = new Set(
    all
      .filter((other) => other.id !== reservation.id && other.tableId && (other.status === "confirmed" || other.status === "seated"))
      .filter((other) => Date.parse(other.startsAt) < end && Date.parse(other.endsAt) > start)
      .map((other) => other.tableId),
  );
  return tables.filter((table) => table.branchId === reservation.branchId && !busy.has(table.id));
}

// ---------------------------------------------------------------------------------------------------------------------
// Día y zona horaria
// ---------------------------------------------------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` válido del calendario, o `null`. */
export function parseDate(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || !DATE.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
}

/** El día de hoy (`YYYY-MM-DD`) en la zona `timeZone`. */
export const todayIn = (timeZone: string, now: Date = new Date()): string => new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);

/** Suma (o resta) días a una fecha del calendario, sin pasar por la zona horaria. */
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Cuántos minutos se adelanta `timeZone` respecto de UTC en el instante `at` (Madrid en verano: 120). */
function offsetMinutes(timeZone: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * El instante en que empieza `date` (las 00:00 locales) en `timeZone`. Dos pasadas: la primera estima con el corrimiento de la
 * medianoche en UTC y la segunda corrige si ese corrimiento cambió en el medio (cambio de hora).
 */
export function startOfDay(date: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetMinutes(timeZone, new Date(guess)) * 60_000;
  return new Date(guess - offsetMinutes(timeZone, new Date(first)) * 60_000);
}

/** «sábado 31 de octubre» (con el año si no es el actual). */
export function dayTitle(date: string, now: Date = new Date()): string {
  const [year, month, day] = date.split("-").map(Number);
  const sameYear = year === now.getUTCFullYear();
  const text = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** «21:30» en la zona de la sucursal. */
export const timeLabel = (iso: string, timeZone: string): string => new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso));

// ---------------------------------------------------------------------------------------------------------------------
// Formulario y errores
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Cuánto tiempo ocupa una reserva su mesa. No se elige ni se muestra por reserva: es un bloque fijo (decisión del usuario, 2026-10-31).
 * Sirve para que una mesa no se reserve dos veces seguidas casi a la misma hora; la base lo recibe como la duración de la reserva.
 */
export const RESERVATION_MINUTES = 90;

/** Qué reservas se ven: las de un día (por defecto) o todas las próximas. */
export type ReservationsView = "dia" | "proximas";
export const parseView = (raw: unknown): ReservationsView => ((Array.isArray(raw) ? raw[0] : raw) === "proximas" ? "proximas" : "dia");

/** El día calendario (`YYYY-MM-DD`) de un instante en la zona `timeZone`. */
export const localDate = (iso: string, timeZone: string): string => todayIn(timeZone, new Date(iso));

/** Agrupa por día de la sucursal, en el orden recibido (la lista ya viene por hora). */
export function groupByDay(reservations: readonly Reservation[], timeZone: string): { date: string; items: Reservation[] }[] {
  const groups: { date: string; items: Reservation[] }[] = [];
  for (const reservation of reservations) {
    const date = localDate(reservation.startsAt, timeZone);
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.items.push(reservation);
    else groups.push({ date, items: [reservation] });
  }
  return groups;
}

/**
 * ¿Se sabe qué mesas están libres para esta reserva? Con la lectura completa, sí. Con la lectura cortada en el tope, solo si la reserva
 * termina antes de la primera reserva que quedó afuera (las que quedaron afuera empiezan en `firstUnloadedStart` o después, y una que
 * empieza cuando esta ya terminó no se pisa con ella).
 */
export function tablesKnown(reservation: Reservation, truncated: boolean, firstUnloadedStart: string | null): boolean {
  if (!truncated) return true;
  return firstUnloadedStart !== null && Date.parse(reservation.endsAt) <= Date.parse(firstUnloadedStart);
}

export type NewReservation = {
  branch: string;
  name: string;
  phone: string;
  email: string;
  party: number;
  date: string;
  time: string;
  notes: string;
  table: string | null;
  clientKey: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
};

/** Lee el formulario de «Nueva reserva». Lo que no se puede leer es `null` (la base validaría el resto y diría qué falta). */
export function parseNewReservation(form: FormData): NewReservation | null {
  const branch = text(form, "branch");
  const clientKey = text(form, "clientKey");
  const date = parseDate(text(form, "date"));
  const time = text(form, "time");
  const party = Number(text(form, "party"));
  const table = text(form, "table");
  if (!isUuid(branch) || !isUuid(clientKey) || !date || !/^\d{2}:\d{2}$/.test(time)) return null;
  if (!Number.isInteger(party)) return null;
  if (table && !isUuid(table)) return null;
  return { branch, name: text(form, "name"), phone: text(form, "phone"), email: text(form, "email"), party, date, time, notes: text(form, "notes"), table: table || null, clientKey };
}

/** Código estable de la base → texto para la persona. Un código desconocido da el mensaje genérico. */
export const ERROR_MESSAGE: Record<string, string> = {
  reservations_not_allowed: "Tu cuenta no puede gestionar reservas ahora (plan, pago al día o permisos).",
  branch_not_found: "No encontramos esa sucursal.",
  table_not_found: "Esa mesa ya no está disponible. Elegí otra.",
  reservation_not_found: "No encontramos esa reserva. Puede que ya se haya borrado: recargá la página.",
  invalid_name: "Escribí el nombre de quien reserva (hasta 80 caracteres).",
  invalid_phone: "El teléfono no es válido. Usá solo números, espacios y + - ( ), con al menos 6 dígitos.",
  invalid_email: "El email no es válido.",
  invalid_party: "La cantidad de personas tiene que estar entre 1 y 50.",
  invalid_duration: "La duración tiene que estar entre 30 minutos y 6 horas.",
  invalid_time: "La fecha y la hora no son válidas: no puede ser de hace más de una hora ni de dentro de más de un año.",
  invalid_notes: "La nota es demasiado larga (hasta 300 caracteres) o tiene caracteres no permitidos.",
  invalid_client_key: "No pudimos registrar el envío. Recargá la página y probá de nuevo.",
  client_key_reused: "Ese envío ya se había hecho con otros datos. Recargá la página y volvé a cargar la reserva.",
  invalid_transition: "Esa reserva ya cambió de estado. Recargá la página para ver cómo quedó.",
  invalid_status: "Ese cambio no está permitido.",
  table_busy: "Esa mesa ya tiene otra reserva en ese horario. Elegí otra mesa.",
  reservations_full: "Hay demasiadas reservas sin terminar. Cancelá o cerrá algunas antes de cargar más.",
};
export const GENERIC_ERROR = "No pudimos completar la acción. Recargá la página y mirá cómo quedó antes de repetirla.";

export const errorMessage = (code: string | undefined | null): string => (code && ERROR_MESSAGE[code]) || GENERIC_ERROR;

/** Avisos de éxito, por el código que viaja en la dirección. */
export const OK_MESSAGE: Record<string, string> = {
  creada: "Reserva cargada.",
  confirmada: "Mesa asignada: la reserva quedó confirmada.",
  sentada: "Anotamos que ya están en la mesa.",
  cancelada: "Reserva cancelada.",
  rechazada: "Reserva rechazada.",
  no_vino: "Anotamos que no vino.",
  suelta: "Soltamos la mesa: la reserva volvió a «Por confirmar».",
};
