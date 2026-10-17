import type { MenuSection } from "@/lib/menu";

export const DIETARY_TAGS = ["gluten_free", "vegan", "vegetarian"] as const;
export type DietaryTag = (typeof DIETARY_TAGS)[number];
export const DIETARY_LABEL: Record<DietaryTag, string> = {
  gluten_free: "Sin TACC",
  vegan: "Vegano",
  vegetarian: "Vegetariano",
};

export function isDietaryTag(value: unknown): value is DietaryTag {
  return typeof value === "string" && DIETARY_TAGS.some((tag) => tag === value);
}

/** Valida también entradas directas a las acciones; nunca acepta etiquetas desconocidas. */
export function parseDietaryTags(value: unknown): DietaryTag[] | null {
  if (!Array.isArray(value) || value.length > DIETARY_TAGS.length || !value.every(isDietaryTag)) return null;
  return DIETARY_TAGS.filter((tag) => value.includes(tag));
}

const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-AR");

export function filterMenu(sections: MenuSection[], query: string, tags: DietaryTag[]): MenuSection[] {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return sections.flatMap(({ category, products }) => {
    const matches = products.filter((product) => {
      const text = normalize(`${product.name} ${product.description ?? ""}`);
      return words.every((word) => text.includes(word)) && tags.every((tag) => product.dietary_tags?.includes(tag));
    });
    return matches.length ? [{ category, products: matches }] : [];
  });
}
