/**
 * Lectura de la analítica de pedidos (ficha analitica-de-pedidos, ADR 0045). La base entrega solo lo que el Dueño puede ver;
 * acá se lee la respuesta sin confiar en su forma y se arman los datos de las secciones. Puro: se prueba en `ventas.test.ts`.
 */

export const PERIODS = [7, 30, 90] as const;
export type PeriodDays = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: PeriodDays = 30;
/** Cuántos platos se piden por lista (más vendidos y sin pedidos). */
export const PRODUCT_LIST_SIZE = 10;

/** `?dias=` de la dirección: 7, 30 o 90; cualquier otra cosa cae en el período por defecto. */
export function parsePeriod(raw: unknown): PeriodDays {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const found = PERIODS.find((days) => String(days) === value);
  return found ?? DEFAULT_PERIOD;
}

export type PeriodTotals = {
  orders: number;
  revenueCents: number;
  units: number;
  promoDiscountCents: number;
  voidedOrders: number;
  voidedCents: number;
  cancelledUnits: number;
  cancelledCents: number;
  /** Mediana de minutos entre abrir y cerrar; `null` sin pedidos. */
  medianMinutes: number | null;
};
export type DayPoint = { daysAgo: number; orders: number; revenueCents: number };
export type SlotCell = { orders: number; revenueCents: number };
export type CategorySales = { id: string | null; name: string | null; units: number; revenueCents: number };
export type Reason = { reason: string; count: number; cents: number };
export type Sales = {
  days: number;
  current: PeriodTotals;
  previous: PeriodTotals;
  /** Un punto por día del período, del más antiguo al de hoy (los días sin ventas, en cero). */
  byDay: DayPoint[];
  /** 7 filas (lunes a domingo) × 24 horas. */
  slots: SlotCell[][];
  categories: CategorySales[];
  voidReasons: Reason[];
  cancelReasons: Reason[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const list = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null);

function parseTotals(raw: unknown): PeriodTotals | null {
  if (!isRecord(raw)) return null;
  const { orders, revenue_cents, units, promo_discount_cents, voided_orders, voided_cents, cancelled_units, cancelled_cents, median_minutes } = raw;
  if (
    !isCount(orders) ||
    !isCount(revenue_cents) ||
    !isCount(units) ||
    !isCount(promo_discount_cents) ||
    !isCount(voided_orders) ||
    !isCount(voided_cents) ||
    !isCount(cancelled_units) ||
    !isCount(cancelled_cents)
  ) {
    return null;
  }
  if (median_minutes !== null && !isCount(median_minutes)) return null;
  return {
    orders,
    revenueCents: revenue_cents,
    units,
    promoDiscountCents: promo_discount_cents,
    voidedOrders: voided_orders,
    voidedCents: voided_cents,
    cancelledUnits: cancelled_units,
    cancelledCents: cancelled_cents,
    medianMinutes: median_minutes,
  };
}

function parseReasons(raw: unknown, countKey: "orders" | "units", centsKey: "cents"): Reason[] | null {
  const rows = list(raw);
  if (!rows) return null;
  const out: Reason[] = [];
  for (const row of rows) {
    if (!isRecord(row) || typeof row.reason !== "string" || !isCount(row[countKey]) || !isCount(row[centsKey])) return null;
    out.push({ reason: row.reason, count: row[countKey], cents: row[centsKey] });
  }
  return out;
}

/** Lee `owner_sales_overview`. Cualquier forma inesperada es `null` (la pantalla dice que no pudo leer). */
export function parseSales(raw: unknown): Sales | null {
  if (!isRecord(raw) || !isCount(raw.days) || raw.days < 1) return null;
  const days = raw.days;
  const current = parseTotals(raw.current);
  const previous = parseTotals(raw.previous);
  const byDayRows = list(raw.by_day);
  const slotRows = list(raw.by_slot);
  const categoryRows = list(raw.by_category);
  const voidReasons = parseReasons(raw.void_reasons, "orders", "cents");
  const cancelReasons = parseReasons(raw.cancel_reasons, "units", "cents");
  if (!current || !previous || !byDayRows || !slotRows || !categoryRows || !voidReasons || !cancelReasons) return null;

  const byDay: DayPoint[] = Array.from({ length: days }, (_, index) => ({ daysAgo: days - 1 - index, orders: 0, revenueCents: 0 }));
  for (const row of byDayRows) {
    if (!isRecord(row) || !isCount(row.days_ago) || row.days_ago >= days || !isCount(row.orders) || !isCount(row.revenue_cents)) return null;
    byDay[days - 1 - row.days_ago] = { daysAgo: row.days_ago, orders: row.orders, revenueCents: row.revenue_cents };
  }

  const slots: SlotCell[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ orders: 0, revenueCents: 0 })));
  for (const row of slotRows) {
    if (!isRecord(row) || !isCount(row.dow) || row.dow < 1 || row.dow > 7 || !isCount(row.hour) || row.hour > 23 || !isCount(row.orders) || !isCount(row.revenue_cents)) return null;
    slots[row.dow - 1][row.hour] = { orders: row.orders, revenueCents: row.revenue_cents };
  }

  const categories: CategorySales[] = [];
  for (const row of categoryRows) {
    if (!isRecord(row) || !isCount(row.units) || !isCount(row.revenue_cents)) return null;
    if ((row.category_id !== null && typeof row.category_id !== "string") || (row.name !== null && typeof row.name !== "string")) return null;
    categories.push({ id: row.category_id, name: row.name, units: row.units, revenueCents: row.revenue_cents });
  }

  return { days, current, previous, byDay, slots, categories, voidReasons, cancelReasons };
}

export type SoldProduct = {
  id: string | null;
  name: string;
  category: string | null;
  units: number;
  revenueCents: number;
  views: number;
  /** `false`: el plato se borró después de venderse. */
  inCatalog: boolean;
  active: boolean;
};
export type UnsoldProduct = { id: string; name: string; category: string | null; views: number };
export type Products = { best: SoldProduct[]; unsold: UnsoldProduct[]; unsoldTotal: number };

/** Lee `owner_products_performance`. */
export function parseProducts(raw: unknown): Products | null {
  if (!isRecord(raw)) return null;
  const bestRows = list(raw.best);
  const unsoldRows = list(raw.unsold);
  if (!bestRows || !unsoldRows || !isCount(raw.unsold_total)) return null;

  const best: SoldProduct[] = [];
  for (const row of bestRows) {
    if (!isRecord(row) || typeof row.name !== "string" || !isCount(row.units) || !isCount(row.revenue_cents) || !isCount(row.views)) return null;
    if ((row.product_id !== null && typeof row.product_id !== "string") || (row.category !== null && typeof row.category !== "string")) return null;
    best.push({
      id: row.product_id,
      name: row.name,
      category: row.category,
      units: row.units,
      revenueCents: row.revenue_cents,
      views: row.views,
      inCatalog: row.in_catalog !== false,
      active: row.is_active !== false,
    });
  }
  const unsold: UnsoldProduct[] = [];
  for (const row of unsoldRows) {
    if (!isRecord(row) || typeof row.product_id !== "string" || typeof row.name !== "string" || !isCount(row.views)) return null;
    if (row.category !== null && typeof row.category !== "string") return null;
    unsold.push({ id: row.product_id, name: row.name, category: row.category, views: row.views });
  }
  return { best, unsold, unsoldTotal: raw.unsold_total };
}

/** Redondea un importe en centavos al peso entero más cercano (los promedios no necesitan centavos). */
export const roundToPesos = (cents: number): number => Math.round(cents / 100) * 100;

/** Ticket promedio en centavos, a pesos enteros; `null` sin pedidos. */
export const averageTicket = (totals: PeriodTotals): number | null => (totals.orders > 0 ? roundToPesos(totals.revenueCents / totals.orders) : null);

/** Cambio porcentual contra el período anterior; `null` si no hay con qué comparar (antes en cero) o falta el dato actual. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** «+12 %», «−8 %» o «sin cambios». */
export function changeLabel(percent: number): string {
  if (percent === 0) return "sin cambios";
  return `${percent > 0 ? "+" : "−"}${Math.abs(percent)} %`;
}

/** 45 → «45 min»; 80 → «1 h 20 min»; 120 → «2 h». */
export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"] as const;
export const WEEKDAYS_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;

/** «13 a 14 h». */
export const hourSpan = (hour: number) => `${hour} a ${(hour + 1) % 24 === 0 ? 24 : hour + 1} h`;

/** Mayor cantidad de pedidos de una franja. */
export const slotMax = (slots: readonly (readonly SlotCell[])[]) => Math.max(0, ...slots.flatMap((row) => row.map((cell) => cell.orders)));

/** Intensidad 0 (sin pedidos) a 4 (la franja más fuerte), por tramos del máximo. */
export function slotLevel(orders: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (orders <= 0 || max <= 0) return 0;
  const ratio = orders / max;
  return ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
}

export type Slot = { dow: number; hour: number; orders: number; revenueCents: number };

/** Las `count` franjas con más pedidos (empata por importe, después por día y hora); vacío si no hubo ninguna. */
export function topSlots(slots: readonly (readonly SlotCell[])[], count = 3): Slot[] {
  const all: Slot[] = slots.flatMap((row, day) => row.map((cell, hour) => ({ dow: day + 1, hour, ...cell })));
  return all
    .filter((slot) => slot.orders > 0)
    .sort((a, b) => b.orders - a.orders || b.revenueCents - a.revenueCents || a.dow - b.dow || a.hour - b.hour)
    .slice(0, count);
}

/** El día de la semana con más pedidos (lunes = 1); `null` sin pedidos. */
export function busiestWeekday(slots: readonly (readonly SlotCell[])[]): { dow: number; orders: number } | null {
  const totals = slots.map((row, index) => ({ dow: index + 1, orders: row.reduce((sum, cell) => sum + cell.orders, 0) }));
  const best = totals.reduce((a, b) => (b.orders > a.orders ? b : a), { dow: 0, orders: 0 });
  return best.orders > 0 ? best : null;
}

/** Porcentaje entero de `part` sobre `total` (0 si no hay total). */
export const sharePercent = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

/**
 * Fecha del calendario de `daysAgo` días antes de hoy en la zona `timeZone`, como «mié 3 jun» (y, con `long`, «miércoles 3 de junio»).
 * Se arma con el calendario (no con restas de 24 horas) para que un cambio de hora no corra el día.
 */
export function dayLabel(daysAgo: number, timeZone: string, now: Date = new Date(), long = false): string {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - daysAgo));
  const text = new Intl.DateTimeFormat("es-AR", long ? { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" } : { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  return long ? text : text.replace(/[.,]/g, "");
}
