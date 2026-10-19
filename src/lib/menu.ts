import type { Translations } from "@/lib/idiomas/traducciones";

export type MenuCategory = {
  id: string;
  name: string;
  sort_order: number;
  /** Traducciones del nombre (carta en varios idiomas); la vista las resuelve con `localizeSections`. */
  translations?: Translations;
};

export type MenuOption = {
  id: string;
  name: string;
  /** Diferencia sobre el precio base, en centavos (0 = sin diferencia). Solo informativa. */
  price_delta_cents: number;
  sort_order: number;
  translations?: Translations;
};

export type MenuOptionGroup = {
  id: string;
  name: string;
  min_choices: number;
  max_choices: number;
  sort_order: number;
  translations?: Translations;
  options: MenuOption[];
};

export type MenuProduct = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  sort_order: number;
  /** Ruta de la foto en Storage (`{organización}/{plato}/{uuid}.{ext}`); nulo = sin foto. */
  image_path?: string | null;
  /** Declaraciones del local; vacío no afirma nada sobre la dieta del plato. */
  dietary_tags?: string[];
  /** Disponibilidad de ESTA sucursal; omitido equivale a disponible. */
  is_available?: boolean;
  /** Variantes y adicionales activos del plato (con al menos una opción activa), en orden. */
  option_groups?: MenuOptionGroup[];
  translations?: Translations;
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

type GroupRow = Omit<MenuOptionGroup, "options"> & { product_id: string };
type OptionRow = MenuOption & { group_id: string };

/**
 * Cuelga de cada plato sus grupos de opciones. La base ya entrega solo lo activo y publicable; acá se arma la estructura:
 * una opción cuyo grupo no vino se descarta, y un grupo sin opciones no se muestra (no hay nada que elegir). El resto de
 * los campos del plato se conserva tal cual.
 */
export function attachOptions<P extends MenuProduct>(products: P[], groups: GroupRow[], options: OptionRow[]): P[] {
  const optionsByGroup = new Map<string, MenuOption[]>();
  for (const { group_id, ...option } of options) {
    const list = optionsByGroup.get(group_id);
    if (list) list.push(option);
    else optionsByGroup.set(group_id, [option]);
  }

  const groupsByProduct = new Map<string, MenuOptionGroup[]>();
  for (const { product_id, ...group } of groups) {
    const list = optionsByGroup.get(group.id);
    if (!list || list.length === 0) continue;
    const entry = { ...group, options: [...list].sort(byOrderThenName) };
    const siblings = groupsByProduct.get(product_id);
    if (siblings) siblings.push(entry);
    else groupsByProduct.set(product_id, [entry]);
  }

  return products.map((product) => {
    const list = groupsByProduct.get(product.id);
    return list ? { ...product, option_groups: [...list].sort(byOrderThenName) } : product;
  });
}
