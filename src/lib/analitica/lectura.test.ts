import { describe, expect, it } from "vitest";
import { barPercent, callsOf, hourRange, parseCallsByHour, parseTopDishes, peakHours, plural, totalCalls } from "./lectura";

const FILA = { product_id: "0b6f3d8c-0000-4000-8000-000000000001", name: "Milanesa", views: 8, total_views: 12, is_active: true };

describe("platos más vistos", () => {
  it("lee las filas y toma el total del período", () => {
    const r = parseTopDishes([FILA, { ...FILA, product_id: "otro", name: "Flan", views: 4, is_active: false }])!;
    expect(r.dishes).toEqual([
      { id: FILA.product_id, name: "Milanesa", views: 8, active: true },
      { id: "otro", name: "Flan", views: 4, active: false },
    ]);
    expect(r.total).toBe(12);
  });

  it("un plato sin la marca de activo se toma como activo (no se oculta nada por un dato ausente)", () => {
    expect(parseTopDishes([{ ...FILA, is_active: undefined }])!.dishes[0].active).toBe(true);
  });

  it("sin filas es una lista vacía con total 0 (no un error)", () => {
    expect(parseTopDishes([])).toEqual({ dishes: [], total: 0 });
  });

  it.each([
    ["no es una lista", { filas: [] }],
    ["vistas como texto", [{ ...FILA, views: "8" }]],
    ["vistas negativas", [{ ...FILA, views: -1 }]],
    ["sin nombre", [{ ...FILA, name: undefined }]],
    ["falta el total", [{ ...FILA, total_views: null }]],
    ["una fila que no es objeto", [FILA, 3]],
  ])("una forma inesperada (%s) es un error, no una lista a medias", (_nombre, entrada) => {
    expect(parseTopDishes(entrada)).toBeNull();
  });
});

describe("llamados por hora", () => {
  it("completa las 24 horas del día con ceros", () => {
    const horas = parseCallsByHour([
      { hour_of_day: 13, waiter: 5, bill: 2 },
      { hour_of_day: 21, waiter: 0, bill: 3 },
    ])!;
    expect(horas).toHaveLength(24);
    expect(horas[13]).toEqual({ hour: 13, waiter: 5, bill: 2 });
    expect(horas[0]).toEqual({ hour: 0, waiter: 0, bill: 0 });
    expect(totalCalls(horas)).toBe(10);
  });

  it.each([
    ["una hora fuera de rango", [{ hour_of_day: 24, waiter: 1, bill: 0 }]],
    ["una hora con decimales", [{ hour_of_day: 3.5, waiter: 1, bill: 0 }]],
    ["una cantidad como texto", [{ hour_of_day: 3, waiter: "1", bill: 0 }]],
    ["una cantidad negativa", [{ hour_of_day: 3, waiter: 1, bill: -1 }]],
    ["no es una lista", null],
  ])("%s es un error", (_nombre, entrada) => {
    expect(parseCallsByHour(entrada)).toBeNull();
  });

  it("la hora pico es la de más llamados, o varias si empatan, o ninguna si no hubo", () => {
    const horas = parseCallsByHour([
      { hour_of_day: 13, waiter: 5, bill: 2 },
      { hour_of_day: 20, waiter: 4, bill: 3 },
      { hour_of_day: 21, waiter: 1, bill: 0 },
    ])!;
    expect(peakHours(horas).map((h) => h.hour)).toEqual([13, 20]);
    expect(callsOf(horas[13])).toBe(7);
    expect(peakHours(parseCallsByHour([])!)).toEqual([]);
  });

  it("el rango de una hora se lee «13 a 14 h» y la última, «23 a 24 h»", () => {
    expect(hourRange(13)).toBe("13 a 14 h");
    expect(hourRange(0)).toBe("0 a 1 h");
    expect(hourRange(23)).toBe("23 a 24 h");
  });
});

describe("barras y textos", () => {
  it("el ancho es proporcional al máximo y una barra con valor nunca desaparece", () => {
    expect(barPercent(10, 10)).toBe(100);
    expect(barPercent(5, 10)).toBe(50);
    expect(barPercent(1, 1000)).toBe(2); // mínimo visible
    expect(barPercent(0, 10)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
    expect(barPercent(50, 10)).toBe(100); // nunca pasa del 100 %
  });

  it("singular y plural", () => {
    expect(plural(1, "vista", "vistas")).toBe("1 vista");
    expect(plural(0, "vista", "vistas")).toBe("0 vistas");
    expect(plural(12, "llamado", "llamados")).toBe("12 llamados");
  });
});
