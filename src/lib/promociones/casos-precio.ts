/**
 * Tabla de casos del precio efectivo, compartida por `precio.test.ts` (la réplica en TypeScript) y `tests/rls/promociones.rls.test.ts`
 * (la función `effective_prices` de la base): las dos tienen que dar lo que dice cada fila, así que no pueden desviarse sin que una falle.
 *
 * Un escenario es un grupo de platos de una misma categoría con sus promociones; cada sonda es un instante (UTC) en una sucursal con el
 * resultado esperado. Calendario de referencia: 2026-12-18 es viernes, 19 sábado, 20 domingo y 21 lunes. Buenos Aires es UTC−3 todo
 * el año; Madrid, UTC+1 en diciembre; Nueva York, UTC−5 en diciembre y con horario de verano desde el 2026-03-08 hasta el 2026-11-01.
 */
import type { DiscountType, PromotionRule } from "./precio";

export type CaseBranch = "ba" | "madrid" | "ny";

/** Zona de cada sucursal de la tabla de casos. */
export const CASE_BRANCHES: Record<CaseBranch, string> = {
  ba: "America/Argentina/Buenos_Aires",
  madrid: "Europe/Madrid",
  ny: "America/New_York",
};

export type PromoSpec = {
  key: string;
  type: DiscountType;
  value: number;
  /** Días ISO en que EMPIEZA la franja: 1 = lunes … 7 = domingo. */
  days: readonly number[];
  /** `HH:MM` (el fin puede ser `24:00`). */
  from: string;
  to: string;
  startsOn?: string;
  endsOn?: string;
  /** Pausada: está en la base pero no se aplica. */
  paused?: boolean;
  /** Solo en estas sucursales (por omisión, todas). */
  branches?: readonly CaseBranch[];
};

export type ProductSpec = {
  key: string;
  base: number;
  /** Precio propio de una sucursal (reemplaza al base). */
  branchPrices?: Partial<Record<CaseBranch, number>>;
};

export type Probe = {
  branch: CaseBranch;
  /** Instante UTC. */
  at: string;
  /** Plato consultado (por omisión, el primero). */
  product?: string;
  price: number;
  /** Clave de la promoción que gana, o `null`. */
  promo: string | null;
  /** Fin de la franja en el reloj de la sucursal, si hay promoción. */
  endsLocal?: string;
};

export type Scenario = {
  key: string;
  products: readonly ProductSpec[];
  /** `category`: las promociones apuntan a la categoría (todos los platos). `product`: solo al primer plato. */
  target: "product" | "category";
  promos: readonly PromoSpec[];
  probes: readonly Probe[];
};

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const WEEKDAYS = [1, 2, 3, 4, 5] as const;

export const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const maskOf = (days: readonly number[]): number => days.reduce((mask, day) => mask | (1 << (day - 1)), 0);

/** El `created_at` de la promoción número `index` del escenario: un segundo de diferencia, para que el desempate sea inequívoco. */
export const createdAtOf = (index: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();

/** La promoción como la entiende el cálculo (la base le da el mismo `id` que la clave). */
export function ruleOf(spec: PromoSpec, index: number, id: string = spec.key): PromotionRule {
  return {
    id,
    name: spec.key,
    discountType: spec.type,
    discountValue: spec.value,
    weekdaysMask: maskOf(spec.days),
    startMinute: minutesOf(spec.from),
    endMinute: minutesOf(spec.to),
    startsOn: spec.startsOn ?? null,
    endsOn: spec.endsOn ?? null,
    createdAt: createdAtOf(index),
  };
}

const allDay = (key: string, type: DiscountType, value: number, extra: Partial<PromoSpec> = {}): PromoSpec => ({
  key,
  type,
  value,
  days: ALL_DAYS,
  from: "00:00",
  to: "24:00",
  ...extra,
});

export const PRICE_SCENARIOS: readonly Scenario[] = [
  {
    key: "happy-hour",
    products: [{ key: "p", base: 10000 }],
    target: "product",
    promos: [{ key: "hh", type: "percent", value: 25, days: WEEKDAYS, from: "18:00", to: "20:00" }],
    probes: [
      { branch: "ba", at: "2026-12-18T20:59:00Z", price: 10000, promo: null }, // vie 17:59
      { branch: "ba", at: "2026-12-18T21:00:00Z", price: 7500, promo: "hh", endsLocal: "2026-12-18T20:00:00" }, // vie 18:00: el inicio entra
      { branch: "ba", at: "2026-12-18T22:59:59Z", price: 7500, promo: "hh", endsLocal: "2026-12-18T20:00:00" }, // vie 19:59:59: los segundos no cuentan
      { branch: "ba", at: "2026-12-18T23:00:00Z", price: 10000, promo: null }, // vie 20:00: el fin no entra
      { branch: "ba", at: "2026-12-19T22:00:00Z", price: 10000, promo: null }, // sáb 19:00: el sábado no está marcado
      { branch: "madrid", at: "2026-12-18T17:00:00Z", price: 7500, promo: "hh", endsLocal: "2026-12-18T20:00:00" }, // vie 18:00 en Madrid
      { branch: "ba", at: "2026-12-18T17:00:00Z", price: 10000, promo: null }, // el mismo instante son las 14:00 en Buenos Aires
      { branch: "madrid", at: "2026-12-18T21:00:00Z", price: 10000, promo: null }, // vie 22:00 en Madrid
    ],
  },
  {
    key: "noche-cruza-medianoche",
    products: [{ key: "p", base: 8000 }],
    target: "product",
    promos: [{ key: "noche", type: "fixed_price", value: 5000, days: [5, 6], from: "22:00", to: "02:00" }],
    probes: [
      { branch: "ba", at: "2026-12-19T00:59:00Z", price: 8000, promo: null }, // vie 21:59
      { branch: "ba", at: "2026-12-19T01:00:00Z", price: 5000, promo: "noche", endsLocal: "2026-12-19T02:00:00" }, // vie 22:00
      { branch: "ba", at: "2026-12-19T04:59:00Z", price: 5000, promo: "noche", endsLocal: "2026-12-19T02:00:00" }, // sáb 01:59: es la franja del viernes
      { branch: "ba", at: "2026-12-19T05:00:00Z", price: 8000, promo: null }, // sáb 02:00
      { branch: "ba", at: "2026-12-20T01:00:00Z", price: 5000, promo: "noche", endsLocal: "2026-12-20T02:00:00" }, // sáb 22:00
      { branch: "ba", at: "2026-12-20T04:00:00Z", price: 5000, promo: "noche", endsLocal: "2026-12-20T02:00:00" }, // dom 01:00: es la franja del sábado
      { branch: "ba", at: "2026-12-20T05:00:00Z", price: 8000, promo: null }, // dom 02:00
      { branch: "ba", at: "2026-12-18T04:00:00Z", price: 8000, promo: null }, // vie 01:00: es la noche del jueves, que no está marcado
    ],
  },
  {
    key: "fechas-con-franja-que-cruza",
    products: [{ key: "p", base: 6000 }],
    target: "product",
    promos: [allDay("f", "percent", 50, { from: "22:00", to: "02:00", startsOn: "2026-12-18", endsOn: "2026-12-18" })],
    probes: [
      { branch: "ba", at: "2026-12-18T02:00:00Z", price: 6000, promo: null }, // jue 23:00: empieza el 17, antes de «desde»
      { branch: "ba", at: "2026-12-18T04:00:00Z", price: 6000, promo: null }, // vie 01:00: es la franja del 17
      { branch: "ba", at: "2026-12-19T02:00:00Z", price: 3000, promo: "f", endsLocal: "2026-12-19T02:00:00" }, // vie 23:00
      { branch: "ba", at: "2026-12-19T04:00:00Z", price: 3000, promo: "f", endsLocal: "2026-12-19T02:00:00" }, // sáb 01:00: la franja del último día sigue
      { branch: "ba", at: "2026-12-20T02:00:00Z", price: 6000, promo: null }, // sáb 23:00: empieza el 19, después de «hasta»
    ],
  },
  {
    key: "todo-el-dia-domingo",
    products: [{ key: "p", base: 3000 }],
    target: "product",
    promos: [{ key: "dom", type: "amount", value: 500, days: [7], from: "00:00", to: "24:00" }],
    probes: [
      { branch: "ba", at: "2026-12-20T02:59:00Z", price: 3000, promo: null }, // sáb 23:59
      { branch: "ba", at: "2026-12-20T03:00:00Z", price: 2500, promo: "dom", endsLocal: "2026-12-21T00:00:00" }, // dom 00:00
      { branch: "ba", at: "2026-12-21T02:59:00Z", price: 2500, promo: "dom", endsLocal: "2026-12-21T00:00:00" }, // dom 23:59
      { branch: "ba", at: "2026-12-21T03:00:00Z", price: 3000, promo: null }, // lun 00:00
    ],
  },
  {
    key: "redondeo-mitad-hacia-arriba",
    products: [{ key: "p", base: 1001 }],
    target: "product",
    promos: [allDay("mitad", "percent", 50)],
    probes: [{ branch: "ba", at: "2026-12-18T15:00:00Z", price: 501, promo: "mitad", endsLocal: "2026-12-19T00:00:00" }], // 500,5 → 501
  },
  {
    key: "redondeo-al-centavo",
    products: [{ key: "p", base: 1001 }],
    target: "product",
    promos: [allDay("tercio", "percent", 33)],
    probes: [{ branch: "ba", at: "2026-12-18T15:00:00Z", price: 671, promo: "tercio", endsLocal: "2026-12-19T00:00:00" }], // 670,67 → 671
  },
  {
    key: "descuento-que-no-baja-el-precio",
    products: [{ key: "p", base: 1 }],
    target: "product",
    promos: [allDay("medio", "percent", 50)], // 0,5 redondea a 1: igual al de lista, no se aplica
    probes: [{ branch: "ba", at: "2026-12-18T15:00:00Z", price: 1, promo: null }],
  },
  {
    key: "porcentaje-total",
    products: [{ key: "p", base: 100 }],
    target: "product",
    promos: [allDay("gratis", "percent", 100)],
    probes: [{ branch: "ba", at: "2026-12-18T15:00:00Z", price: 0, promo: "gratis", endsLocal: "2026-12-19T00:00:00" }],
  },
  {
    key: "monto-con-piso-en-cero",
    products: [{ key: "p", base: 3000 }],
    target: "product",
    promos: [allDay("monto", "amount", 5000)],
    probes: [{ branch: "ba", at: "2026-12-18T15:00:00Z", price: 0, promo: "monto", endsLocal: "2026-12-19T00:00:00" }],
  },
  {
    key: "precio-fijo-cero",
    products: [{ key: "p", base: 4000 }],
    target: "product",
    promos: [allDay("cero", "fixed_price", 0)],
    probes: [{ branch: "ba", at: "2026-12-18T15:00:00Z", price: 0, promo: "cero", endsLocal: "2026-12-19T00:00:00" }],
  },
  {
    key: "precio-fijo-mayor-al-de-lista",
    products: [{ key: "p", base: 8000 }],
    target: "product",
    promos: [allDay("caro", "fixed_price", 9000)],
    probes: [{ branch: "ba", at: "2026-12-18T15:00:00Z", price: 8000, promo: null }],
  },
  {
    key: "precio-fijo-igual-al-de-lista",
    products: [{ key: "p", base: 8000 }],
    target: "product",
    promos: [allDay("igual", "fixed_price", 8000)],
    probes: [{ branch: "ba", at: "2026-12-18T15:00:00Z", price: 8000, promo: null }],
  },
  {
    key: "gana-el-precio-mas-bajo",
    products: [{ key: "p", base: 10000 }],
    target: "product",
    promos: [
      allDay("diez", "percent", 10), // 9000
      allDay("fijo", "fixed_price", 7000), // 7000
      allDay("monto", "amount", 2000), // 8000
      allDay("pausada", "fixed_price", 1000, { paused: true }), // 1000, pero pausada
    ],
    probes: [{ branch: "ba", at: "2026-12-18T15:00:00Z", price: 7000, promo: "fijo", endsLocal: "2026-12-19T00:00:00" }],
  },
  {
    key: "empate-gana-la-mas-antigua",
    products: [{ key: "p", base: 10000 }],
    target: "product",
    promos: [allDay("treinta", "percent", 30), allDay("fijo", "fixed_price", 7000)], // las dos dan 7000
    probes: [{ branch: "ba", at: "2026-12-18T15:00:00Z", price: 7000, promo: "treinta", endsLocal: "2026-12-19T00:00:00" }],
  },
  {
    key: "empate-gana-la-mas-antigua-2",
    products: [{ key: "p", base: 10000 }],
    target: "product",
    promos: [allDay("fijo", "fixed_price", 7000), allDay("treinta", "percent", 30)],
    probes: [{ branch: "ba", at: "2026-12-18T15:00:00Z", price: 7000, promo: "fijo", endsLocal: "2026-12-19T00:00:00" }],
  },
  {
    key: "horario-de-verano-primavera-nueva-york",
    products: [{ key: "p", base: 5000 }],
    target: "product",
    promos: [allDay("d", "percent", 20, { from: "02:30", to: "04:00" })],
    probes: [
      { branch: "ny", at: "2026-03-07T07:30:00Z", price: 4000, promo: "d", endsLocal: "2026-03-07T04:00:00" }, // sáb 02:30 EST
      { branch: "ny", at: "2026-03-08T06:59:00Z", price: 5000, promo: null }, // dom 01:59 EST, un minuto antes del salto
      { branch: "ny", at: "2026-03-08T07:00:00Z", price: 4000, promo: "d", endsLocal: "2026-03-08T04:00:00" }, // 03:00 EDT (la 02:xx no existió)
      { branch: "ny", at: "2026-03-08T07:59:00Z", price: 4000, promo: "d", endsLocal: "2026-03-08T04:00:00" }, // 03:59 EDT
      { branch: "ny", at: "2026-03-08T08:00:00Z", price: 5000, promo: null }, // 04:00 EDT
    ],
  },
  {
    key: "horario-de-verano-otono-nueva-york",
    products: [{ key: "p", base: 5000 }],
    target: "product",
    promos: [allDay("d", "percent", 20, { from: "01:30", to: "02:30" })],
    probes: [
      { branch: "ny", at: "2026-11-01T05:29:00Z", price: 5000, promo: null }, // 01:29 EDT
      { branch: "ny", at: "2026-11-01T05:30:00Z", price: 4000, promo: "d", endsLocal: "2026-11-01T02:30:00" }, // 01:30 EDT
      { branch: "ny", at: "2026-11-01T06:00:00Z", price: 5000, promo: null }, // 01:00 EST: la hora de pared repetida, todavía antes de las 01:30
      { branch: "ny", at: "2026-11-01T06:30:00Z", price: 4000, promo: "d", endsLocal: "2026-11-01T02:30:00" }, // 01:30 EST
      { branch: "ny", at: "2026-11-01T07:29:00Z", price: 4000, promo: "d", endsLocal: "2026-11-01T02:30:00" }, // 02:29 EST
      { branch: "ny", at: "2026-11-01T07:30:00Z", price: 5000, promo: null }, // 02:30 EST
    ],
  },
  {
    key: "por-categoria",
    products: [
      { key: "a", base: 2000 },
      { key: "b", base: 500 },
    ],
    target: "category",
    promos: [allDay("cat", "percent", 10)],
    probes: [
      { branch: "ba", at: "2026-12-18T15:00:00Z", product: "a", price: 1800, promo: "cat", endsLocal: "2026-12-19T00:00:00" },
      { branch: "ba", at: "2026-12-18T15:00:00Z", product: "b", price: 450, promo: "cat", endsLocal: "2026-12-19T00:00:00" },
    ],
  },
  {
    key: "por-plato-no-alcanza-a-los-demas",
    products: [
      { key: "a", base: 2000 },
      { key: "b", base: 500 },
    ],
    target: "product",
    promos: [allDay("solo-a", "percent", 10)],
    probes: [
      { branch: "ba", at: "2026-12-18T15:00:00Z", product: "a", price: 1800, promo: "solo-a", endsLocal: "2026-12-19T00:00:00" },
      { branch: "ba", at: "2026-12-18T15:00:00Z", product: "b", price: 500, promo: null },
    ],
  },
  {
    key: "solo-en-algunas-sucursales",
    products: [{ key: "p", base: 4000 }],
    target: "product",
    promos: [allDay("ba", "percent", 25, { branches: ["ba"] })],
    probes: [
      { branch: "ba", at: "2026-12-18T15:00:00Z", price: 3000, promo: "ba", endsLocal: "2026-12-19T00:00:00" },
      { branch: "madrid", at: "2026-12-18T15:00:00Z", price: 4000, promo: null },
      { branch: "ny", at: "2026-12-18T15:00:00Z", price: 4000, promo: null },
    ],
  },
  {
    key: "precio-propio-de-la-sucursal-como-base",
    products: [{ key: "p", base: 10000, branchPrices: { madrid: 12000, ny: 8000 } }],
    target: "product",
    promos: [allDay("diez", "percent", 10)],
    probes: [
      { branch: "ba", at: "2026-12-18T15:00:00Z", price: 9000, promo: "diez", endsLocal: "2026-12-19T00:00:00" },
      { branch: "madrid", at: "2026-12-18T15:00:00Z", price: 10800, promo: "diez", endsLocal: "2026-12-19T00:00:00" },
      { branch: "ny", at: "2026-12-18T15:00:00Z", price: 7200, promo: "diez", endsLocal: "2026-12-19T00:00:00" },
    ],
  },
  {
    key: "cada-sucursal-con-su-reloj",
    products: [{ key: "p", base: 5000 }],
    target: "product",
    promos: [{ key: "sab", type: "percent", value: 20, days: [6], from: "10:00", to: "12:00" }],
    probes: [
      { branch: "madrid", at: "2026-12-19T09:30:00Z", price: 4000, promo: "sab", endsLocal: "2026-12-19T12:00:00" }, // Madrid sáb 10:30
      { branch: "ba", at: "2026-12-19T09:30:00Z", price: 5000, promo: null }, // Buenos Aires sáb 06:30
      { branch: "ny", at: "2026-12-19T09:30:00Z", price: 5000, promo: null }, // Nueva York sáb 04:30
      { branch: "ba", at: "2026-12-19T13:30:00Z", price: 4000, promo: "sab", endsLocal: "2026-12-19T12:00:00" }, // Buenos Aires sáb 10:30
    ],
  },
  {
    key: "medianoche-de-madrid",
    products: [{ key: "p", base: 5000 }],
    target: "product",
    promos: [{ key: "tarde", type: "percent", value: 20, days: [6], from: "23:00", to: "01:00" }],
    probes: [
      { branch: "madrid", at: "2026-12-19T22:30:00Z", price: 4000, promo: "tarde", endsLocal: "2026-12-20T01:00:00" }, // sáb 23:30
      { branch: "madrid", at: "2026-12-19T23:59:00Z", price: 4000, promo: "tarde", endsLocal: "2026-12-20T01:00:00" }, // dom 00:59: es la franja del sábado
      { branch: "madrid", at: "2026-12-20T00:00:00Z", price: 5000, promo: null }, // dom 01:00
      { branch: "ba", at: "2026-12-19T23:59:00Z", price: 5000, promo: null }, // Buenos Aires sáb 20:59
    ],
  },
];
