import { describe, expect, it } from "vitest";
import {
  averageTicket,
  busiestWeekday,
  changeLabel,
  dayLabel,
  hourSpan,
  minutesLabel,
  parsePeriod,
  parseProducts,
  parseSales,
  percentChange,
  sharePercent,
  slotLevel,
  slotMax,
  topSlots,
} from "./ventas";

const TOTALES = {
  orders: 3,
  revenue_cents: 49000,
  units: 7,
  promo_discount_cents: 1000,
  voided_orders: 1,
  voided_cents: 10000,
  cancelled_units: 4,
  cancelled_cents: 12000,
  median_minutes: 60,
};
const VENTAS = {
  days: 7,
  current: TOTALES,
  previous: { ...TOTALES, orders: 0, revenue_cents: 0, units: 0, median_minutes: null },
  by_day: [
    { days_ago: 1, orders: 2, revenue_cents: 36000 },
    { days_ago: 3, orders: 1, revenue_cents: 13000 },
  ],
  by_slot: [
    { dow: 5, hour: 21, orders: 4, revenue_cents: 90000 },
    { dow: 1, hour: 13, orders: 2, revenue_cents: 40000 },
  ],
  by_category: [
    { category_id: "c1", name: "Platos", units: 6, revenue_cents: 46000 },
    { category_id: null, name: null, units: 1, revenue_cents: 2000 },
  ],
  void_reasons: [{ reason: "Cliente se fue", orders: 1, cents: 10000 }],
  cancel_reasons: [{ reason: "", units: 4, cents: 12000 }],
};

describe("período de la dirección", () => {
  it.each([
    ["7", 7],
    ["30", 30],
    ["90", 90],
    [["7", "90"], 7],
    [undefined, 30],
    ["", 30],
    ["15", 30],
    ["0", 30],
    ["-7", 30],
    ["7.5", 30],
    ["007", 30],
    ["9999", 30],
    ["30; drop", 30],
    [7, 30],
  ])("%j da %j", (entrada, esperado) => {
    expect(parsePeriod(entrada)).toBe(esperado);
  });
});

describe("lectura de ventas", () => {
  it("lee los totales de los dos períodos y deja la mediana nula cuando no hubo pedidos", () => {
    const r = parseSales(VENTAS)!;
    expect(r.current).toEqual({
      orders: 3,
      revenueCents: 49000,
      units: 7,
      promoDiscountCents: 1000,
      voidedOrders: 1,
      voidedCents: 10000,
      cancelledUnits: 4,
      cancelledCents: 12000,
      medianMinutes: 60,
    });
    expect(r.previous.medianMinutes).toBeNull();
  });

  it("completa un punto por día, del más antiguo al de hoy, con ceros", () => {
    const r = parseSales(VENTAS)!;
    expect(r.byDay.map((d) => d.daysAgo)).toEqual([6, 5, 4, 3, 2, 1, 0]);
    expect(r.byDay.map((d) => d.revenueCents)).toEqual([0, 0, 0, 13000, 0, 36000, 0]);
    expect(r.byDay[5]).toEqual({ daysAgo: 1, orders: 2, revenueCents: 36000 });
  });

  it("arma la cuadrícula de lunes a domingo × 24 horas", () => {
    const r = parseSales(VENTAS)!;
    expect(r.slots).toHaveLength(7);
    expect(r.slots.every((fila) => fila.length === 24)).toBe(true);
    expect(r.slots[4][21]).toEqual({ orders: 4, revenueCents: 90000 });
    expect(r.slots[0][13]).toEqual({ orders: 2, revenueCents: 40000 });
    expect(r.slots[6][0]).toEqual({ orders: 0, revenueCents: 0 });
  });

  it("acepta una categoría sin nombre (plato borrado) y motivos vacíos", () => {
    const r = parseSales(VENTAS)!;
    expect(r.categories[1]).toEqual({ id: null, name: null, units: 1, revenueCents: 2000 });
    expect(r.cancelReasons).toEqual([{ reason: "", count: 4, cents: 12000 }]);
    expect(r.voidReasons).toEqual([{ reason: "Cliente se fue", count: 1, cents: 10000 }]);
  });

  it.each([
    ["no es un objeto", null],
    ["es una lista", []],
    ["sin días", { ...VENTAS, days: 0 }],
    ["total como texto", { ...VENTAS, current: { ...TOTALES, revenue_cents: "49000" } }],
    ["total negativo", { ...VENTAS, current: { ...TOTALES, orders: -1 } }],
    ["total con decimales", { ...VENTAS, current: { ...TOTALES, units: 1.5 } }],
    ["mediana inválida", { ...VENTAS, current: { ...TOTALES, median_minutes: "60" } }],
    ["falta el período anterior", { ...VENTAS, previous: undefined }],
    ["día fuera del período", { ...VENTAS, by_day: [{ days_ago: 7, orders: 1, revenue_cents: 1 }] }],
    ["día con importe inválido", { ...VENTAS, by_day: [{ days_ago: 1, orders: 1, revenue_cents: null }] }],
    ["día de la semana 8", { ...VENTAS, by_slot: [{ dow: 8, hour: 1, orders: 1, revenue_cents: 1 }] }],
    ["día de la semana 0", { ...VENTAS, by_slot: [{ dow: 0, hour: 1, orders: 1, revenue_cents: 1 }] }],
    ["hora 24", { ...VENTAS, by_slot: [{ dow: 1, hour: 24, orders: 1, revenue_cents: 1 }] }],
    ["categoría con id numérico", { ...VENTAS, by_category: [{ category_id: 3, name: "x", units: 1, revenue_cents: 1 }] }],
    ["motivo sin texto", { ...VENTAS, void_reasons: [{ reason: null, orders: 1, cents: 1 }] }],
    ["falta una lista", { ...VENTAS, by_slot: undefined }],
  ])("una forma inesperada (%s) es un error, no datos a medias", (_nombre, entrada) => {
    expect(parseSales(entrada)).toBeNull();
  });
});

describe("lectura de platos", () => {
  const PLATOS = {
    days: 30,
    best: [
      { product_id: "p1", name: "Milanesa", category: "Platos", units: 3, revenue_cents: 32000, views: 50, in_catalog: true, is_active: true },
      { product_id: null, name: "Efímero", category: null, units: 1, revenue_cents: 2000, views: 0, in_catalog: false, is_active: false },
    ],
    unsold_total: 3,
    unsold: [{ product_id: "p9", name: "Sopa", category: "Platos", views: 20 }],
  };

  it("lee los más vendidos y los que no se piden, con el total verdadero", () => {
    const r = parseProducts(PLATOS)!;
    expect(r.best[0]).toEqual({ id: "p1", name: "Milanesa", category: "Platos", units: 3, revenueCents: 32000, views: 50, inCatalog: true, active: true });
    expect(r.best[1]).toMatchObject({ id: null, inCatalog: false, active: false });
    expect(r.unsold).toEqual([{ id: "p9", name: "Sopa", category: "Platos", views: 20 }]);
    expect(r.unsoldTotal).toBe(3);
  });

  it("sin datos son listas vacías, no un error", () => {
    expect(parseProducts({ days: 30, best: [], unsold: [], unsold_total: 0 })).toEqual({ best: [], unsold: [], unsoldTotal: 0 });
  });

  it.each([
    ["no es un objeto", "x"],
    ["sin total", { ...PLATOS, unsold_total: undefined }],
    ["unidades como texto", { ...PLATOS, best: [{ ...PLATOS.best[0], units: "3" }] }],
    ["plato sin nombre", { ...PLATOS, best: [{ ...PLATOS.best[0], name: null }] }],
    ["sin plato en la lista de no pedidos", { ...PLATOS, unsold: [{ product_id: null, name: "x", category: null, views: 0 }] }],
    ["vistas negativas", { ...PLATOS, unsold: [{ ...PLATOS.unsold[0], views: -1 }] }],
  ])("una forma inesperada (%s) es un error", (_nombre, entrada) => {
    expect(parseProducts(entrada)).toBeNull();
  });
});

describe("comparaciones y etiquetas", () => {
  it("el ticket promedio es el importe sobre los pedidos a pesos enteros, y nulo sin pedidos", () => {
    const r = parseSales(VENTAS)!;
    expect(averageTicket(r.current)).toBe(16300); // 49000 / 3 = 163,33 pesos
    expect(averageTicket({ ...r.current, orders: 4 })).toBe(12300); // 122,50 sube a 123
    expect(averageTicket(r.previous)).toBeNull();
  });

  it("el cambio contra el período anterior se redondea y no se inventa cuando antes no hubo nada", () => {
    expect(percentChange(110, 100)).toBe(10);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(100, 100)).toBe(0);
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(null, 100)).toBeNull();
    expect(percentChange(100, null)).toBeNull();
    expect(percentChange(0, 100)).toBe(-100);
  });

  it("dice el cambio con signo, o «sin cambios»", () => {
    expect(changeLabel(12)).toBe("+12 %");
    expect(changeLabel(-8)).toBe("−8 %");
    expect(changeLabel(0)).toBe("sin cambios");
  });

  it("los minutos pasan a horas cuando conviene", () => {
    expect(minutesLabel(0)).toBe("0 min");
    expect(minutesLabel(45)).toBe("45 min");
    expect(minutesLabel(60)).toBe("1 h");
    expect(minutesLabel(80)).toBe("1 h 20 min");
    expect(minutesLabel(125)).toBe("2 h 5 min");
  });

  it("la franja horaria cierra en 24 h y el porcentaje no divide por cero", () => {
    expect(hourSpan(13)).toBe("13 a 14 h");
    expect(hourSpan(23)).toBe("23 a 24 h");
    expect(sharePercent(1, 3)).toBe(33);
    expect(sharePercent(1, 0)).toBe(0);
  });

  it("la fecha sale del calendario de la zona, no de restar 24 horas", () => {
    // 2026-03-10 02:00 UTC es 9 de marzo a la noche en Buenos Aires y 10 de marzo en Madrid.
    const ahora = new Date("2026-03-10T02:00:00Z");
    expect(dayLabel(0, "America/Argentina/Buenos_Aires", ahora)).toBe("lun 9 mar");
    expect(dayLabel(0, "Europe/Madrid", ahora)).toBe("mar 10 mar");
    expect(dayLabel(2, "America/Argentina/Buenos_Aires", ahora)).toBe("sáb 7 mar");
    expect(dayLabel(0, "America/Argentina/Buenos_Aires", ahora, true)).toBe("lunes, 9 de marzo");
    // Cruza el fin de mes sin saltar días.
    expect(dayLabel(1, "UTC", new Date("2026-03-01T12:00:00Z"))).toBe("sáb 28 feb");
  });
});

describe("franjas", () => {
  it("el máximo, la intensidad por tramos y las franjas más fuertes", () => {
    const slots = parseSales(VENTAS)!.slots;
    expect(slotMax(slots)).toBe(4);
    expect([0, 1, 2, 3, 4].map((n) => slotLevel(n, 4))).toEqual([0, 1, 2, 3, 4]);
    expect(slotLevel(5, 0)).toBe(0);
    expect(topSlots(slots)).toEqual([
      { dow: 5, hour: 21, orders: 4, revenueCents: 90000 },
      { dow: 1, hour: 13, orders: 2, revenueCents: 40000 },
    ]);
    expect(topSlots(slots, 1)).toHaveLength(1);
  });

  it("empata por importe y después por el día y la hora más temprana", () => {
    const base = parseSales({ ...VENTAS, by_slot: [] })!.slots;
    base[2][20] = { orders: 3, revenueCents: 100 };
    base[1][20] = { orders: 3, revenueCents: 100 };
    base[1][12] = { orders: 3, revenueCents: 999 };
    expect(topSlots(base).map((s) => [s.dow, s.hour])).toEqual([[2, 12], [2, 20], [3, 20]]);
  });

  it("el día más fuerte suma sus 24 horas; sin pedidos no hay ninguno", () => {
    const slots = parseSales(VENTAS)!.slots;
    expect(busiestWeekday(slots)).toEqual({ dow: 5, orders: 4 });
    expect(busiestWeekday(parseSales({ ...VENTAS, by_slot: [] })!.slots)).toBeNull();
    expect(topSlots(parseSales({ ...VENTAS, by_slot: [] })!.slots)).toEqual([]);
  });
});
