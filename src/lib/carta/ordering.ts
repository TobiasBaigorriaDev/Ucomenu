/**
 * Orden de categorías y platos. `sort_order` es un entero; el público ordena por (orden, nombre).
 * Al mover se reubica el elemento en la lista tal como se ve y se RENUMERA (0, 1, 2…): así dos
 * elementos con el mismo número no dejan el orden en manos del desempate por nombre.
 */

export type Direction = "up" | "down";

export type Orderable = { id: string; name: string; sort_order: number };

const collator = new Intl.Collator("es-AR");

/** Mismo criterio que la carta pública (`groupMenu`). */
export function sortForDisplay<T extends Orderable>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sort_order - b.sort_order || collator.compare(a.name, b.name));
}

/**
 * Nuevo orden tras mover `id` un lugar. Devuelve `null` si no existe o ya está en el borde.
 * El resultado es la lista de ids en el orden final.
 */
export function moveWithin(items: Orderable[], id: string, direction: Direction): string[] | null {
  const ids = sortForDisplay(items).map((item) => item.id);
  const from = ids.indexOf(id);
  if (from === -1) return null;
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length) return null;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}

/** Solo los elementos cuyo `sort_order` cambia al aplicar el orden final (0, 1, 2…). */
export function changesFor(items: Orderable[], finalIds: string[]): { id: string; sort_order: number }[] {
  const current = new Map(items.map((item) => [item.id, item.sort_order]));
  return finalIds.flatMap((id, index) => (current.get(id) === index ? [] : [{ id, sort_order: index }]));
}

/** Lugar de un elemento nuevo: al final. */
export function nextSortOrder(items: Pick<Orderable, "sort_order">[]): number {
  return items.reduce((max, item) => Math.max(max, item.sort_order), -1) + 1;
}
