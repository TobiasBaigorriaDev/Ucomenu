/** Ancla de la sección de una categoría. La usan el mosaico, la barra (cliente) y la sección (servidor). */
export function categoryAnchor(categoryId: string): string {
  return `cat-${categoryId}`;
}

/** Id del mosaico de categorías: la barra fija aparece cuando el mosaico ya quedó arriba de la pantalla. */
export const MOSAIC_ID = "carta-categorias";
