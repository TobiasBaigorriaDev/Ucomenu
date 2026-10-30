/**
 * Estilos de carta que puede elegir un local. Cambian la composición (índice de categorías y forma de los platos), no los datos
 * ni los colores: todos usan la misma paleta y el mismo detalle de plato. «Afiche» suma una tipografía de títulos condensada
 * (Big Shoulders, ver `carta-fonts.ts`); «Hoja» es una página fija de dos columnas, sin fotos de plato, que se amplía con los dedos.
 */
export const LAYOUTS = {
  bento: { name: "Bento", description: "Mosaico de categorías con fotos y platos en tarjetas." },
  clasica: { name: "Clásica", description: "Categorías en pestañas y platos en lista con precio, como una carta impresa." },
  minimal: { name: "Minimal", description: "Una columna con fotos grandes y mucho aire." },
  afiche: { name: "Afiche", description: "Títulos enormes, platos numerados y bloques de color, como un cartel de bar." },
  hoja: { name: "Hoja", description: "Toda la carta como una página de PDF: se ve entera y se amplía con los dedos. Solo texto, con precios y disponibilidad al día." },
} as const;

export type Layout = keyof typeof LAYOUTS;
export const LAYOUT_KEYS = Object.keys(LAYOUTS) as Layout[];
export const isLayout = (value: unknown): value is Layout => typeof value === "string" && Object.hasOwn(LAYOUTS, value);
