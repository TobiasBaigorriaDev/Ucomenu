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
