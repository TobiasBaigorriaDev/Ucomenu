import { describe, expect, it } from "vitest";
import {
  lineCents,
  orderCents,
  orderStatusText,
  parseMesasState,
  sortMesas,
  summarizeOrder,
  type MesaCard,
  type MesasState,
  type OrderLine,
} from "./mesas";
import { parseSalaState } from "./types";

const linea = (over: Partial<OrderLine> = {}): OrderLine => ({ status: "noted", quantity: 1, unitPriceCents: 1000, optionsCents: 0, ...over });

describe("total del pedido", () => {
  it("una línea vale cantidad por (precio efectivo + opciones)", () => {
    expect(lineCents({ quantity: 3, unitPriceCents: 1000, optionsCents: 250 })).toBe(3750);
    expect(lineCents({ quantity: 1, unitPriceCents: 0, optionsCents: 0 })).toBe(0);
  });

  it("el pedido suma las líneas y NO las canceladas", () => {
    const lineas = [
      linea({ quantity: 2, unitPriceCents: 5000, optionsCents: 400 }),
      linea({ status: "in_kitchen", unitPriceCents: 700 }),
      linea({ status: "delivered", quantity: 3, unitPriceCents: 100 }),
      linea({ status: "cancelled", quantity: 9, unitPriceCents: 99999 }),
    ];
    expect(orderCents(lineas)).toBe(2 * 5400 + 700 + 300);
    expect(orderCents([])).toBe(0);
    expect(orderCents([linea({ status: "cancelled" })])).toBe(0);
  });

  it("las opciones más grandes no desbordan: 99 unidades de 50 opciones de la diferencia máxima", () => {
    const total = orderCents([linea({ quantity: 99, unitPriceCents: 1_000_000_000, optionsCents: 50_000_000_000 })]);
    expect(total).toBe(99 * 51_000_000_000);
    expect(Number.isSafeInteger(total)).toBe(true);
  });
});

describe("resumen del pedido abierto", () => {
  it("cuenta platos y estados en unidades, y suma el total sin lo cancelado", () => {
    const resumen = summarizeOrder("2026-10-24T10:00:00.000Z", [
      linea({ quantity: 2 }),
      linea({ status: "in_kitchen", quantity: 1 }),
      linea({ status: "delivered", quantity: 3 }),
      linea({ status: "cancelled", quantity: 5 }),
    ]);
    expect(resumen).toEqual({ openedAt: "2026-10-24T10:00:00.000Z", dishes: 6, noted: 2, inKitchen: 1, delivered: 3, totalCents: 6000 });
  });

  it("sin líneas vivas no hay resumen: la mesa se ve libre", () => {
    expect(summarizeOrder("2026-10-24T10:00:00.000Z", [])).toBeNull();
    expect(summarizeOrder("2026-10-24T10:00:00.000Z", [linea({ status: "cancelled" })])).toBeNull();
  });

  it("el texto de estado omite los estados en cero y usa singular", () => {
    const base = { openedAt: "2026-10-24T10:00:00.000Z", totalCents: 0 };
    expect(orderStatusText({ ...base, dishes: 1, noted: 1, inKitchen: 0, delivered: 0 })).toBe("1 plato · 1 anotado");
    expect(orderStatusText({ ...base, dishes: 6, noted: 2, inKitchen: 1, delivered: 3 })).toBe("6 platos · 2 anotados · 1 en cocina · 3 entregados");
    expect(orderStatusText({ ...base, dishes: 2, noted: 0, inKitchen: 0, delivered: 2 })).toBe("2 platos · 2 entregados");
  });
});

const carta = (label: string, over: Partial<MesaCard> = {}): MesaCard => ({ tableId: label, tableLabel: label, branchName: "Centro", calls: [], order: null, ...over });
const pedido = (openedAt: string) => ({ openedAt, dishes: 1, noted: 1, inKitchen: 0, delivered: 0, totalCents: 1000 });

describe("orden de las mesas", () => {
  it("cuenta, después llamado, después pedido (el más antiguo primero) y al final las libres; dentro de cada grupo, por etiqueta numérica", () => {
    const mesas = [
      carta("Mesa 10"),
      carta("Mesa 2"),
      carta("Mesa 3", { order: pedido("2026-10-24T11:00:00.000Z") }),
      carta("Mesa 4", { order: pedido("2026-10-24T09:00:00.000Z") }),
      carta("Mesa 5", { calls: [{ kind: "waiter", createdAt: "2026-10-24T11:50:00.000Z" }] }),
      carta("Mesa 6", { calls: [{ kind: "bill", createdAt: "2026-10-24T11:55:00.000Z" }], order: pedido("2026-10-24T10:00:00.000Z") }),
      carta("Mesa 7", { calls: [{ kind: "bill", createdAt: "2026-10-24T11:40:00.000Z" }] }),
      carta("Mesa 8", { calls: [{ kind: "waiter", createdAt: "2026-10-24T11:45:00.000Z" }] }),
    ];
    expect(sortMesas(mesas).map((m) => m.tableLabel)).toEqual(["Mesa 7", "Mesa 6", "Mesa 8", "Mesa 5", "Mesa 4", "Mesa 3", "Mesa 2", "Mesa 10"]);
  });

  it("no modifica la lista recibida", () => {
    const mesas = [carta("Mesa 2"), carta("Mesa 1")];
    sortMesas(mesas);
    expect(mesas.map((m) => m.tableLabel)).toEqual(["Mesa 2", "Mesa 1"]);
  });
});

const estado = (over: Record<string, unknown> = {}) => ({
  serverNow: "2026-10-24T12:00:00.000Z",
  enabled: true,
  multiBranch: false,
  branches: [{ id: "b1", name: "Centro" }],
  view: [],
  mesas: [
    {
      tableId: "t1",
      tableLabel: "Mesa 1",
      branchName: "Centro",
      calls: [{ kind: "bill", createdAt: "2026-10-24T11:58:00.000Z" }],
      order: { openedAt: "2026-10-24T11:00:00.000Z", dishes: 3, noted: 1, inKitchen: 1, delivered: 1, totalCents: 450000 },
    },
    { tableId: "t2", tableLabel: "Mesa 2", branchName: "Centro", calls: [], order: null },
  ],
  ...over,
});

describe("respuesta de la ruta de consulta", () => {
  it("lee una respuesta válida", () => {
    const leido = parseMesasState(estado()) as MesasState;
    expect(leido.mesas).toHaveLength(2);
    expect(leido.mesas[0].order?.totalCents).toBe(450000);
    expect(leido.mesas[1].order).toBeNull();
  });

  it("cualquier forma inesperada es nula (la pantalla lo trata como error)", () => {
    expect(parseMesasState(null)).toBeNull();
    expect(parseMesasState({})).toBeNull();
    expect(parseMesasState(estado({ serverNow: "nunca" }))).toBeNull();
    expect(parseMesasState(estado({ enabled: "sí" }))).toBeNull();
    expect(parseMesasState(estado({ view: [1] }))).toBeNull();
    expect(parseMesasState(estado({ branches: [{ id: 1 }] }))).toBeNull();
    expect(parseMesasState(estado({ mesas: [{ tableId: "t" }] }))).toBeNull();
    const malaCuenta = estado();
    (malaCuenta.mesas[0].order as { totalCents: number }).totalCents = -5;
    expect(parseMesasState(malaCuenta)).toBeNull();
    const malLlamado = estado();
    (malLlamado.mesas[0].calls[0] as { kind: string }).kind = "otro";
    expect(parseMesasState(malLlamado)).toBeNull();
  });
});

describe("el total en «Pide la cuenta» de la Sala de llamados", () => {
  const sala = (call: Record<string, unknown>) => ({
    serverNow: "2026-10-24T12:00:00.000Z",
    enabled: true,
    multiBranch: false,
    branches: [],
    view: [],
    othersPending: 0,
    calls: [{ id: "c1", kind: "bill", tableLabel: "Mesa 4", branchName: "Centro", createdAt: "2026-10-24T11:58:00.000Z", visitStartedAt: null, ...call }],
  });

  it("lee el total y los platos; sin el campo (una respuesta anterior) no hay total", () => {
    expect(parseSalaState(sala({ account: { totalCents: 123400, dishes: 4 } }))?.calls[0].account).toEqual({ totalCents: 123400, dishes: 4 });
    expect(parseSalaState(sala({}))?.calls[0].account).toBeUndefined();
  });

  it("un total ilegible es «sin pedido», nunca un importe inventado", () => {
    for (const account of [{ totalCents: -1, dishes: 1 }, { totalCents: 1.5, dishes: 1 }, { totalCents: "100", dishes: 1 }, { totalCents: 100 }, "x", 7]) {
      expect(parseSalaState(sala({ account }))?.calls[0].account, JSON.stringify(account)).toBeUndefined();
    }
  });
});
