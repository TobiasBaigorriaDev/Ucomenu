import { describe, expect, it } from "vitest";
import type { AnotarLine } from "./anotar";
import { buildPrecuenta, formatLocal, PRECUENTA_LEGEND, statusNotice } from "./precuenta";

const linea = (extra: Partial<AnotarLine>): AnotarLine => ({
  id: "l",
  productName: "Bife",
  quantity: 1,
  status: "noted",
  unitPriceCents: 10000,
  optionsCents: 0,
  note: null,
  cancelReason: null,
  options: [],
  ...extra,
});

describe("armado de la precuenta", () => {
  it("cada línea vale cantidad por (precio efectivo + opciones) y el total las suma", () => {
    const body = buildPrecuenta([
      linea({ quantity: 2, optionsCents: 2500, options: [{ group: "Extras", name: "Bacon", deltaCents: 1500 }, { group: "Extras", name: "Huevo", deltaCents: 1000 }] }),
      linea({ productName: "Flan", unitPriceCents: 3000 }),
    ]);
    expect(body.lines).toEqual([
      { quantity: 2, name: "Bife", options: ["Bacon", "Huevo"], unitCents: 12500, lineCents: 25000 },
      { quantity: 1, name: "Flan", options: [], unitCents: 3000, lineCents: 3000 },
    ]);
    expect(body.totalCents).toBe(28000);
    expect(body.dishes).toBe(3);
  });

  it("las líneas canceladas no salen ni suman; las anotadas, en cocina y entregadas sí", () => {
    const body = buildPrecuenta([
      linea({ productName: "Anotado", status: "noted" }),
      linea({ productName: "En cocina", status: "in_kitchen" }),
      linea({ productName: "Entregado", status: "delivered" }),
      linea({ productName: "Cancelado", status: "cancelled", quantity: 9 }),
    ]);
    expect(body.lines.map((l) => l.name)).toEqual(["Anotado", "En cocina", "Entregado"]);
    expect(body.totalCents).toBe(30000);
    expect(body.dishes).toBe(3);
  });

  it("no lleva las observaciones de cocina ni los motivos de cancelación", () => {
    const body = buildPrecuenta([linea({ note: "sin sal, alérgico a la nuez", cancelReason: "no" })]);
    expect(JSON.stringify(body)).not.toContain("sin sal");
    expect(JSON.stringify(body)).not.toContain("alérgico");
  });

  it("sin líneas vigentes: lista vacía y total cero", () => {
    expect(buildPrecuenta([])).toEqual({ lines: [], dishes: 0, totalCents: 0 });
    expect(buildPrecuenta([linea({ status: "cancelled" })])).toEqual({ lines: [], dishes: 0, totalCents: 0 });
  });

  it("no desborda con 99 unidades de 50 opciones del máximo importe", () => {
    const body = buildPrecuenta([linea({ quantity: 99, unitPriceCents: 2_000_000_000, optionsCents: 50 * 1_000_000_000 })]);
    expect(Number.isSafeInteger(body.totalCents)).toBe(true);
    expect(body.totalCents).toBe(99 * (2_000_000_000 + 50_000_000_000));
  });

  it("lleva siempre la leyenda de que no es una factura", () => {
    expect(PRECUENTA_LEGEND).toBe("No válida como factura");
  });
});

describe("fecha y estado", () => {
  it("muestra la hora de la zona de la sucursal, en 24 horas", () => {
    // 2026-10-24 00:30 UTC es 21:30 del día anterior en Buenos Aires (UTC-3).
    expect(formatLocal("2026-10-24T00:30:00Z", "America/Argentina/Buenos_Aires")).toBe("23/10/2026 21:30");
    expect(formatLocal("2026-10-24T15:05:00Z", "UTC")).toBe("24/10/2026 15:05");
    expect(formatLocal(new Date("2026-10-24T23:59:00Z"), "America/Argentina/Buenos_Aires")).toBe("24/10/2026 20:59");
  });

  it("una zona desconocida no rompe la precuenta: usa la de Buenos Aires", () => {
    expect(formatLocal("2026-10-24T15:05:00Z", "Zona/Inventada")).toBe("24/10/2026 12:05");
  });

  it("solo el pedido cerrado o anulado lleva aviso; el abierto no", () => {
    expect(statusNotice("open")).toBeNull();
    expect(statusNotice("closed")).toBe("Pedido cerrado");
    expect(statusNotice("void")).toContain("anulado");
  });
});
