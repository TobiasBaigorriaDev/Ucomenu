import { describe, expect, it } from "vitest";
import { isLang, preferredLanguages, resolveLang, type Lang } from "./idiomas";

const all: Lang[] = ["es", "en", "pt"];

describe("preferredLanguages", () => {
  it("ordena por q y por aparición, y quita la región", () => {
    expect(preferredLanguages("pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7")).toEqual(["pt", "pt", "en", "en"]);
    expect(preferredLanguages("en;q=0.5, es;q=0.9, pt")).toEqual(["pt", "es", "en"]);
  });
  it("ignora comodín, q en cero y basura", () => {
    expect(preferredLanguages("*;q=0.5, fr;q=0, ,en")).toEqual(["en"]);
    expect(preferredLanguages("en;q=abc")).toEqual([]);
    expect(preferredLanguages(null)).toEqual([]);
    expect(preferredLanguages("")).toEqual([]);
  });
});

describe("resolveLang", () => {
  it("el pedido explícito manda si el local lo ofrece", () => {
    expect(resolveLang({ param: "pt", acceptLanguage: "en", available: all })).toBe("pt");
    expect(resolveLang({ param: "es", acceptLanguage: "en", available: all })).toBe("es");
  });
  it("un idioma que el local no ofrece o que no existe vuelve al español, sin mirar el navegador", () => {
    expect(resolveLang({ param: "pt", acceptLanguage: "pt", available: ["es", "en"] })).toBe("es");
    expect(resolveLang({ param: "fr", acceptLanguage: "en", available: all })).toBe("es");
    expect(resolveLang({ param: "", acceptLanguage: "en", available: all })).toBe("es");
  });
  it("sin pedido explícito sigue al navegador entre los idiomas ofrecidos", () => {
    expect(resolveLang({ acceptLanguage: "en-US,en;q=0.9", available: all })).toBe("en");
    expect(resolveLang({ acceptLanguage: "fr,pt-BR;q=0.8", available: all })).toBe("pt");
    expect(resolveLang({ acceptLanguage: "pt-BR", available: ["es", "en"] })).toBe("es");
    expect(resolveLang({ acceptLanguage: "en", available: ["es"] })).toBe("es");
    expect(resolveLang({ available: all })).toBe("es");
  });
  it("con varios ?lang= vale el primero", () => {
    expect(resolveLang({ param: ["en", "pt"], available: all })).toBe("en");
  });
  it("isLang solo acepta los idiomas de la carta", () => {
    expect(["es", "en", "pt"].every(isLang)).toBe(true);
    expect([isLang("fr"), isLang(""), isLang(null), isLang(["en"])]).toEqual([false, false, false, false]);
  });
});
