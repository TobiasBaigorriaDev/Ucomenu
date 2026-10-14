export type TileShape = "small" | "wide" | "tall";

/**
 * Forma de cada mosaico de categoría en una grilla de 2 columnas. Se arma con bloques que siempre
 * completan sus filas, así que nunca quedan huecos:
 *  - A: dos chicos (una fila)
 *  - B: uno ancho (una fila)
 *  - C: uno alto a la izquierda y dos chicos a la derecha (dos filas)
 * Se repite A, B, C. Si sobran menos de los que pide el bloque, el resto se completa con un ancho (1) o con A (2).
 */
export function mosaicLayout(count: number): TileShape[] {
  const units: TileShape[][] = [
    ["small", "small"],
    ["wide"],
    ["tall", "small", "small"],
  ];
  const shapes: TileShape[] = [];
  let turn = 0;
  while (shapes.length < count) {
    const remaining = count - shapes.length;
    const unit = units[turn % units.length];
    if (unit.length <= remaining) shapes.push(...unit);
    else shapes.push(...(remaining === 1 ? units[1] : units[0]));
    turn++;
  }
  return shapes;
}

/** Cuántas celdas de la grilla de 2 columnas ocupa cada forma. */
export const TILE_AREA: Record<TileShape, number> = { small: 1, wide: 2, tall: 2 };
