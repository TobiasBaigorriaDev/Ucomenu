import { describe, expect, it } from "vitest";
import { formatAsOf, parseAccount } from "./account";

const OK = {
  status: "ok",
  org_name: "La Bestia",
  branch_name: "Centro",
  table_label: "Mesa 7",
  time_zone: "America/Argentina/Buenos_Aires",
  as_of: "2026-10-25T00:15:00+00:00",
  lines: [
    { quantity: 2, name: "Bife", options: ["Bacon"], unit_cents: 11500, line_cents: 23000 },
    { quantity: 1, name: "Flan", options: [], unit_cents: 3000, line_cents: 3000 },
  ],
  dishes: 3,
  total_cents: 26000,
  tip_percent: null,
};

describe("leer la cuenta del comensal", () => {
  it("una respuesta válida se lee tal cual", () => {
    expect(parseAccount(OK)).toEqual({
      status: "ok",
      account: {
        orgName: "La Bestia",
        branchName: "Centro",
        tableLabel: "Mesa 7",
        timeZone: "America/Argentina/Buenos_Aires",
        asOf: "2026-10-25T00:15:00+00:00",
        lines: [
          { quantity: 2, name: "Bife", options: ["Bacon"], unitCents: 11500, lineCents: 23000 },
          { quantity: 1, name: "Flan", options: [], unitCents: 3000, lineCents: 3000 },
        ],
        dishes: 3,
        totalCents: 26000,
        tip: null,
      },
    });
  });

  it("sin platos vigentes y total cero es una cuenta válida", () => {
    expect(parseAccount({ ...OK, lines: [], dishes: 0, total_cents: 0 })).toMatchObject({ status: "ok", account: { lines: [], totalCents: 0 } });
  });

  it("expone consumo separado y propina calculada sobre las líneas vigentes", () => {
    expect(parseAccount({ ...OK, tip_percent: 10 })).toMatchObject({ status: "ok", account: {
      totalCents: 26000, tip: { percent: 10, cents: 2600, totalCents: 28600 },
    } });
    expect(parseAccount({ ...OK, tip_percent: 10, lines: [], dishes: 0, total_cents: 0 }))
      .toMatchObject({ status: "ok", account: { tip: null } });
    for (const percent of [undefined, 0, -1, 101, 10.5, "10"]) {
      expect(parseAccount({ ...OK, tip_percent: percent })).toEqual({ status: "error" });
    }
  });

  it("'empty' es vacío; 'not_found' y 'unavailable' son lo mismo para el comensal: escanear de nuevo", () => {
    expect(parseAccount({ status: "empty" })).toEqual({ status: "empty" });
    expect(parseAccount({ status: "not_found" })).toEqual({ status: "expired" });
    expect(parseAccount({ status: "unavailable" })).toEqual({ status: "expired" });
  });

  it("falla cerrado: formas inesperadas son error", () => {
    for (const raw of [null, undefined, "ok", 3, [], {}, { status: "otro" }, { status: "ok" }]) expect(parseAccount(raw)).toEqual({ status: "error" });
  });

  it("falla cerrado: un total que no cierra con las líneas, o importes inválidos, no se muestran", () => {
    for (const mala of [
      { ...OK, total_cents: 25999 },
      { ...OK, dishes: 4 },
      { ...OK, total_cents: -1 },
      { ...OK, total_cents: 260.5 },
      { ...OK, lines: [{ ...OK.lines[0], quantity: 0 }, OK.lines[1]] },
      { ...OK, lines: [{ ...OK.lines[0], name: "" }, OK.lines[1]] },
      { ...OK, lines: [{ ...OK.lines[0], options: [3] }, OK.lines[1]] },
      { ...OK, lines: [{ ...OK.lines[0], unit_cents: "11500" }, OK.lines[1]] },
      { ...OK, lines: [null, OK.lines[1]] },
      { ...OK, lines: "x" },
      { ...OK, as_of: "ayer" },
      { ...OK, table_label: "" },
    ]) {
      expect(parseAccount(mala)).toEqual({ status: "error" });
    }
  });
});

describe("la hora de la cuenta", () => {
  it("es la de la sucursal, en 24 horas", () => {
    expect(formatAsOf("2026-10-25T00:15:00Z", "America/Argentina/Buenos_Aires", "es")).toBe("21:15");
    expect(formatAsOf("2026-10-25T00:15:00Z", "Europe/Madrid", "es")).toBe("02:15");
  });

  it("una zona desconocida no rompe: cae a Buenos Aires", () => {
    expect(formatAsOf("2026-10-25T00:15:00Z", "No/Existe", "pt")).toBe("21:15");
  });
});
