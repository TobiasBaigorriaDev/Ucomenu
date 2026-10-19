import { describe, expect, it } from "vitest";
import { applyTranslationInput, hasTranslation, parseTranslations, sameTranslations, translated } from "./traducciones";

describe("parseTranslations", () => {
  it("lee la forma esperada y descarta lo demás", () => {
    expect(parseTranslations({ en: { name: "Flat white", description: "Double espresso" }, pt: { name: "Café" } })).toEqual({
      en: { name: "Flat white", description: "Double espresso" },
      pt: { name: "Café" },
    });
    expect(parseTranslations({ fr: { name: "x" }, en: { name: 5, extra: "x" }, pt: "x" })).toEqual({});
    expect(parseTranslations({ en: { name: "  ", description: "" } })).toEqual({});
  });
  it("no se rompe con cualquier forma", () => {
    for (const raw of [null, undefined, 5, "x", [], [{ en: { name: "x" } }]]) expect(parseTranslations(raw)).toEqual({});
  });
});

describe("translated", () => {
  const tr = { en: { name: "Medialuna" } };
  it("usa la traducción y, si falta ese campo o ese idioma, el original", () => {
    expect(translated("Croissant", tr, "en", "name")).toBe("Medialuna");
    expect(translated("Croissant", tr, "pt", "name")).toBe("Croissant");
    expect(translated("Rico", tr, "en", "description")).toBe("Rico");
    expect(translated(null, tr, "en", "description")).toBeNull();
    expect(translated("Croissant", undefined, "en", "name")).toBe("Croissant");
  });
  it("el español es siempre el original", () => {
    expect(translated("Croissant", tr, "es", "name")).toBe("Croissant");
  });
  it("hasTranslation", () => {
    expect(hasTranslation(tr, "en")).toBe(true);
    expect(hasTranslation(tr, "pt")).toBe(false);
    expect(hasTranslation(undefined, "en")).toBe(false);
  });
});

describe("applyTranslationInput", () => {
  it("agrega, reemplaza y recorta espacios, conservando los otros idiomas", () => {
    const result = applyTranslationInput({ pt: { name: "Pão" } }, "en", { name: "  Bread ", description: " Warm " });
    expect(result).toEqual({ ok: true, value: { pt: { name: "Pão" }, en: { name: "Bread", description: "Warm" } } });
  });
  it("un campo vacío borra solo ese campo; sin campos, quita el idioma", () => {
    const current = { en: { name: "Bread", description: "Warm" } };
    expect(applyTranslationInput(current, "en", { name: "Bread", description: "  " })).toEqual({ ok: true, value: { en: { name: "Bread" } } });
    expect(applyTranslationInput(current, "en", { name: "", description: "" })).toEqual({ ok: true, value: {} });
  });
  it("un campo que no viajó no se toca", () => {
    const current = { en: { name: "Bread", description: "Warm" } };
    expect(applyTranslationInput(current, "en", { name: "Loaf" })).toEqual({ ok: true, value: { en: { name: "Loaf", description: "Warm" } } });
  });
  it("respeta los topes del original (80 y 300, contando caracteres y no unidades)", () => {
    expect(applyTranslationInput({}, "en", { name: "a".repeat(80) }).ok).toBe(true);
    expect(applyTranslationInput({}, "en", { name: "a".repeat(81) })).toEqual({ ok: false, problem: "name_too_long" });
    expect(applyTranslationInput({}, "en", { name: "🍕".repeat(80) }).ok).toBe(true);
    expect(applyTranslationInput({}, "en", { description: "a".repeat(300) }).ok).toBe(true);
    expect(applyTranslationInput({}, "en", { description: "a".repeat(301) })).toEqual({ ok: false, problem: "description_too_long" });
  });
  it("no muta lo recibido", () => {
    const current = { en: { name: "Bread" } };
    applyTranslationInput(current, "en", { name: "Loaf" });
    expect(current).toEqual({ en: { name: "Bread" } });
  });
});

describe("sameTranslations", () => {
  it("compara por contenido, sin importar el orden de las claves", () => {
    expect(sameTranslations({ en: { name: "a", description: "b" } }, { en: { description: "b", name: "a" } })).toBe(true);
    expect(sameTranslations({ en: { name: "a" } }, { en: { name: "b" } })).toBe(false);
    expect(sameTranslations({}, { en: { name: "a" } })).toBe(false);
    expect(sameTranslations({}, {})).toBe(true);
  });
});
