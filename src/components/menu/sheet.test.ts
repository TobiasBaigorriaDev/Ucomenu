import { describe, expect, it } from "vitest";
import { DIETARY_TAGS } from "@/lib/carta/dietary";
import type { MenuOptionGroup, MenuSection } from "@/lib/menu";
import { DIETARY_ABBR, SHEET_MAX_SCALE, SHEET_OPTION_ROWS, SHEET_WIDTH, sheetOptionLines, sheetScale, usedDietaryTags } from "./sheet";

const group = (id: string, names: [string, number][]): MenuOptionGroup =>
  ({ id, name: `Grupo ${id}`, min_choices: 0, max_choices: 1, options: names.map(([name, delta], i) => ({ id: `${id}-${i}`, name, price_delta_cents: delta })) }) as MenuOptionGroup;

const section = (tags: (string[] | undefined)[]): MenuSection => ({
  category: { id: "c", name: "Cat", sort_order: 0 },
  products: tags.map((dietary_tags, i) => ({ id: `p${i}`, category_id: "c", name: `P${i}`, price_cents: 100, sort_order: i, dietary_tags })),
}) as MenuSection;

describe("sheetOptionLines", () => {
  it("sin variantes no hay líneas", () => {
    expect(sheetOptionLines(undefined)).toEqual({ lines: [], hidden: 0 });
    expect(sheetOptionLines([])).toEqual({ lines: [], hidden: 0 });
  });

  it("conserva el orden y la diferencia de precio de cada opción", () => {
    const { lines, hidden } = sheetOptionLines([group("a", [["Simple", 0], ["Doble", 350000]])]);
    expect(hidden).toBe(0);
    expect(lines[0].options).toEqual([
      { id: "a-0", name: "Simple", deltaCents: 0 },
      { id: "a-1", name: "Doble", deltaCents: 350000 },
    ]);
  });

  it("recorta a SHEET_OPTION_ROWS opciones y cuenta las que quedan fuera", () => {
    const many = group("m", Array.from({ length: SHEET_OPTION_ROWS + 3 }, (_, i) => [`Op ${i}`, 100] as [string, number]));
    const { lines, hidden } = sheetOptionLines([many]);
    expect(lines[0].options).toHaveLength(SHEET_OPTION_ROWS);
    expect(hidden).toBe(3);
  });
});

describe("usedDietaryTags", () => {
  it("devuelve solo las etiquetas presentes, en el orden de siempre", () => {
    expect(usedDietaryTags([section([["vegan"], undefined, ["gluten_free", "vegan"]])], DIETARY_TAGS)).toEqual(["gluten_free", "vegan"]);
  });

  it("sin etiquetas no hay leyenda", () => {
    expect(usedDietaryTags([section([undefined, []])], DIETARY_TAGS)).toEqual([]);
  });

  it("toda etiqueta tiene su sigla y no se repiten", () => {
    expect(new Set(DIETARY_TAGS.map((tag) => DIETARY_ABBR[tag])).size).toBe(DIETARY_TAGS.length);
  });
});

describe("sheetScale", () => {
  it("en el celular achica la hoja para que entre entera", () => {
    expect(sheetScale(358)).toBeCloseTo(358 / SHEET_WIDTH);
    expect(sheetScale(358)).toBeLessThan(1);
  });

  it("en una pantalla ancha agranda hasta un tope y nunca da negativo", () => {
    expect(sheetScale(5000)).toBe(SHEET_MAX_SCALE);
    expect(sheetScale(-10)).toBe(0);
  });
});
