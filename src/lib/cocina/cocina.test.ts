import { describe, expect, it } from "vitest";
import {
  countUnits,
  isStaleKitchen,
  kitchenFailureFromDb,
  optionsText,
  parseAvailabilityInput,
  parseKitchenBranches,
  parseKitchenMenu,
  parseKitchenOrders,
  parseKitchenState,
  parseReadyInput,
  sortKitchenOrders,
  type KitchenItem,
  type KitchenOrder,
} from "./cocina";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const wireItem = (over: Record<string, unknown> = {}) => ({
  id: U(1),
  name: "Hamburguesa",
  quantity: 2,
  note: null,
  status: "noted",
  created_at: "2026-10-26T12:00:00.000Z",
  options: [{ group: "Punto", option: "Jugoso" }],
  ...over,
});

const wireOrder = (over: Record<string, unknown> = {}) => ({
  order_id: U(10),
  table_label: "Mesa 4",
  branch_id: U(20),
  branch_name: "Centro",
  opened_at: "2026-10-26T12:00:00.000Z",
  items: [wireItem()],
  ...over,
});

const item = (over: Partial<KitchenItem> = {}): KitchenItem => ({
  id: U(1),
  name: "Hamburguesa",
  quantity: 1,
  note: null,
  status: "noted",
  createdAt: "2026-10-26T12:00:00.000Z",
  options: [],
  ...over,
});

const order = (label: string, openedAt: string, items: KitchenItem[]): KitchenOrder => ({ orderId: label, tableLabel: label, branchId: U(20), branchName: "Centro", openedAt, items });

describe("lectura de los pedidos de la base", () => {
  it("lee mesa, plato, cantidad, opciones y observación, sin precios", () => {
    const parsed = parseKitchenOrders({ server_now: "2026-10-26T12:05:00.000Z", orders: [wireOrder({ items: [wireItem({ note: "sin sal" })] })] });
    expect(parsed?.orders).toEqual([
      {
        orderId: U(10),
        tableLabel: "Mesa 4",
        branchId: U(20),
        branchName: "Centro",
        openedAt: "2026-10-26T12:00:00.000Z",
        items: [{ id: U(1), name: "Hamburguesa", quantity: 2, note: "sin sal", status: "noted", createdAt: "2026-10-26T12:00:00.000Z", options: [{ group: "Punto", option: "Jugoso" }] }],
      },
    ]);
    expect(JSON.stringify(parsed)).not.toMatch(/price|cents|total/i);
  });

  it("una observación vacía es «sin observación» y un pedido sin líneas legibles no se muestra", () => {
    const parsed = parseKitchenOrders({
      server_now: "2026-10-26T12:05:00.000Z",
      orders: [wireOrder({ items: [wireItem({ note: "" })] }), wireOrder({ order_id: U(11), items: [wireItem({ status: "delivered" })] }), wireOrder({ order_id: U(12), items: null })],
    });
    expect(parsed?.orders).toHaveLength(1);
    expect(parsed?.orders[0].items[0].note).toBeNull();
  });

  it("una respuesta con otra forma es null: nunca se muestra una lista vacía como si no hubiera pedidos", () => {
    for (const bad of [null, [], {}, { server_now: "no es fecha", orders: [] }, { server_now: "2026-10-26T12:05:00.000Z" }, { server_now: "2026-10-26T12:05:00.000Z", orders: "x" }]) {
      expect(parseKitchenOrders(bad)).toBeNull();
    }
  });

  it("lee las sucursales y la carta (platos con su disponibilidad)", () => {
    expect(parseKitchenBranches([{ id: U(1), name: "Centro" }])).toEqual([{ id: U(1), name: "Centro" }]);
    expect(parseKitchenBranches([{ id: U(1), name: "Centro" }, { id: 5 }])).toBeNull();
    expect(parseKitchenBranches({})).toBeNull();
    expect(
      parseKitchenMenu({
        categories: [
          { id: U(1), name: "Platos", products: [{ id: U(2), name: "Milanesa", available: false }, { id: U(3), name: "x", available: "si" }] },
          { id: U(4), name: "Vacía", products: [] },
        ],
      }),
    ).toEqual([{ id: U(1), name: "Platos", products: [{ id: U(2), name: "Milanesa", available: false }] }]);
    expect(parseKitchenMenu(null)).toBeNull();
  });
});

describe("estado recibido por el sondeo", () => {
  const state = (over: Record<string, unknown> = {}) => ({
    serverNow: "2026-10-26T12:00:00.000Z",
    enabled: true,
    branches: [{ id: U(20), name: "Centro" }],
    orders: [order("Mesa 4", "2026-10-26T11:50:00.000Z", [item()])],
    ...over,
  });

  it("acepta la forma normalizada y rechaza cualquier otra", () => {
    expect(parseKitchenState(state())).toEqual(state());
    for (const bad of [null, {}, state({ enabled: "si" }), state({ serverNow: "x" }), state({ orders: "x" }), state({ branches: [{ id: 1 }, null] }), state({ orders: [{ orderId: "x" }] }), state({ orders: [order("M", "2026-10-26T11:50:00.000Z", [item({ status: "delivered" as never })])] })]) {
      expect(parseKitchenState(bad)).toBeNull();
    }
  });

  it("un local sin permiso llega como enabled: false, sin pedidos", () => {
    expect(parseKitchenState(state({ enabled: false, orders: [] }))?.enabled).toBe(false);
  });
});

describe("qué se muestra", () => {
  it("cuenta unidades pendientes (anotadas o en cocina) y listas", () => {
    expect(
      countUnits([item({ quantity: 2 }), item({ status: "in_kitchen", quantity: 1 }), item({ status: "ready", quantity: 4 })]),
    ).toEqual({ pending: 3, ready: 4 });
    expect(countUnits([])).toEqual({ pending: 0, ready: 0 });
  });

  it("primero los pedidos con algo pendiente (el que más espera arriba) y al final los que ya están todos listos", () => {
    const sorted = sortKitchenOrders([
      order("Mesa 1", "2026-10-26T10:00:00.000Z", [item({ status: "ready" })]),
      order("Mesa 2", "2026-10-26T11:30:00.000Z", [item()]),
      order("Mesa 3", "2026-10-26T11:00:00.000Z", [item(), item({ status: "ready" })]),
      order("Mesa 10", "2026-10-26T11:00:00.000Z", [item()]),
    ]);
    expect(sorted.map((o) => o.tableLabel)).toEqual(["Mesa 3", "Mesa 10", "Mesa 2", "Mesa 1"]);
  });

  it("no modifica la lista recibida y junta las opciones en una frase", () => {
    const orders = [order("Mesa 2", "2026-10-26T11:30:00.000Z", [item()]), order("Mesa 1", "2026-10-26T11:00:00.000Z", [item()])];
    sortKitchenOrders(orders);
    expect(orders.map((o) => o.tableLabel)).toEqual(["Mesa 2", "Mesa 1"]);
    expect(optionsText([{ group: "Punto", option: "Jugoso" }, { group: "Extra", option: "Sin sal" }])).toBe("Jugoso · Sin sal");
    expect(optionsText([])).toBe("");
  });
});

describe("entrada de las acciones", () => {
  it("«listo» acepta solo ready o noted (deshacer) con un id válido", () => {
    expect(parseReadyInput({ itemId: U(1), target: "ready" })).toEqual({ itemId: U(1), target: "ready" });
    expect(parseReadyInput({ itemId: U(1).toUpperCase(), target: "noted" })).toEqual({ itemId: U(1), target: "noted" });
    for (const target of ["delivered", "cancelled", "in_kitchen", "", undefined, 1]) {
      expect(parseReadyInput({ itemId: U(1), target })).toBe("invalid");
    }
    for (const bad of [null, "x", [], {}, { target: "ready" }, { itemId: "no", target: "ready" }]) expect(parseReadyInput(bad)).toBe("invalid");
  });

  it("agotar pide plato y sucursal válidos y un booleano explícito", () => {
    expect(parseAvailabilityInput({ productId: U(1), branchId: U(2), available: false })).toEqual({ productId: U(1), branchId: U(2), available: false });
    for (const bad of [null, {}, { productId: U(1), branchId: U(2) }, { productId: U(1), branchId: U(2), available: "false" }, { productId: "x", branchId: U(2), available: true }, { productId: U(1), branchId: "x", available: true }]) {
      expect(parseAvailabilityInput(bad)).toBe("invalid");
    }
  });
});

describe("errores de la base", () => {
  it("traduce los nombres estables y deja lo desconocido como inesperado", () => {
    expect(kitchenFailureFromDb("orders_not_allowed")).toBe("not_allowed");
    expect(kitchenFailureFromDb(" item_not_found ")).toBe("item_gone");
    expect(kitchenFailureFromDb("order_not_open")).toBe("order_closed");
    expect(kitchenFailureFromDb("invalid_transition")).toBe("invalid_transition");
    expect(kitchenFailureFromDb("product_not_found")).toBe("product_gone");
    expect(kitchenFailureFromDb("branch_not_found")).toBe("branch_gone");
    expect(kitchenFailureFromDb("invalid_availability")).toBe("invalid");
    expect(kitchenFailureFromDb("algo raro")).toBe("unexpected");
    expect(kitchenFailureFromDb(undefined)).toBe("unexpected");
  });

  it("recarga la pantalla cuando ya no es como se mostraba, no cuando falta permiso o el dato es inválido", () => {
    expect(isStaleKitchen("invalid_transition")).toBe(true);
    expect(isStaleKitchen("item_gone")).toBe(true);
    expect(isStaleKitchen("not_allowed")).toBe(false);
    expect(isStaleKitchen("invalid")).toBe(false);
  });
});
