export type MenuCategory = {
  id: string;
  name: string;
  sort_order: number;
};

export type MenuProduct = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  sort_order: number;
};

export type MenuSection = {
  category: MenuCategory;
  products: MenuProduct[];
};

const collator = new Intl.Collator("es-AR");

function byOrderThenName<T extends { sort_order: number; name: string }>(a: T, b: T): number {
  return a.sort_order - b.sort_order || collator.compare(a.name, b.name);
}

/**
 * Arma las secciones de la carta. Una categoría sin platos no se muestra, y un plato
 * cuya categoría no vino en la lista se descarta: la base ya filtra lo no publicable,
 * esto solo garantiza una estructura consistente para la vista.
 */
export function groupMenu(categories: MenuCategory[], products: MenuProduct[]): MenuSection[] {
  const byCategory = new Map<string, MenuProduct[]>();
  for (const product of products) {
    const list = byCategory.get(product.category_id);
    if (list) list.push(product);
    else byCategory.set(product.category_id, [product]);
  }

  return [...categories]
    .sort(byOrderThenName)
    .flatMap((category) => {
      const list = byCategory.get(category.id);
      return list && list.length > 0
        ? [{ category, products: [...list].sort(byOrderThenName) }]
        : [];
    });
}
