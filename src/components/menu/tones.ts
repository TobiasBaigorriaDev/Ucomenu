/**
 * Tono de cada categoría: la celda del bento y la banda pegajosa de su sección usan el mismo color, así el comensal
 * reconoce dónde está. Se alternan para que dos vecinas no repitan. Salen de la paleta del local (contraste AA ya
 * comprobado en `palettes.test.ts`: tinta sobre rosa y arena, blanco sobre verde y terracota).
 */
const TONES = [
  "bg-[var(--carta-blush)] text-ink",
  "bg-[var(--carta-green)] text-[var(--on-accent)]",
  "bg-[var(--carta-sand)] text-ink ring-1 ring-inset ring-ink/15",
  "bg-[var(--carta-terra)] text-[var(--on-accent)]",
] as const;

export const toneFor = (index: number): string => TONES[index % TONES.length];
