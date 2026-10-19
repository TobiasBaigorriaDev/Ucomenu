import { describe, expect, it } from "vitest";
import type { MenuSection } from "@/lib/menu";
import { localizeSections, offeredLanguages } from "./localizar";

const sections = (): MenuSection[] => [
  {
    category: { id: "c1", name: "Cafetería", sort_order: 1, translations: { en: { name: "Coffee" } } },
    products: [
      {
        id: "p1",
        category_id: "c1",
        name: "Espresso",
        description: "Blend de la casa",
        price_cents: 100,
        sort_order: 1,
        translations: { en: { name: "Espresso shot", description: "House blend" }, pt: { name: "Espresso curto" } },
        option_groups: [
          {
            id: "g1",
            name: "Tamaño",
            min_choices: 1,
            max_choices: 1,
            sort_order: 1,
            translations: { en: { name: "Size" } },
            options: [
              { id: "o1", name: "Doble", price_delta_cents: 600, sort_order: 1, translations: { en: { name: "Double" } } },
              { id: "o2", name: "Simple", price_delta_cents: 0, sort_order: 2 },
            ],
          },
        ],
      },
      { id: "p2", category_id: "c1", name: "Té", description: null, price_cents: 50, sort_order: 2 },
    ],
  },
];

describe("localizeSections", () => {
  it("traduce lo que tiene traducción y deja en español lo que no", () => {
    const [section] = localizeSections(sections(), "en");
    expect(section.category.name).toBe("Coffee");
    expect(section.products.map((p) => p.name)).toEqual(["Espresso shot", "Té"]);
    expect(section.products[0].description).toBe("House blend");
    expect(section.products[1].description).toBeNull();
    const group = section.products[0].option_groups![0];
    expect(group.name).toBe("Size");
    expect(group.options.map((o) => o.name)).toEqual(["Double", "Simple"]);
  });
  it("cada campo cae al español por separado", () => {
    const [section] = localizeSections(sections(), "pt");
    expect(section.category.name).toBe("Cafetería");
    expect(section.products[0].name).toBe("Espresso curto");
    expect(section.products[0].description).toBe("Blend de la casa");
    expect(section.products[0].option_groups![0].name).toBe("Tamaño");
  });
  it("en español queda el original", () => {
    const [section] = localizeSections(sections(), "es");
    expect(section.category.name).toBe("Cafetería");
    expect(section.products[0].name).toBe("Espresso");
  });
  it("conserva el orden, el precio y lo demás, y no manda las traducciones al navegador", () => {
    const [section] = localizeSections(sections(), "en");
    expect(section.products.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(section.products[0].price_cents).toBe(100);
    expect(section.products[0].option_groups![0].options[0].price_delta_cents).toBe(600);
    expect(JSON.stringify(localizeSections(sections(), "en"))).not.toContain("translations");
  });
  it("no muta la entrada", () => {
    const input = sections();
    localizeSections(input, "en");
    expect(input[0].category.name).toBe("Cafetería");
  });
});

describe("offeredLanguages", () => {
  it("siempre ofrece el español y suma los idiomas con algún texto traducido", () => {
    expect(offeredLanguages(sections())).toEqual(["es", "en", "pt"]);
  });
  it("sin traducciones solo ofrece el español", () => {
    const plain: MenuSection[] = [
      { category: { id: "c", name: "A", sort_order: 1 }, products: [{ id: "p", category_id: "c", name: "B", description: null, price_cents: 1, sort_order: 1 }] },
    ];
    expect(offeredLanguages(plain)).toEqual(["es"]);
    expect(offeredLanguages([])).toEqual(["es"]);
  });
  it("cuenta también una traducción hecha solo en una opción", () => {
    const only: MenuSection[] = [
      {
        category: { id: "c", name: "A", sort_order: 1 },
        products: [
          {
            id: "p",
            category_id: "c",
            name: "B",
            description: null,
            price_cents: 1,
            sort_order: 1,
            option_groups: [
              {
                id: "g",
                name: "G",
                min_choices: 0,
                max_choices: 1,
                sort_order: 1,
                options: [{ id: "o", name: "O", price_delta_cents: 0, sort_order: 1, translations: { pt: { name: "Op" } } }],
              },
            ],
          },
        ],
      },
    ];
    expect(offeredLanguages(only)).toEqual(["es", "pt"]);
  });
});
