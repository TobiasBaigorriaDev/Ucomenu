import { describe, expect, it } from "vitest";
import {
  canEditLine,
  isStaleOperation,
  lineMoves,
  needsReason,
  operateFailureFromDb,
  parseCloseInput,
  parseEditInput,
  parseStatusInput,
  parseVoidInput,
  undeliveredUnits,
} from "./operar";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("qué se puede hacer con una línea", () => {
  it("avanza a entregado desde anotado, en cocina (heredado) o listo; sin marcha atrás; cancelar desde cualquiera salvo lo cancelado; «en cocina» ya no se ofrece", () => {
    expect(lineMoves("noted")).toEqual(["delivered", "cancelled"]);
    expect(lineMoves("in_kitchen")).toEqual(["delivered", "cancelled"]);
    expect(lineMoves("ready")).toEqual(["delivered", "cancelled"]);
    expect(lineMoves("delivered")).toEqual(["cancelled"]);
    expect(lineMoves("cancelled")).toEqual([]);
  });

  it("solo una línea anotada se modifica", () => {
    expect(canEditLine("noted")).toBe(true);
    for (const status of ["in_kitchen", "ready", "delivered", "cancelled"] as const) expect(canEditLine(status)).toBe(false);
  });

  it("cancelar una línea ya entregada exige motivo; las demás cancelaciones y los avances, no", () => {
    expect(needsReason("delivered", "cancelled")).toBe(true);
    expect(needsReason("noted", "cancelled")).toBe(false);
    expect(needsReason("in_kitchen", "cancelled")).toBe(false);
    expect(needsReason("noted", "delivered")).toBe(false);
  });

  it("cuenta como sin entregar las unidades anotadas, en cocina o listas, no las entregadas ni las canceladas", () => {
    expect(
      undeliveredUnits([
        { status: "noted", quantity: 2 },
        { status: "in_kitchen", quantity: 3 },
        { status: "ready", quantity: 6 },
        { status: "delivered", quantity: 4 },
        { status: "cancelled", quantity: 5 },
      ]),
    ).toBe(11);
    expect(undeliveredUnits([])).toBe(0);
  });
});

describe("entrada de las acciones", () => {
  it("el cambio de estado acepta solo los tres destinos y normaliza el motivo", () => {
    expect(parseStatusInput({ itemId: U(1), status: "in_kitchen" })).toEqual({ itemId: U(1), status: "in_kitchen", reason: null });
    expect(parseStatusInput({ itemId: U(1), status: "cancelled", reason: "  se arrepintió " })).toEqual({ itemId: U(1), status: "cancelled", reason: "se arrepintió" });
    expect(parseStatusInput({ itemId: U(1), status: "delivered", reason: "   " })).toMatchObject({ reason: null });
    for (const bad of [null, "x", [], {}, { itemId: "no", status: "delivered" }, { itemId: U(1), status: "noted" }, { itemId: U(1), status: "open" }, { itemId: U(1), status: "delivered", reason: 5 }, { itemId: U(1), status: "cancelled", reason: "a\nb" }, { itemId: U(1), status: "cancelled", reason: "a".repeat(201) }]) {
      expect(parseStatusInput(bad)).toBe("invalid");
    }
  });

  it("modificar pide cantidad entera de 1 a 99 y una observación que la base aceptaría (vacía = sin nota)", () => {
    expect(parseEditInput({ itemId: U(1), quantity: 3, note: "  sin sal " })).toEqual({ itemId: U(1), quantity: 3, note: "sin sal" });
    expect(parseEditInput({ itemId: U(1), quantity: 1, note: "" })).toMatchObject({ note: null });
    expect(parseEditInput({ itemId: U(1), quantity: 1 })).toMatchObject({ note: null });
    for (const quantity of [0, 100, 1.5, "2", null, Number.NaN]) expect(parseEditInput({ itemId: U(1), quantity })).toBe("invalid");
    expect(parseEditInput({ itemId: U(1), quantity: 2, note: "a\nb" })).toBe("invalid");
    expect(parseEditInput({ itemId: U(1), quantity: 2, note: "a".repeat(201) })).toBe("invalid");
    expect(parseEditInput({ itemId: "x", quantity: 2 })).toBe("invalid");
  });

  it("cerrar pide un id de pedido; anular, además un motivo opcional en la forma (la base exige que no esté vacío)", () => {
    expect(parseCloseInput({ orderId: U(2) })).toEqual({ orderId: U(2) });
    expect(parseCloseInput({ orderId: "x" })).toBe("invalid");
    expect(parseCloseInput(null)).toBe("invalid");
    expect(parseVoidInput({ orderId: U(2), reason: " Se fueron " })).toEqual({ orderId: U(2), reason: "Se fueron" });
    expect(parseVoidInput({ orderId: U(2) })).toEqual({ orderId: U(2), reason: null });
    expect(parseVoidInput({ orderId: U(2), reason: "a\tb" })).toBe("invalid");
    expect(parseVoidInput({ orderId: U(2), reason: 7 })).toBe("invalid");
  });
});

describe("errores de la base", () => {
  it("cada excepción conocida tiene su motivo y lo desconocido nunca se toma por éxito", () => {
    const casos: [string, string][] = [
      ["orders_not_allowed", "not_allowed"],
      ["item_not_found", "item_gone"],
      ["order_not_found", "order_gone"],
      ["order_not_open", "order_closed"],
      ["invalid_transition", "invalid_transition"],
      ["reason_required", "reason_required"],
      ["invalid_reason", "reason_invalid"],
      ["item_not_editable", "not_editable"],
      ["invalid_quantity", "quantity"],
      ["invalid_note", "note"],
      ["invalid_status", "invalid"],
      ["TypeError: fetch failed", "unexpected"],
    ];
    for (const [message, reason] of casos) expect(operateFailureFromDb(message)).toBe(reason);
    expect(operateFailureFromDb(undefined)).toBe("unexpected");
  });

  it("los fallos de un pedido que cambió (o de un resultado incierto) piden recargar; los de datos no", () => {
    for (const reason of ["item_gone", "order_gone", "order_closed", "invalid_transition", "not_editable", "unexpected"] as const) expect(isStaleOperation(reason)).toBe(true);
    for (const reason of ["reason_required", "reason_invalid", "quantity", "note", "not_allowed", "invalid"] as const) expect(isStaleOperation(reason)).toBe(false);
  });
});
