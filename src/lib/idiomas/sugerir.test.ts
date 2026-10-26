import { describe, expect, it } from "vitest";
import type { TranslationNode } from "./panel";
import { chunk, collectMissing, MAX_SUGGESTIONS_PER_REQUEST, suggestTranslations, validateSuggestions, type TranslationProvider } from "./sugerir";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const node = (kind: TranslationNode["kind"], n: number, name: string, extra: Partial<TranslationNode> = {}): TranslationNode => ({
  kind,
  id: id(n),
  name,
  description: null,
  isActive: true,
  translations: {},
  children: [],
  ...extra,
});

const tree: TranslationNode[] = [
  node("category", 1, "Bebidas", {
    children: [
      node("product", 2, "Limonada", {
        description: "Con menta y jengibre",
        children: [node("group", 3, "Tamaño", { children: [node("option", 4, "Grande")] })],
      }),
      node("product", 5, "Agua", { translations: { en: { name: "Water" } } }),
    ],
  }),
];

describe("collectMissing", () => {
  it("pide el nombre de cada fila y la descripción de los platos que la tienen, en el orden de la carta", () => {
    expect(collectMissing(tree, "en").map((item) => item.key)).toEqual([
      `c:${id(1)}:name`,
      `p:${id(2)}:name`,
      `p:${id(2)}:description`,
      `g:${id(3)}:name`,
      `o:${id(4)}:name`,
    ]);
  });
  it("no pide lo que ya está traducido en ese idioma (pero sí en el otro)", () => {
    expect(collectMissing(tree, "en").some((item) => item.key === `p:${id(5)}:name`)).toBe(false);
    expect(collectMissing(tree, "pt").some((item) => item.key === `p:${id(5)}:name`)).toBe(true);
  });
  it("una descripción vacía no se pide, y hay un tope por clic", () => {
    expect(collectMissing([node("product", 9, "Pan", { description: "  " })], "en").map((item) => item.field)).toEqual(["name"]);
    const many = Array.from({ length: MAX_SUGGESTIONS_PER_REQUEST + 20 }, (_, i) => node("category", i + 10, `Categoría ${i}`));
    expect(collectMissing(many, "en")).toHaveLength(MAX_SUGGESTIONS_PER_REQUEST);
  });
});

describe("validateSuggestions", () => {
  const items = collectMissing(tree, "en");
  it("descarta claves ajenas, textos vacíos o que no son texto, y recorta espacios", () => {
    const result = validateSuggestions(items, {
      [`c:${id(1)}:name`]: "  Drinks ",
      [`p:${id(2)}:name`]: "   ",
      [`g:${id(3)}:name`]: 42,
      "p:ajeno:name": "Intruso",
    });
    expect(result).toEqual({ [`c:${id(1)}:name`]: "Drinks" });
  });
  it("descarta lo que excede los topes de la base", () => {
    const result = validateSuggestions(items, {
      [`p:${id(2)}:name`]: "x".repeat(81),
      [`p:${id(2)}:description`]: "y".repeat(300),
      [`c:${id(1)}:name`]: "z".repeat(80),
    });
    expect(Object.keys(result).sort()).toEqual([`c:${id(1)}:name`, `p:${id(2)}:description`].sort());
  });
  it("una respuesta que no es un objeto no da nada", () => {
    expect(validateSuggestions(items, null)).toEqual({});
    expect(validateSuggestions(items, ["a"])).toEqual({});
  });
});

describe("suggestTranslations", () => {
  const upper = (calls: number[] = []): TranslationProvider => ({
    name: "prueba",
    async translate(items) {
      calls.push(items.length);
      return Object.fromEntries(items.map((item) => [item.key, `EN ${item.text}`]));
    },
  });

  it("devuelve las sugerencias de todo lo que falta", async () => {
    const outcome = await suggestTranslations(upper(), tree, "en");
    expect(outcome).toMatchObject({ ok: true, requested: 5 });
    expect(outcome.ok && outcome.suggestions[`c:${id(1)}:name`]).toBe("EN Bebidas");
  });
  it("sin nada por traducir no llama al proveedor", async () => {
    const calls: number[] = [];
    expect(await suggestTranslations(upper(calls), [], "en")).toEqual({ ok: false, error: "empty" });
    expect(calls).toEqual([]);
  });
  it("parte el pedido en tramos", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("si falla un tramo conserva los anteriores; si falla el primero es un error", async () => {
    const many = Array.from({ length: 90 }, (_, i) => node("category", i + 10, `Categoría ${i}`));
    let call = 0;
    const flaky: TranslationProvider = {
      name: "prueba",
      async translate(items) {
        call += 1;
        if (call === 2) throw new Error("caído");
        return Object.fromEntries(items.map((item) => [item.key, "x"]));
      },
    };
    const partial = await suggestTranslations(flaky, many, "en");
    expect(partial.ok && Object.keys(partial.suggestions)).toHaveLength(40);

    const dead: TranslationProvider = { name: "prueba", translate: async () => Promise.reject(new Error("caído")) };
    expect(await suggestTranslations(dead, many, "en")).toEqual({ ok: false, error: "unavailable" });
  });
  it("lo que el proveedor devuelve fuera de lo pedido no pasa", async () => {
    const rogue: TranslationProvider = { name: "prueba", translate: async () => ({ "p:ajeno:name": "Intruso", [`c:${id(1)}:name`]: "Drinks" }) };
    const outcome = await suggestTranslations(rogue, tree, "en");
    expect(outcome.ok && outcome.suggestions).toEqual({ [`c:${id(1)}:name`]: "Drinks" });
  });
});
