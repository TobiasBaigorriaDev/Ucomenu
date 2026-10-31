import { averageTicket, percentChange, type Products, type Sales } from "@/lib/analitica/ventas";

/**
 * Cifras del día para el Resumen del panel (ficha resumen-del-panel). Salen de la misma lectura de ventas que Analítica
 * (`owner_sales_overview`, ADR 0045) pedida a 14 días: `by_day` trae hoy, el mismo día de la semana anterior y las dos
 * semanas completas, así que no hace falta otra consulta. Puro: se prueba en `hoy.test.ts`.
 */

/** Días que se piden: dos semanas, para comparar la semana con la anterior y hoy con el mismo día de hace 7 días. */
export const HOY_DAYS = 14;
/** Platos más pedidos que se muestran. */
export const HOY_TOP = 3;
/** Días de la semana del gráfico. */
export const WEEK = 7;

export type HoyBar = { daysAgo: number; cents: number; orders: number };
export type HoyDish = { name: string; units: number };

export type HoyView = {
  todayCents: number;
  todayOrders: number;
  /** Mismo día de la semana anterior (hace 7 días). */
  sameWeekdayCents: number;
  sameWeekdayOrders: number;
  /** Cambio de hoy frente al mismo día de la semana anterior; `null` si ese día no vendió (no hay con qué comparar). */
  vsSameWeekday: number | null;
  weekCents: number;
  weekOrders: number;
  /** Ticket promedio de la semana, a pesos enteros; `null` sin pedidos. */
  weekTicketCents: number | null;
  /** Cambio de la semana frente a la anterior; `null` si la anterior no vendió. */
  weekVsPrevious: number | null;
  /** Los últimos 7 días, del más antiguo a hoy. */
  bars: HoyBar[];
  /** Hubo pedidos cerrados en las dos semanas (si no, el Resumen muestra el vacío en vez de ceros). */
  hasOrders: boolean;
  dishes: HoyDish[];
};

const sum = (bars: readonly HoyBar[], key: "cents" | "orders") => bars.reduce((total, bar) => total + bar[key], 0);

/** Arma las cifras del día. `null` si la lectura no es de `HOY_DAYS` días (otra forma no se interpreta). */
export function buildHoy(sales: Sales, products: Products | null): HoyView | null {
  if (sales.days !== HOY_DAYS || sales.byDay.length !== HOY_DAYS) return null;
  const all: HoyBar[] = sales.byDay.map((day) => ({ daysAgo: day.daysAgo, cents: day.revenueCents, orders: day.orders }));
  const bars = all.slice(-WEEK);
  const previousWeek = all.slice(0, WEEK);
  const today = bars[bars.length - 1];
  // El último punto de la semana anterior es el de hace 7 días: el mismo día de la semana que hoy.
  const sameWeekday = previousWeek[previousWeek.length - 1];
  const weekCents = sum(bars, "cents");
  const weekOrders = sum(bars, "orders");
  return {
    todayCents: today.cents,
    todayOrders: today.orders,
    sameWeekdayCents: sameWeekday.cents,
    sameWeekdayOrders: sameWeekday.orders,
    vsSameWeekday: percentChange(today.cents, sameWeekday.cents),
    weekCents,
    weekOrders,
    weekTicketCents: averageTicket({ ...sales.current, orders: weekOrders, revenueCents: weekCents }),
    weekVsPrevious: percentChange(weekCents, sum(previousWeek, "cents")),
    bars,
    hasOrders: sum(all, "orders") > 0,
    dishes: (products?.best ?? []).slice(0, HOY_TOP).map((dish) => ({ name: dish.name, units: dish.units })),
  };
}

/** Altura (0 a 100) de la barra de un día respecto del mejor de la semana; un día con ventas nunca baja de 6 para que se vea. */
export function barHeight(cents: number, max: number): number {
  if (cents <= 0 || max <= 0) return 0;
  return Math.max(6, Math.round((cents / max) * 100));
}
