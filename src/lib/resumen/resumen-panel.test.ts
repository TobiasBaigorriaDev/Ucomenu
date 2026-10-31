import { describe, expect, it } from "vitest";
import type { Products, Sales } from "@/lib/analitica/ventas";
import type { MesaCard, MesasState } from "@/lib/sala/mesas";
import { buildAhora } from "./ahora";
import { buildAttention } from "./atencion";
import { barHeight, buildHoy, HOY_DAYS } from "./hoy";

const totals = { orders: 0, revenueCents: 0, units: 0, promoDiscountCents: 0, voidedOrders: 0, voidedCents: 0, cancelledUnits: 0, cancelledCents: 0, medianMinutes: null };

/** 14 días: `perDay(daysAgo)` da `[pedidos, centavos]`. */
function sales(perDay: (daysAgo: number) => [number, number], days = HOY_DAYS): Sales {
  const byDay = Array.from({ length: days }, (_, index) => {
    const daysAgo = days - 1 - index;
    const [orders, revenueCents] = perDay(daysAgo);
    return { daysAgo, orders, revenueCents };
  });
  return { days, current: totals, previous: totals, byDay, slots: [], categories: [], voidReasons: [], cancelReasons: [] };
}

describe("buildHoy", () => {
  it("compara hoy con el mismo día de la semana anterior y la semana con la anterior", () => {
    // Hoy: 2 pedidos, $ 30.000. Hace 7 días: 1 pedido, $ 20.000. Resto de la semana: 1 pedido de $ 10.000; semana anterior igual.
    const view = buildHoy(sales((ago) => (ago === 0 ? [2, 3_000_000] : ago === 7 ? [1, 2_000_000] : [1, 1_000_000])), null)!;
    expect(view.todayCents).toBe(3_000_000);
    expect(view.todayOrders).toBe(2);
    expect(view.sameWeekdayCents).toBe(2_000_000);
    expect(view.vsSameWeekday).toBe(50);
    expect(view.weekCents).toBe(3_000_000 + 6 * 1_000_000);
    expect(view.weekOrders).toBe(8);
    // Semana anterior: 1 día de $ 20.000 y 6 de $ 10.000.
    expect(view.weekVsPrevious).toBe(Math.round(((9_000_000 - 8_000_000) / 8_000_000) * 100));
    expect(view.bars).toHaveLength(7);
    expect(view.bars[6]).toEqual({ daysAgo: 0, cents: 3_000_000, orders: 2 });
    expect(view.bars[0].daysAgo).toBe(6);
  });

  it("no inventa una comparación si el día de la semana anterior no vendió", () => {
    const view = buildHoy(sales((ago) => (ago === 0 ? [1, 500_000] : [0, 0])), null)!;
    expect(view.vsSameWeekday).toBeNull();
    expect(view.weekVsPrevious).toBeNull();
  });

  it("sin pedidos en las dos semanas, lo dice (no son ceros que parezcan un dato)", () => {
    const view = buildHoy(sales(() => [0, 0]), null)!;
    expect(view.hasOrders).toBe(false);
    expect(view.weekTicketCents).toBeNull();
  });

  it("el ticket de la semana es el importe sobre los pedidos de la semana, a pesos enteros", () => {
    const view = buildHoy(sales((ago) => (ago < 7 ? [3, 1_000_001] : [0, 0])), null)!;
    // 7 días × $ 10.000,01 / 21 pedidos = $ 3.333,336… → $ 3.333.
    expect(view.weekTicketCents).toBe(333_300);
  });

  it("toma los platos más pedidos (3) y tolera que no lleguen", () => {
    const products: Products = {
      best: ["A", "B", "C", "D"].map((name, index) => ({ id: name, name, category: null, units: 10 - index, revenueCents: 0, views: 0, inCatalog: true, active: true })),
      unsold: [],
      unsoldTotal: 0,
    };
    expect(buildHoy(sales(() => [1, 1]), products)!.dishes.map((dish) => dish.name)).toEqual(["A", "B", "C"]);
    expect(buildHoy(sales(() => [1, 1]), null)!.dishes).toEqual([]);
  });

  it("rechaza una lectura que no es de 14 días", () => {
    expect(buildHoy(sales(() => [1, 1], 7), null)).toBeNull();
  });
});

describe("barHeight", () => {
  it("proporcional al mejor día, con piso visible para un día con ventas y cero sin ventas", () => {
    expect(barHeight(0, 100)).toBe(0);
    expect(barHeight(100, 100)).toBe(100);
    expect(barHeight(50, 100)).toBe(50);
    expect(barHeight(1, 1000)).toBe(6);
    expect(barHeight(10, 0)).toBe(0);
  });
});

const order = (over: Partial<NonNullable<MesaCard["order"]>> = {}) => ({
  openedAt: "2026-10-31T12:00:00Z",
  dishes: 3,
  noted: 1,
  inKitchen: 1,
  ready: 1,
  readyIds: ["x"],
  delivered: 0,
  totalCents: 500_000,
  ...over,
});
const mesa = (over: Partial<MesaCard> = {}): MesaCard => ({ tableId: "t", tableLabel: "1", branchName: "Centro", calls: [], order: null, ...over });
const state = (mesas: MesaCard[], over: Partial<MesasState> = {}): MesasState => ({
  serverNow: "2026-10-31T12:00:00Z",
  enabled: true,
  multiBranch: false,
  branches: [],
  view: [],
  othersPending: 0,
  mesas,
  ...over,
});

describe("buildAhora", () => {
  it("cuenta mesas con pedido, llamados por tipo, platos y total abierto", () => {
    const view = buildAhora(
      state([
        mesa({ tableId: "a", order: order(), calls: [{ id: "1", kind: "waiter", createdAt: "", visitStartedAt: null }] }),
        mesa({ tableId: "b", order: order({ noted: 0, inKitchen: 2, ready: 0, totalCents: 100_000 }), calls: [{ id: "2", kind: "bill", createdAt: "", visitStartedAt: null }] }),
        mesa({ tableId: "c" }),
      ]),
    )!;
    expect(view).toMatchObject({ tablesWithOrder: 2, tablesTotal: 3, pendingCalls: 2, waiterCalls: 1, billCalls: 1, inKitchen: 4, ready: 1, openCents: 600_000 });
  });

  it("sin pedidos en el plan o en la cuenta no hay salón que mostrar", () => {
    expect(buildAhora(state([], { enabled: false }))).toBeNull();
  });

  it("conserva la cantidad de llamados de las sucursales que no mira", () => {
    expect(buildAhora(state([mesa()], { othersPending: 2 }))!.othersPending).toBe(2);
  });
});

describe("buildAttention", () => {
  const base = { slug: "demo", pendingComments: 0, soldOutProducts: 0, usage: [] as { label: string; used: number; limit: number }[] };

  it("sin pendientes devuelve una lista vacía", () => {
    expect(buildAttention(base)).toEqual([]);
  });

  it("lista comentarios y agotados, con singular y plural, y enlaza donde se resuelven", () => {
    const items = buildAttention({ ...base, pendingComments: 1, soldOutProducts: 3 });
    expect(items.map((item) => item.id)).toEqual(["comentarios", "agotados"]);
    expect(items[0].text).toContain("1 comentario espera");
    expect(items[1].text).toContain("3 platos figuran agotados");
    expect(items[0].href).toBe("/panel/demo/comentarios");
    expect(items[1].href).toBe("/panel/demo/carta");
  });

  it("un dato que no se pudo leer (null) no se afirma", () => {
    expect(buildAttention({ ...base, pendingComments: null, soldOutProducts: null })).toEqual([]);
  });

  it("avisa del plan desde el 90 % del tope y en el tope; no antes", () => {
    const at = (used: number) => buildAttention({ ...base, usage: [{ label: "Platos activos", used, limit: 10 }] });
    expect(at(8)).toEqual([]);
    expect(at(9)[0].text).toContain("cerca del tope");
    expect(at(10)[0].text).toContain("llegaste al tope");
    expect(at(9)[0].href).toBe("/panel/demo/suscripcion");
  });

  it("un recurso sin tope (límite 0 o ausente) no genera aviso", () => {
    expect(buildAttention({ ...base, usage: [{ label: "Platos activos", used: 5, limit: 0 }] })).toEqual([]);
  });
});
