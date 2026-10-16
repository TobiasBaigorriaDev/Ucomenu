import { describe, expect, it } from "vitest";
import { attachOptions, groupMenu, type MenuCategory, type MenuProduct } from "./menu";

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

describe("attachOptions", () => {
  const group = (id: string, product_id: string, name: string, sort_order = 0) => ({
    id,
    product_id,
    name,
    min_choices: 1,
    max_choices: 1,
    sort_order,
  });
  const option = (id: string, group_id: string, name: string, price_delta_cents = 0, sort_order = 0) => ({
    id,
    group_id,
    name,
    price_delta_cents,
    sort_order,
  });

  it("cuelga de cada plato sus grupos y opciones, en orden, sin tocar el precio base", () => {
    const [espresso, medialuna] = attachOptions(
      [product("p1", "a", "Espresso"), product("p2", "a", "Medialuna")],
      [group("g2", "p1", "Extras", 1), group("g1", "p1", "Tamaño", 0)],
      [option("o2", "g1", "Doble", 60000, 1), option("o1", "g1", "Simple", 0, 0), option("o3", "g2", "Crema", 20000)],
    );

    expect(espresso.price_cents).toBe(1000);
    expect(espresso.option_groups?.map((g) => g.name)).toEqual(["Tamaño", "Extras"]);
    expect(espresso.option_groups?.[0].options.map((o) => [o.name, o.price_delta_cents])).toEqual([
      ["Simple", 0],
      ["Doble", 60000],
    ]);
    expect(medialuna.option_groups).toBeUndefined();
  });

  it("no muestra un grupo sin opciones ni conserva opciones de un grupo que no vino", () => {
    const [espresso] = attachOptions(
      [product("p1", "a", "Espresso")],
      [group("g1", "p1", "Vacío")],
      [option("o9", "g-ajeno", "Huérfana", 100)],
    );

    expect(espresso.option_groups).toBeUndefined();
  });

  it("ignora los grupos de un plato que no está en la lista", () => {
    const result = attachOptions([product("p1", "a", "Espresso")], [group("g1", "otro", "Tamaño")], [option("o1", "g1", "Simple")]);

    expect(result[0].option_groups).toBeUndefined();
  });
});
