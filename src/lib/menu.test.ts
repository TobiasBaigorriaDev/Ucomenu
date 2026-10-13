import { describe, expect, it } from "vitest";
import { groupMenu, type MenuCategory, type MenuProduct } from "./menu";

const category = (id: string, name: string, sort_order = 0): MenuCategory => ({ id, name, sort_order });
const product = (id: string, category_id: string, name: string, sort_order = 0): MenuProduct => ({
  id,
  category_id,
  name,
  description: null,
  price_cents: 1000,
  sort_order,
});

describe("groupMenu", () => {
  it("ordena las categorías y los platos por sort_order", () => {
    const sections = groupMenu(
      [category("b", "Pastelería", 2), category("a", "Cafetería", 1)],
      [product("p2", "a", "Flat white", 2), product("p1", "a", "Espresso", 1), product("p3", "b", "Medialuna")],
    );

    expect(sections.map((s) => s.category.name)).toEqual(["Cafetería", "Pastelería"]);
    expect(sections[0].products.map((p) => p.name)).toEqual(["Espresso", "Flat white"]);
  });

  it("desempata por nombre cuando el sort_order es igual", () => {
    const sections = groupMenu([category("a", "Cafetería")], [product("p1", "a", "Té"), product("p2", "a", "Cortado")]);

    expect(sections[0].products.map((p) => p.name)).toEqual(["Cortado", "Té"]);
  });

  it("omite las categorías sin platos", () => {
    const sections = groupMenu([category("a", "Cafetería", 1), category("b", "Vacía", 2)], [product("p1", "a", "Espresso")]);

    expect(sections.map((s) => s.category.id)).toEqual(["a"]);
  });

  it("descarta los platos cuya categoría no está en la lista", () => {
    const sections = groupMenu([category("a", "Cafetería")], [product("p1", "a", "Espresso"), product("p2", "zzz", "Huérfano")]);

    expect(sections).toHaveLength(1);
    expect(sections[0].products.map((p) => p.id)).toEqual(["p1"]);
  });

  it("devuelve una lista vacía si no hay nada para mostrar", () => {
    expect(groupMenu([], [])).toEqual([]);
  });

  it("no modifica las listas recibidas", () => {
    const categories = [category("b", "B", 2), category("a", "A", 1)];
    groupMenu(categories, []);

    expect(categories.map((c) => c.id)).toEqual(["b", "a"]);
  });
});
