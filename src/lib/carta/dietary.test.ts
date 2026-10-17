import { describe, expect, it } from "vitest";
import type { MenuSection } from "@/lib/menu";
import { filterMenu, parseDietaryTags } from "./dietary";

const sections: MenuSection[] = [
  { category: { id: "cafe", name: "Cafetería", sort_order: 1 }, products: [
    { id: "1", category_id: "cafe", name: "Café frío", description: "Con leche de almendras", price_cents: 100, sort_order: 2, dietary_tags: ["vegan", "gluten_free"] },
    { id: "2", category_id: "cafe", name: "Té", description: null, price_cents: 200, sort_order: 1 },
  ] },
  { category: { id: "postre", name: "Postres", sort_order: 2 }, products: [
    { id: "3", category_id: "postre", name: "Torta", description: "Chocolate", price_cents: 300, sort_order: 1, dietary_tags: ["vegetarian"] },
  ] },
];

describe("etiquetas declaradas y búsqueda de carta", () => {
  it("valida lista cerrada, elimina duplicados y admite quitar todas", () => {
    expect(parseDietaryTags([])).toEqual([]);
    expect(parseDietaryTags(["vegan", "vegan"])).toEqual(["vegan"]);
    for (const value of [null, "vegan", [null], ["unknown"], Array(4).fill("vegan")]) expect(parseDietaryTags(value)).toBeNull();
  });
  it("ignora acentos, mayúsculas y espacios, combinando nombre y descripción", () => {
    expect(filterMenu(sections, "  CAFE   ALMENDRAS ", [])[0].products.map((p) => p.id)).toEqual(["1"]);
    expect(filterMenu(sections, "té", [])[0].products.map((p) => p.id)).toEqual(["2"]);
  });
  it("exige todos los filtros y el texto, sin inferir vegetariano de vegano", () => {
    expect(filterMenu(sections, "café", ["vegan", "gluten_free"])[0].products).toHaveLength(1);
    expect(filterMenu(sections, "café", ["vegetarian"])).toEqual([]);
    expect(filterMenu(sections, "torta", ["vegan"])).toEqual([]);
    expect(filterMenu(sections, "té", ["gluten_free"])).toEqual([]);
  });
  it("quita categorías vacías sin mutar la carta ni el orden", () => {
    expect(filterMenu(sections, "chocolate", []).map((s) => s.category.id)).toEqual(["postre"]);
    expect(filterMenu(sections, "", [])).toEqual(sections);
    expect(sections[0].products).toHaveLength(2);
    expect(filterMenu(sections, "ausente", [])).toEqual([]);
  });
});
