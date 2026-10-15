import { describe, expect, it } from "vitest";
import {
  defaultPeriodDate,
  isBillingCycle,
  isPlanCode,
  MAX_PERIOD_DAYS,
  NAME_MAX_LENGTH,
  parseName,
  parsePeriodEnd,
  parseSlug,
} from "./validation";

// 2026-10-14 12:00 en Argentina (15:00 UTC).
const NOW = new Date("2026-10-14T15:00:00Z");

describe("parsePeriodEnd", () => {
  it("vale hasta el final de ese día en Argentina (23:59:59, UTC−3)", () => {
    expect(parsePeriodEnd("2026-10-28", NOW)).toBe("2026-10-29T02:59:59.000Z");
  });

  it("acepta el día de hoy mientras no haya terminado en Argentina", () => {
    expect(parsePeriodEnd("2026-10-14", NOW)).toBe("2026-10-15T02:59:59.000Z");
  });

  it("rechaza el día de ayer y el borde: justo en el final del día ya no es futuro", () => {
    expect(parsePeriodEnd("2026-10-13", NOW)).toBeNull();
    expect(parsePeriodEnd("2026-10-14", new Date("2026-10-15T02:59:59Z"))).toBeNull();
    expect(parsePeriodEnd("2026-10-14", new Date("2026-10-15T02:59:58Z"))).toBe("2026-10-15T02:59:59.000Z");
  });

  it("acepta hasta 730 días y rechaza más", () => {
    // NOW + 730 días = 2028-10-13T15:00Z (2028 es bisiesto): el 12 vence a las 02:59:59Z del 13, el 13 ya se pasa.
    expect(MAX_PERIOD_DAYS).toBe(730);
    expect(parsePeriodEnd("2028-10-12", NOW)).toBe("2028-10-13T02:59:59.000Z");
    expect(parsePeriodEnd("2028-10-13", NOW)).toBeNull();
    expect(parsePeriodEnd("2099-01-01", NOW)).toBeNull();
  });

  it.each(["", "2026-10", "2026-13-01", "2026-02-30", "2026-10-14T00:00:00Z", "14/10/2026", " 2026-10-20", "2026-10-20 "])(
    "rechaza %j",
    (value) => {
      expect(parsePeriodEnd(value, NOW)).toBeNull();
    },
  );

  it("rechaza lo que no es texto", () => {
    for (const value of [null, undefined, 20261020, ["2026-10-20"], {}]) expect(parsePeriodEnd(value, NOW)).toBeNull();
  });
});

describe("defaultPeriodDate", () => {
  it("propone hoy + 14 días en el calendario de Argentina", () => {
    expect(defaultPeriodDate(NOW)).toBe("2026-10-28");
  });

  it("usa el día de Argentina, no el de UTC (01:00 UTC todavía es el día anterior allá)", () => {
    expect(defaultPeriodDate(new Date("2026-10-15T01:00:00Z"))).toBe("2026-10-28");
  });

  it("lo propuesto siempre pasa la validación", () => {
    expect(parsePeriodEnd(defaultPeriodDate(NOW), NOW)).not.toBeNull();
  });
});

describe("parseName", () => {
  it("recorta los bordes y acepta de 1 a 80 caracteres", () => {
    expect(parseName("  Café del Centro  ")).toBe("Café del Centro");
    expect(parseName("a".repeat(NAME_MAX_LENGTH))).toBe("a".repeat(NAME_MAX_LENGTH));
  });

  it("rechaza vacío, solo espacios, demasiado largo y lo que no es texto", () => {
    for (const value of ["", "   ", "a".repeat(NAME_MAX_LENGTH + 1), null, undefined, 5]) expect(parseName(value)).toBeNull();
  });
});

describe("parseSlug", () => {
  it("normaliza a minúsculas y recorta los bordes", () => {
    expect(parseSlug("  Cafe-Del-Centro ")).toBe("cafe-del-centro");
  });

  it.each(["", "-a", "a-", "a--b", "café", "a b", "a_b", "a/b", "..", "a".repeat(65)])("rechaza %j", (value) => {
    expect(parseSlug(value)).toBeNull();
  });

  it("rechaza lo que no es texto", () => {
    for (const value of [null, undefined, 3]) expect(parseSlug(value)).toBeNull();
  });
});

describe("plan y ciclo", () => {
  it("aceptan solo los códigos del catálogo", () => {
    for (const plan of ["basic", "pro", "premium"]) expect(isPlanCode(plan)).toBe(true);
    for (const plan of ["", "Pro", "enterprise", null, undefined, 1]) expect(isPlanCode(plan)).toBe(false);
    for (const cycle of ["monthly", "yearly"]) expect(isBillingCycle(cycle)).toBe(true);
    for (const cycle of ["", "weekly", "Monthly", null]) expect(isBillingCycle(cycle)).toBe(false);
  });
});
