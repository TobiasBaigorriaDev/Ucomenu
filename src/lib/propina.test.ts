import { describe, expect, it } from "vitest";
import { isTipPercent, parseTipPercent, suggestedTip } from "./propina";

describe("propina sugerida", () => {
  it("valida porcentajes enteros de 1 a 100, con null desactivado", () => {
    for (const n of [null, 1, 10, 100]) expect(isTipPercent(n)).toBe(true);
    for (const n of [undefined, "10", 0, -1, 101, 10.5, NaN, Infinity]) expect(isTipPercent(n)).toBe(false);
    expect(parseTipPercent("10")).toBe(10);
    for (const n of ["", "0", "101", "10.5", "1e1", " 10", null]) expect(parseTipPercent(n)).toBeNull();
  });

  it("calcula consumo más sugerencia sin modificar el consumo", () => {
    expect(suggestedTip(2_000_000, 10)).toEqual({ percent: 10, cents: 200_000, totalCents: 2_200_000 });
    expect(suggestedTip(26000, 15)).toEqual({ percent: 15, cents: 3900, totalCents: 29900 });
    expect(suggestedTip(26000, null)).toBeNull();
    expect(suggestedTip(0, 10)).toBeNull();
  });

  it("redondea al centavo, mitad hacia arriba, y controla desbordes", () => {
    expect(suggestedTip(104, 10)?.cents).toBe(10);
    expect(suggestedTip(105, 10)?.cents).toBe(11);
    expect(suggestedTip(1, 100)).toEqual({ percent: 100, cents: 1, totalCents: 2 });
    for (const n of [-1, 1.5, Number.MAX_SAFE_INTEGER, Infinity]) expect(() => suggestedTip(n, 100)).toThrow();
    expect(() => suggestedTip(100, 101)).toThrow();
  });
});
