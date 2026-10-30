import type { DietaryTag } from "@/lib/carta/dietary";
import type { MenuOptionGroup, MenuSection } from "@/lib/menu";
import { limitOptionGroups } from "./dish-options";

/** Siglas del estilo «hoja», que no tiene lugar para las palabras. Siempre se acompañan del nombre completo para el lector de pantalla y de una leyenda. */
export const DIETARY_ABBR: Record<DietaryTag, string> = { gluten_free: "GF", vegetarian: "V", vegan: "VG" };

/** Cuántas opciones (en total) muestra una fila de la hoja; el resto se resume en «+N más» y está completo en el detalle del plato. */
export const SHEET_OPTION_ROWS = 5;

export type SheetOptionLine = { id: string; name: string; options: { id: string; name: string; deltaCents: number }[] };

/** Variantes y adicionales de un plato resumidos en una línea por grupo («Leche: Almendra + $ 1.700 / Avena»). */
export function sheetOptionLines(groups: MenuOptionGroup[] | undefined): { lines: SheetOptionLine[]; hidden: number } {
  if (!groups?.length) return { lines: [], hidden: 0 };
  const { shown, hidden } = limitOptionGroups(groups, SHEET_OPTION_ROWS);
  return {
    lines: shown.map((group) => ({ id: group.id, name: group.name, options: group.options.map((option) => ({ id: option.id, name: option.name, deltaCents: option.price_delta_cents })) })),
    hidden,
  };
}

/** Las etiquetas dietarias que aparecen en la carta que se muestra, en el orden de siempre: son las que explica la leyenda. */
export function usedDietaryTags(sections: MenuSection[], order: readonly DietaryTag[]): DietaryTag[] {
  return order.filter((tag) => sections.some((section) => section.products.some((product) => product.dietary_tags?.includes(tag))));
}

/** Ancho de diseño de la hoja (px). Es fijo, como el de una página de PDF: no se reacomoda según la pantalla, se escala. */
export const SHEET_WIDTH = 560;
/** Hasta cuánto se agranda la hoja en una pantalla ancha (en el celular se achica para verla entera). */
export const SHEET_MAX_SCALE = 1.6;

/** Escala con la que la hoja entra justo en `available` px de ancho (redondeada hacia abajo: un píxel de más abriría una barra de desplazamiento). */
export const sheetScale = (available: number): number => Math.min(SHEET_MAX_SCALE, Math.floor((Math.max(0, available) / SHEET_WIDTH) * 1000) / 1000);
