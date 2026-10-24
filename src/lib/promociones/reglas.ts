/**
 * Reglas puras del panel de promociones (ficha panel-de-promociones, ADR 0040): validar el formulario, describir una promoción en
 * palabras y avisar de superposiciones. La base vuelve a comprobar todo (`CHECK` de `promotions`); esto da el mensaje claro antes de
 * escribir. Se prueba en `reglas.test.ts`.
 */
import { formatArs } from "@/lib/money";
import { parsePrice } from "@/lib/carta/price";
import type { DiscountType } from "./precio";

/** Debe coincidir con el CHECK `promotions_name_check` de la base. */
export const PROMOTION_NAME_MAX = 80;

export const DISCOUNT_TYPES: readonly DiscountType[] = ["percent", "amount", "fixed_price"];

export const DISCOUNT_TYPE_LABEL: Record<DiscountType, string> = {
  percent: "Porcentaje de descuento",
  amount: "Monto de descuento",
  fixed_price: "Precio fijo",
};

/** Día ISO (1 = lunes … 7 = domingo) → nombre. */
export const WEEKDAY_NAME: Record<number, string> = {
  1: "lunes",
  2: "martes",
  3: "miércoles",
  4: "jueves",
  5: "viernes",
  6: "sábado",
  7: "domingo",
};
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
/** «Los lunes», «Los sábados»… para una promoción de un solo día. */
const WEEKDAY_ONLY: Record<number, string> = {
  1: "Los lunes",
  2: "Los martes",
  3: "Los miércoles",
  4: "Los jueves",
  5: "Los viernes",
  6: "Los sábados",
  7: "Los domingos",
};

export type PromotionInput = {
  name: string;
  discountType: DiscountType;
  /** percent: 1–100 · amount: centavos ≥ 1 · fixed_price: centavos ≥ 0. */
  discountValue: number;
  /** Lunes = bit 0 … domingo = bit 6. */
  weekdaysMask: number;
  startMinute: number;
  endMinute: number;
  startsOn: string | null;
  endsOn: string | null;
  allBranches: boolean;
  branchIds: string[];
  productIds: string[];
  categoryIds: string[];
  isActive: boolean;
};

export type PromotionProblem =
  | "name_blank"
  | "name_too_long"
  | "type_invalid"
  | "value_blank"
  | "value_invalid"
  | "percent_range"
  | "amount_zero"
  | "days_empty"
  | "time_invalid"
  | "window_empty"
  | "dates_invalid"
  | "dates_order"
  | "targets_empty"
  | "branches_empty"
  | "ids_invalid";

/** Lo que llega del formulario, sin interpretar. */
export type PromotionFormFields = {
  name: unknown;
  type: unknown;
  value: unknown;
  days: readonly unknown[];
  allDay: unknown;
  from: unknown;
  to: unknown;
  startsOn: unknown;
  endsOn: unknown;
  allBranches: unknown;
  branches: readonly unknown[];
  products: readonly unknown[];
  categories: readonly unknown[];
  active: unknown;
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const maskOf = (days: readonly number[]): number => days.reduce((mask, day) => mask | (1 << (day - 1)), 0);
export const daysOf = (mask: number): number[] => WEEKDAYS.filter((day) => ((mask >> (day - 1)) & 1) === 1);

/** `HH:MM` → minuto del día (0–1439). `null` si no es una hora. */
export function parseClock(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const match = TIME.exec(raw.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** `AAAA-MM-DD` → la misma fecha si existe en el calendario, o `null`. */
export function parseDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

const ids = (raw: readonly unknown[]): string[] | null => {
  const clean = [...new Set(raw.map((item) => (typeof item === "string" ? item.trim().toLowerCase() : "")))];
  return clean.every((id) => UUID.test(id)) ? clean : null;
};

/**
 * Valida el formulario. Hora de fin `00:00` o `24:00` = medianoche (fin del día); con inicio y fin iguales (no medianoche) la
 * franja es vacía, y «todo el día» se pide con su casilla. Una promoción necesita al menos un plato o una categoría, y al menos
 * una sucursal si no es para todas.
 */
export function parsePromotionForm(fields: PromotionFormFields): { ok: true; value: PromotionInput } | { ok: false; problem: PromotionProblem } {
  const fail = (problem: PromotionProblem) => ({ ok: false as const, problem });

  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  if (name === "") return fail("name_blank");
  if ([...name].length > PROMOTION_NAME_MAX) return fail("name_too_long");

  const discountType = DISCOUNT_TYPES.find((type) => type === fields.type);
  if (!discountType) return fail("type_invalid");

  let discountValue: number;
  const rawValue = typeof fields.value === "string" ? fields.value.trim() : "";
  if (rawValue === "") return fail("value_blank");
  if (discountType === "percent") {
    if (!/^\d{1,3}$/.test(rawValue)) return fail("value_invalid");
    discountValue = Number(rawValue);
    if (discountValue < 1 || discountValue > 100) return fail("percent_range");
  } else {
    const price = parsePrice(rawValue);
    if (!price.ok) return fail("value_invalid");
    discountValue = price.cents;
    if (discountType === "amount" && discountValue < 1) return fail("amount_zero");
  }

  const days = [...new Set(fields.days.map((day) => Number(day)))];
  if (days.length === 0) return fail("days_empty");
  if (!days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)) return fail("days_empty");

  let startMinute: number;
  let endMinute: number;
  if (fields.allDay === "on" || fields.allDay === true) {
    startMinute = 0;
    endMinute = 1440;
  } else {
    const start = parseClock(fields.from);
    const rawTo = typeof fields.to === "string" ? fields.to.trim() : "";
    const end = rawTo === "24:00" ? 1440 : parseClock(rawTo);
    if (start === null || end === null) return fail("time_invalid");
    startMinute = start;
    endMinute = end === 0 ? 1440 : end;
    if (startMinute === endMinute || (startMinute === 0 && endMinute === 1440)) return fail("window_empty");
  }

  const rawFrom = typeof fields.startsOn === "string" ? fields.startsOn.trim() : "";
  const rawUntil = typeof fields.endsOn === "string" ? fields.endsOn.trim() : "";
  const startsOn = rawFrom === "" ? null : parseDate(rawFrom);
  const endsOn = rawUntil === "" ? null : parseDate(rawUntil);
  if ((rawFrom !== "" && startsOn === null) || (rawUntil !== "" && endsOn === null)) return fail("dates_invalid");
  if (startsOn !== null && endsOn !== null && startsOn > endsOn) return fail("dates_order");

  const allBranches = fields.allBranches !== "false" && fields.allBranches !== false;
  const branchIds = ids(fields.branches);
  const productIds = ids(fields.products);
  const categoryIds = ids(fields.categories);
  if (!branchIds || !productIds || !categoryIds) return fail("ids_invalid");
  if (productIds.length + categoryIds.length === 0) return fail("targets_empty");
  if (!allBranches && branchIds.length === 0) return fail("branches_empty");

  return {
    ok: true,
    value: {
      name,
      discountType,
      discountValue,
      weekdaysMask: maskOf(days),
      startMinute,
      endMinute,
      startsOn,
      endsOn,
      allBranches,
      branchIds: allBranches ? [] : branchIds,
      productIds,
      categoryIds,
      isActive: !(fields.active === "false" || fields.active === false),
    },
  };
}

// ---------------------------------------------------------------------------
// En palabras
// ---------------------------------------------------------------------------

const list = new Intl.ListFormat("es-AR", { style: "long", type: "conjunction" });
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function formatClock(minute: number): string {
  const hours = Math.floor(minute / 60) % 24;
  return `${String(hours).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** «25 % de descuento», «$ 500 de descuento», «Precio $ 5.000». */
export function discountLabel(type: DiscountType, value: number): string {
  if (type === "percent") return `${value} % de descuento`;
  if (type === "amount") return `${formatArs(value)} de descuento`;
  return `Precio ${formatArs(value)}`;
}

/** «Todos los días», «Lunes a viernes», «Sábados y domingos» o la lista de días. */
export function daysLabel(mask: number): string {
  const days = daysOf(mask);
  if (days.length === 7) return "Todos los días";
  if (days.length === 5 && days.every((day, index) => day === index + 1)) return "Lunes a viernes";
  if (days.length === 2 && days[0] === 6 && days[1] === 7) return "Sábados y domingos";
  if (days.length === 1) return WEEKDAY_ONLY[days[0]];
  return capital(list.format(days.map((day) => WEEKDAY_NAME[day])));
}

/** «Todo el día», «De 18:00 a 20:00», «De 22:00 a 02:00 (sigue al día siguiente)». */
export function windowLabel(start: number, end: number): string {
  if (start === 0 && end === 1440) return "Todo el día";
  const to = end === 1440 ? "medianoche" : formatClock(end);
  return `De ${formatClock(start)} a ${to}${end < start ? " (sigue al día siguiente)" : ""}`;
}

const formatDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** «Del 18/12/2026 al 24/12/2026», «Desde …», «Hasta …» o `null` si no tiene fechas. */
export function datesLabel(startsOn: string | null, endsOn: string | null): string | null {
  if (startsOn && endsOn) return startsOn === endsOn ? `Solo el ${formatDate(startsOn)}` : `Del ${formatDate(startsOn)} al ${formatDate(endsOn)}`;
  if (startsOn) return `Desde el ${formatDate(startsOn)}`;
  if (endsOn) return `Hasta el ${formatDate(endsOn)}`;
  return null;
}

// ---------------------------------------------------------------------------
// Superposiciones
// ---------------------------------------------------------------------------

export type OverlapSubject = {
  id: string;
  name: string;
  isActive: boolean;
  weekdaysMask: number;
  startMinute: number;
  endMinute: number;
  startsOn: string | null;
  endsOn: string | null;
  allBranches: boolean;
  branchIds: ReadonlySet<string>;
  /** Platos a los que alcanza, ya con las categorías resueltas. */
  productIds: ReadonlySet<string>;
};

const WEEK = 7 * 1440;

/** Los tramos de la semana (minutos desde el lunes 00:00, circular) que cubre una franja. */
function weekIntervals(mask: number, start: number, end: number): [number, number][] {
  const out: [number, number][] = [];
  for (const day of daysOf(mask)) {
    const base = (day - 1) * 1440;
    if (end > start) out.push([base + start, base + end]);
    else {
      out.push([base + start, base + 1440]);
      out.push([(base + 1440) % WEEK, ((base + 1440) % WEEK) + end]);
    }
  }
  return out;
}

const intersect = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

/** ¿Hay algún momento de la semana en que las dos franjas están en curso? */
export function windowsOverlap(a: Pick<OverlapSubject, "weekdaysMask" | "startMinute" | "endMinute">, b: typeof a): boolean {
  const left = weekIntervals(a.weekdaysMask, a.startMinute, a.endMinute);
  const right = weekIntervals(b.weekdaysMask, b.startMinute, b.endMinute);
  return left.some((x) => right.some((y) => intersect(x, y)));
}

function datesOverlap(a: OverlapSubject, b: OverlapSubject): boolean {
  if (a.endsOn !== null && b.startsOn !== null && a.endsOn < b.startsOn) return false;
  if (b.endsOn !== null && a.startsOn !== null && b.endsOn < a.startsOn) return false;
  return true;
}

function branchesOverlap(a: OverlapSubject, b: OverlapSubject): boolean {
  if (a.allBranches && b.allBranches) return true;
  if (a.allBranches) return b.branchIds.size > 0;
  if (b.allBranches) return a.branchIds.size > 0;
  return [...a.branchIds].some((id) => b.branchIds.has(id));
}

/** Dos promociones activas se superponen si comparten algún plato, alguna sucursal, algún momento de la semana y alguna fecha. */
export function promotionsOverlap(a: OverlapSubject, b: OverlapSubject): boolean {
  if (a.id === b.id || !a.isActive || !b.isActive) return false;
  if (![...a.productIds].some((id) => b.productIds.has(id))) return false;
  return branchesOverlap(a, b) && datesOverlap(a, b) && windowsOverlap(a, b);
}

/** Para cada promoción, las que se le superponen (las dos se avisan mutuamente). */
export function findOverlaps(subjects: readonly OverlapSubject[]): Map<string, OverlapSubject[]> {
  const result = new Map<string, OverlapSubject[]>();
  for (const a of subjects) {
    const others = subjects.filter((b) => promotionsOverlap(a, b));
    if (others.length > 0) result.set(a.id, others);
  }
  return result;
}
