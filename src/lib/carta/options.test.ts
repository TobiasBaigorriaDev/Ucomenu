import { describe, expect, it } from "vitest";
import { cartaErrorMessage } from "./messages";
import {
  choiceRule,
  deltaToInput,
  GROUP_TEMPLATES,
  isUnsatisfiable,
  isVariant,
  MAX_CHOICES,
  parseChoices,
  parseDelta,
} from "./options-rules";

describe("parseChoices", () => {
  it("acepta una variante (1 y 1) y adicionales (0 y N)", () => {
    expect(parseChoices("1", "1")).toEqual({ ok: true, min: 1, max: 1 });
    expect(parseChoices("0", "3")).toEqual({ ok: true, min: 0, max: 3 });
    expect(parseChoices(" 2 ", " 5 ")).toEqual({ ok: true, min: 2, max: 5 });
    expect(parseChoices("0", String(MAX_CHOICES))).toEqual({ ok: true, min: 0, max: MAX_CHOICES });
  });

  it("rechaza un mínimo mayor que el máximo", () => {
    expect(parseChoices("3", "2")).toEqual({ ok: false, problem: "min_over_max" });
  });

  it("rechaza un máximo menor que 1 o por encima del tope", () => {
    expect(parseChoices("0", "0")).toEqual({ ok: false, problem: "max_range" });
    expect(parseChoices("0", String(MAX_CHOICES + 1))).toEqual({ ok: false, problem: "max_range" });
  });

  it("rechaza lo que no es un entero: vacío, decimales, negativos, texto y notación científica", () => {
    for (const bad of ["", " ", "1,5", "1.5", "-1", "uno", "1e1", "+1", "9999"]) {
      expect(parseChoices(bad, "3"), `mínimo «${bad}»`).toEqual({ ok: false, problem: "invalid" });
      expect(parseChoices("0", bad), `máximo «${bad}»`).toEqual({ ok: false, problem: "invalid" });
    }
    expect(parseChoices(null, "1")).toEqual({ ok: false, problem: "invalid" });
    expect(parseChoices("0", undefined)).toEqual({ ok: false, problem: "invalid" });
  });
});

describe("parseDelta", () => {
  it("vacío es sin diferencia", () => {
    expect(parseDelta("")).toEqual({ ok: true, cents: 0 });
    expect(parseDelta("   ")).toEqual({ ok: true, cents: 0 });
    expect(parseDelta(undefined)).toEqual({ ok: true, cents: 0 });
  });

  it("guarda centavos enteros con el formato es-AR de los precios", () => {
    expect(parseDelta("300")).toEqual({ ok: true, cents: 30000 });
    expect(parseDelta("1.250,50")).toEqual({ ok: true, cents: 125050 });
    expect(parseDelta("0")).toEqual({ ok: true, cents: 0 });
    expect(parseDelta("$ 600")).toEqual({ ok: true, cents: 60000 });
  });

  it("rechaza negativos, texto, más de 2 decimales y montos enormes", () => {
    expect(parseDelta("-300")).toEqual({ ok: false, problem: "invalid" });
    expect(parseDelta("abc")).toEqual({ ok: false, problem: "invalid" });
    expect(parseDelta("1,234")).toEqual({ ok: false, problem: "too_many_decimals" });
    expect(parseDelta("10.000.001")).toEqual({ ok: false, problem: "too_big" });
  });

  it("deltaToInput es la inversa para precargar el campo", () => {
    expect(deltaToInput(0)).toBe("");
    expect(deltaToInput(30000)).toBe("300");
    expect(deltaToInput(125050)).toBe("1250,50");
    expect(parseDelta(deltaToInput(125050))).toEqual({ ok: true, cents: 125050 });
  });
});

describe("choiceRule e isVariant", () => {
  it("describe la regla de elección", () => {
    expect(choiceRule(1, 1)).toBe("Elegí 1");
    expect(choiceRule(2, 2)).toBe("Elegí 2");
    expect(choiceRule(1, 3)).toBe("Elegí de 1 a 3");
    expect(choiceRule(0, 1)).toBe("Opcional · hasta 1");
    expect(choiceRule(0, 4)).toBe("Opcional · hasta 4");
  });

  it("solo 1 y 1 es una variante", () => {
    expect(isVariant(1, 1)).toBe(true);
    expect(isVariant(0, 1)).toBe(false);
    expect(isVariant(1, 2)).toBe(false);
  });

  it("un grupo no se puede cumplir si pide más opciones de las activas", () => {
    expect(isUnsatisfiable(1, 0)).toBe(true);
    expect(isUnsatisfiable(2, 1)).toBe(true);
    expect(isUnsatisfiable(1, 1)).toBe(false);
    expect(isUnsatisfiable(0, 0)).toBe(false);
  });
});

describe("plantillas del alta", () => {
  it("la variante es 1/1 y los adicionales son 0/N, y ambas pasan la validación", () => {
    const variante = GROUP_TEMPLATES.find((t) => t.key === "variant");
    const adicionales = GROUP_TEMPLATES.find((t) => t.key === "extras");
    expect(variante && parseChoices(variante.min, variante.max)).toEqual({ ok: true, min: 1, max: 1 });
    const extras = adicionales && parseChoices(adicionales.min, adicionales.max);
    expect(extras).toMatchObject({ ok: true, min: 0 });
    expect(extras && extras.ok && extras.max).toBeGreaterThan(1);
  });
});

describe("mensajes de error de variantes y adicionales", () => {
  it("todos tienen texto y mencionan el tope cuando corresponde", () => {
    expect(cartaErrorMessage("choices_invalid", null)).toMatch(/enteros/);
    expect(cartaErrorMessage("choices_min_over_max", null)).toMatch(/mínimo/);
    expect(cartaErrorMessage("choices_max_range", null)).toContain(String(MAX_CHOICES));
    expect(cartaErrorMessage("group_cap", null)).toMatch(/20/);
    expect(cartaErrorMessage("option_cap", null)).toMatch(/60/);
  });
});
