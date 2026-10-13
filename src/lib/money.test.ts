import { describe, expect, it } from "vitest";
import { formatArs } from "./money";

// Intl usa espacio duro entre el símbolo y el número: se normaliza para comparar.
const plain = (value: string) => value.replace(/\s/g, " ");

describe("formatArs", () => {
  it("muestra importes enteros sin decimales", () => {
    expect(plain(formatArs(280000))).toBe("$ 2.800");
  });

  it("muestra centavos cuando el importe no es entero", () => {
    expect(plain(formatArs(280050))).toBe("$ 2.800,50");
  });

  it("formatea el cero y los miles con separador", () => {
    expect(plain(formatArs(0))).toBe("$ 0");
    expect(plain(formatArs(1250000))).toBe("$ 12.500");
  });

  it("rechaza importes negativos, con decimales o no finitos", () => {
    expect(() => formatArs(-1)).toThrow(RangeError);
    expect(() => formatArs(10.5)).toThrow(RangeError);
    expect(() => formatArs(Number.NaN)).toThrow(RangeError);
  });
});
