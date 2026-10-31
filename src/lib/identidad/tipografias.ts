/**
 * Voces tipográficas de la carta (ADR 0050): cambian SOLO la fuente de los títulos (nombre del local, categorías, precios grandes).
 * El texto de lectura (descripciones, precios de lista, etiquetas) sigue en Schibsted Grotesk, así que ninguna voz puede volver
 * ilegible un plato. Las fuentes se declaran en `components/menu/carta-fonts.ts` y se aplican con `carta.css`; el estilo «Afiche»
 * conserva su condensada propia. `scale` ajusta el tamaño del nombre del local: las fuentes anchas necesitan menos para no partir palabras.
 */
export const FONTS = {
  clasica: { name: "Tradicional", description: "Serif de contraste, la de siempre. Cafés y restaurantes.", scale: 1 },
  calida: { name: "Cálida", description: "Serif suave y cercana. Panaderías, cafeterías de especialidad.", scale: 0.96 },
  editorial: { name: "Editorial", description: "Serif de revista, fina y elegante. Cocina de autor.", scale: 1 },
  moderna: { name: "Moderna", description: "Sans geométrica con carácter. Brunch, cocina fusión.", scale: 0.94 },
  bodegon: { name: "Bodegón", description: "Slab robusta, de cartel de barrio. Parrillas, bodegones.", scale: 0.82 },
  nocturna: { name: "Nocturna", description: "Display ancha y atrevida. Bares y cervecerías.", scale: 0.86 },
} as const;

export type Font = keyof typeof FONTS;
export const FONT_KEYS = Object.keys(FONTS) as Font[];
export const DEFAULT_FONT: Font = "clasica";
export const isFont = (value: unknown): value is Font => typeof value === "string" && Object.hasOwn(FONTS, value);
