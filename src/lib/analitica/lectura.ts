/**
 * Lectura de la analítica básica (ficha analitica-basica, ADR 0022): platos más vistos y llamados por hora. La base ya
 * entrega solo lo que el Dueño puede ver; acá se lee la respuesta sin confiar en su forma y se arman los datos de los
 * gráficos. Puro: se prueba en `lectura.test.ts`.
 */

/** Días que miran las dos secciones. Los llamados no pueden ir más atrás: `waiter_calls` se purga a los 14 (ADR 0014). */
export const ANALYTICS_DAYS = 14;
export const TOP_DISHES = 10;

export type DishViews = { id: string; name: string; views: number; /** `false`: el plato se desactivó después (sus vistas siguen contando). */ active: boolean };
export type TopDishes = { dishes: DishViews[]; total: number };

export type HourCalls = { hour: number; waiter: number; bill: number };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Lee `owner_top_dishes`. Cualquier forma inesperada es `null` (la pantalla dice que no pudo leer). */
export function parseTopDishes(raw: unknown): TopDishes | null {
  if (!Array.isArray(raw)) return null;
  const dishes: DishViews[] = [];
  let total = 0;
  for (const item of raw) {
    if (!isRecord(item) || typeof item.product_id !== "string" || typeof item.name !== "string") return null;
    if (!isCount(item.views) || !isCount(item.total_views)) return null;
    dishes.push({ id: item.product_id, name: item.name, views: item.views, active: item.is_active !== false });
    total = item.total_views; // el mismo en todas las filas
  }
  return { dishes, total };
}

/** Lee `owner_calls_by_hour` y completa las 24 horas del día (las que no tienen llamados, en cero). */
export function parseCallsByHour(raw: unknown): HourCalls[] | null {
  if (!Array.isArray(raw)) return null;
  const hours: HourCalls[] = Array.from({ length: 24 }, (_, hour) => ({ hour, waiter: 0, bill: 0 }));
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const { hour_of_day: hour, waiter, bill } = item;
    if (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour > 23 || !isCount(waiter) || !isCount(bill)) return null;
    hours[hour] = { hour, waiter, bill };
  }
  return hours;
}

export const callsOf = (hour: HourCalls) => hour.waiter + hour.bill;

/** Total de llamados del período. */
export const totalCalls = (hours: readonly HourCalls[]) => hours.reduce((sum, hour) => sum + callsOf(hour), 0);

/** La hora (o las horas, si empatan) con más llamados. Vacío si no hubo ninguno. */
export function peakHours(hours: readonly HourCalls[]): HourCalls[] {
  const max = Math.max(0, ...hours.map(callsOf));
  return max === 0 ? [] : hours.filter((hour) => callsOf(hour) === max);
}

/** «13 a 14 h». */
export const hourRange = (hour: number) => `${hour} a ${(hour + 1) % 24 === 0 ? 24 : hour + 1} h`;

/** Ancho de una barra en porcentaje (0–100) respecto del máximo; una barra con valor nunca queda invisible. */
export function barPercent(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(2, Math.min(100, Math.round((value / max) * 100)));
}

/** Singular o plural: «1 vista», «3 vistas». */
export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
