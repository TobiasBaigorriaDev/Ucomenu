/**
 * Estilos de carta que puede elegir un local. Cambian la composición (índice de categorías y forma de los platos), no los datos
 * ni los colores: todos usan la misma paleta y el mismo detalle de plato. «Afiche» suma una tipografía de títulos condensada
 * (Big Shoulders, ver `carta-fonts.ts`).
 */
export const LAYOUTS = {
  bento: { name: "Bento", description: "Mosaico de categorías con fotos y platos en tarjetas." },
  clasica: { name: "Clásica", description: "Categorías en pestañas y platos en lista con precio, como una carta impresa." },
  minimal: { name: "Minimal", description: "Una columna con fotos grandes y mucho aire." },
  afiche: { name: "Afiche", description: "Títulos enormes, platos numerados y bloques de color, como un cartel de bar." },
} as const;

export type Layout = keyof typeof LAYOUTS;
export const LAYOUT_KEYS = Object.keys(LAYOUTS) as Layout[];
export const isLayout = (value: unknown): value is Layout => typeof value === "string" && Object.hasOwn(LAYOUTS, value);
