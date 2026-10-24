import { describe, expect, it } from "vitest";
import type { MenuSection } from "@/lib/menu";
import { filterMenu } from "@/lib/carta/dietary";
import { dishNumbers, formatDishNumber, posterFontSize } from "./poster";

const cqi = (css: string) => Number(/, ([\d.]+)cqi,/.exec(css)![1]);

describe("posterFontSize", () => {
  it("un nombre corto va en una línea y llena el ancho, con tope en rem", () => {
    // BURGERS mide 3,49 em: 96 % del ancho / 3,49.
    expect(posterFontSize("Burgers", { min: 2.5, max: 6.5 })).toBe("clamp(2.5rem, 27.5cqi, 6.5rem)");
  });

  it("las letras anchas achican el título; las tildes no cuentan", () => {
    expect(cqi(posterFontSize("MMMM", { min: 1, max: 9 }))).toBeLessThan(cqi(posterFontSize("AAAA", { min: 1, max: 9 })));
    expect(posterFontSize("Fainá", { min: 1, max: 9 })).toBe(posterFontSize("Faina", { min: 1, max: 9 }));
  });

  it("un nombre largo pasa a más líneas antes de quedar más chico que el mínimo", () => {
    const size = cqi(posterFontSize("Papas y acompañamientos", { min: 2.5, max: 6.5 }));
    expect((size / 100) * 358).toBeGreaterThanOrEqual(40);
    // «ACOMPAÑAMIENTOS» (8,0 em con las dos M) entra entero en una línea.
    expect(size * 8.0).toBeLessThanOrEqual(100);
  });

  it("con varias líneas reparte las palabras parejas: el tamaño lo fija la línea más ancha", () => {
    // «PIZZAS A» / «LA PIEDRA» antes que «PIZZAS A LA» / «PIEDRA».
    expect(cqi(posterFontSize("Pizzas a la piedra", { min: 4, max: 9 }))).toBeGreaterThan(cqi(posterFontSize("Pizzas a la", { min: 4, max: 9 })));
  });

  it("ignora espacios repetidos y en los bordes", () => {
    expect(posterFontSize("  Tragos   de autor ", { min: 2.5, max: 6.5 })).toBe(posterFontSize("Tragos de autor", { min: 2.5, max: 6.5 }));
  });
});

describe("dishNumbers", () => {
  const product = (id: string, name: string, dietary_tags: string[] = []) => ({ id, category_id: "c", name, description: null, price_cents: 100, sort_order: 0, dietary_tags });
  const sections = [
    { category: { id: "a", name: "Burgers", sort_order: 0 }, products: [product("1", "Clásica"), product("2", "Veggie", ["vegetarian"]), product("3", "Doble")] },
    { category: { id: "b", name: "Papas", sort_order: 1 }, products: [product("4", "Fritas", ["vegetarian"])] },
  ] as MenuSection[];

  it("numera cada categoría desde 1 en el orden de la carta", () => {
    expect([...dishNumbers(sections)]).toEqual([["1", 1], ["2", 2], ["3", 3], ["4", 1]]);
  });

  it("al filtrar, cada plato conserva su número", () => {
    const numbers = dishNumbers(sections);
    const visible = filterMenu(sections, "", ["vegetarian"]);
    expect(visible.flatMap((s) => s.products.map((p) => formatDishNumber(numbers.get(p.id)!)))).toEqual(["02", "01"]);
  });

  it("formatea con dos cifras como mínimo", () => {
    expect([1, 9, 10, 123].map(formatDishNumber)).toEqual(["01", "09", "10", "123"]);
  });
});
