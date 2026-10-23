/** Validaciones puras del alta de organizaciones por el SuperAdmin (sin base ni red): se prueban en `admin.test.ts`. */
import { isValidSlug } from "@/lib/slug";

export const PLAN_CODES = ["basic", "pro", "premium"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const BILLING_CYCLES = ["monthly", "yearly"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const NAME_MAX_LENGTH = 80;
/** Días de vigencia que propone el formulario (la prueba de 14 días). */
export const DEFAULT_PERIOD_DAYS = 14;
/** Tope de «vigente hasta»; la base acepta hasta 731 días, así que lo que pasa acá siempre pasa allá. */
export const MAX_PERIOD_DAYS = 730;

const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_ZONE = "America/Argentina/Buenos_Aires";
/** Argentina no tiene horario de verano: el desfase es fijo. */
const UTC_OFFSET = "-03:00";

export const isPlanCode = (value: unknown): value is PlanCode => PLAN_CODES.some((code) => code === value);
export const isBillingCycle = (value: unknown): value is BillingCycle => BILLING_CYCLES.some((cycle) => cycle === value);

/** Nombre sin espacios en los bordes, de 1 a 80 caracteres. `null` si no sirve. */
export function parseName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  return name.length > 0 && [...name].length <= NAME_MAX_LENGTH ? name : null;
}

/** Slug en minúsculas y sin espacios en los bordes; el mismo contrato que la base. `null` si no es válido. */
export function parseSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const slug = raw.trim().toLowerCase();
  return isValidSlug(slug) ? slug : null;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * «Vigente hasta»: una fecha `AAAA-MM-DD` que vale hasta el final de ese día en Argentina (23:59:59, UTC−3).
 * Devuelve el instante en ISO, o `null` si no es una fecha real, ya pasó o está a más de 730 días.
 */
export function parsePeriodEnd(raw: unknown, now: Date): string | null {
  if (typeof raw !== "string") return null;
  const match = DATE_ONLY.exec(raw);
  if (!match) return null;

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const calendar = new Date(Date.UTC(year, month - 1, day));
  // Descarta fechas inexistentes (31 de febrero) que `Date` corregiría en silencio.
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;

  const end = new Date(`${raw}T23:59:59${UTC_OFFSET}`);
  if (Number.isNaN(end.getTime())) return null;
  if (end.getTime() <= now.getTime()) return null;
  if (end.getTime() > now.getTime() + MAX_PERIOD_DAYS * DAY_MS) return null;
  return end.toISOString();
}

/** `AAAA-MM-DD` (día de Argentina) de dentro de `days` días: el valor inicial del campo «Vigente hasta». */
export function defaultPeriodDate(now: Date, days = DEFAULT_PERIOD_DAYS): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TIME_ZONE }).format(
    new Date(now.getTime() + days * DAY_MS),
  );
}

// ---------------------------------------------------------------------------
// Cambio de plan, suspensión y pagos (ficha superadmin-planes-pagos)
// ---------------------------------------------------------------------------

export const REASON_MAX_LENGTH = 200;
export const REFERENCE_MAX_LENGTH = 120;
/** Mismo tope que la base: 10^11 centavos. */
export const AMOUNT_MAX_CENTS = 100_000_000_000;

export const CURRENCIES = ["ARS", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const PAYMENT_METHODS = ["transfer", "payment_link", "cash", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const isCurrency = (value: unknown): value is Currency => CURRENCIES.some((c) => c === value);
export const isPaymentMethod = (value: unknown): value is PaymentMethod => PAYMENT_METHODS.some((m) => m === value);

// ---------------------------------------------------------------------------
// Add-ons (ficha addons-y-baja-de-organizaciones)
// ---------------------------------------------------------------------------

/** Mismo formato que `addons_code_check`. Que el add-on exista en el catálogo (hoy vacío, ADR 0031) lo decide la base. */
const ADDON_CODE_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
/** Mismo tope que la base (`admin_set_addon`): packs extra de 0 a 50. */
export const MAX_EXTRA_PACKS = 50;

export const isAddonCode = (value: unknown): value is string => typeof value === "string" && ADDON_CODE_PATTERN.test(value);

/** Packs extra: un entero de 0 a 50 («» cuenta como 0). `null` si no sirve. */
export function parseExtraPacks(raw: unknown): number | null {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text === "") return 0;
  if (!/^\d{1,3}$/.test(text)) return null;
  const packs = Number(text);
  return packs <= MAX_EXTRA_PACKS ? packs : null;
}

/** Sucursales adicionales que se pueden vender (ADR 0039): de 0 a 3. */
export const MAX_EXTRA_BRANCHES = 3;

/** Cantidad de sucursales adicionales: un entero de 0 a 3 («» cuenta como 0). `null` si no sirve. */
export function parseExtraBranches(raw: unknown): number | null {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text === "") return 0;
  if (!/^\d$/.test(text)) return null;
  const quantity = Number(text);
  return quantity <= MAX_EXTRA_BRANCHES ? quantity : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sucursales elegidas para desactivar: ids sin repetir (a lo sumo 3). `null` si algún valor no es un id o hay repetidos. */
export function parseBranchSelection(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_EXTRA_BRANCHES) return null;
  const ids = raw.map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""));
  if (ids.some((id) => !UUID.test(id)) || new Set(ids).size !== ids.length) return null;
  return ids;
}

// ---------------------------------------------------------------------------
// Vistas previas de funciones (ficha vistas-previas-de-funciones, ADR 0039)
// ---------------------------------------------------------------------------

/** Funciones que se pueden habilitar por organización: las mismas que el `CHECK` de `organization_feature_previews`. */
export const PREVIEW_FEATURES = ["orders", "promotions", "review_invite", "customers"] as const;
export type PreviewFeature = (typeof PREVIEW_FEATURES)[number];

export const PREVIEW_FEATURE_LABEL: Record<PreviewFeature, string> = {
  orders: "Pedidos del mozo",
  promotions: "Promociones programadas",
  review_invite: "Invitación a reseñar",
  customers: "Clientes recurrentes",
};

export const isPreviewFeature = (value: unknown): value is PreviewFeature => PREVIEW_FEATURES.some((f) => f === value);

/** Vigencia máxima de una vista previa por vez; la base deja 1 día de margen. */
export const MAX_PREVIEW_DAYS = 90;

/**
 * Fin de una vista previa: obligatorio. Una fecha `AAAA-MM-DD` que vale hasta el final de ese día en Argentina, futura y de
 * hasta 90 días. `null` si no sirve.
 */
export function parsePreviewEnd(raw: unknown, now: Date): string | null {
  const end = parsePeriodEnd(raw, now);
  if (end === null) return null;
  return new Date(end).getTime() <= now.getTime() + MAX_PREVIEW_DAYS * DAY_MS ? end : null;
}

/** Fin del add-on: opcional. `""` = sin fecha de fin; si no, la misma regla que «vigente hasta». `undefined` si no sirve. */
export function parseAddonEnd(raw: unknown, now: Date): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return undefined;
  if (raw.trim() === "") return null;
  return parsePeriodEnd(raw.trim(), now) ?? undefined;
}

/** Motivo de un cambio: de 1 a 200 caracteres sin espacios en los bordes. `null` si no sirve. */
export function parseReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const reason = raw.trim();
  return reason.length > 0 && [...reason].length <= REASON_MAX_LENGTH ? reason : null;
}

/** Referencia del pago (número de operación): opcional, hasta 120 caracteres. `""` si no hay; `null` si es demasiado larga. */
export function parseReference(raw: unknown): string | null {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") return null;
  const reference = raw.trim();
  return [...reference].length <= REFERENCE_MAX_LENGTH ? reference : null;
}

/**
 * Importe escrito por una persona («1234», «1.234,56», «1234.5») a centavos enteros. Acepta coma o punto decimal y
 * puntos como separador de miles solo si hay coma decimal. Hasta 2 decimales, mayor que cero y hasta el tope. `null` si no sirve.
 */
export function parseAmountToCents(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  let text = raw.trim().replace(/\s/g, "");
  if (text === "") return null;
  if (text.includes(",")) {
    // «1.234,56»: los puntos son miles y la coma, decimal.
    if (!/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(text)) return null;
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return null;
  }
  const [whole, decimals = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= AMOUNT_MAX_CENTS ? cents : null;
}

/** Hoy en Argentina como `AAAA-MM-DD`. */
export function todayInArgentina(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TIME_ZONE }).format(now);
}

function calendarDay(raw: string): number | null {
  const match = DATE_ONLY.exec(raw);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.getTime();
}

/** Día en que se recibió el pago: una fecha real, no futura (en Argentina) y de hasta 365 días atrás. `null` si no sirve. */
export function parsePaidOn(raw: unknown, now: Date): string | null {
  if (typeof raw !== "string") return null;
  const day = calendarDay(raw);
  const today = calendarDay(todayInArgentina(now));
  if (day === null || today === null) return null;
  return day <= today && day >= today - 365 * DAY_MS ? raw : null;
}

/**
 * Propuesta para «cubre hasta»: un ciclo (un mes o un año) a partir del día más tardío entre el vencimiento actual y hoy,
 * en el calendario de Argentina. Es solo el valor inicial del campo: la persona lo puede cambiar y la base valida el resto.
 */
export function proposeCoversUntil(currentEnd: string | null, cycle: BillingCycle, now: Date): string {
  const today = todayInArgentina(now);
  const endDay = currentEnd ? todayInArgentina(new Date(currentEnd)) : today;
  const base = calendarDay(endDay)! > calendarDay(today)! ? endDay : today;
  const [year, month, day] = base.split("-").map(Number);
  const targetMonthIndex = month - 1 + (cycle === "monthly" ? 1 : 12);
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  // Si el mes de destino es más corto (31 de enero + 1 mes), queda en su último día.
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${targetYear}-${pad(targetMonth + 1)}-${pad(Math.min(day, lastDay))}`;
}
