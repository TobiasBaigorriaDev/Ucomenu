import type { Ambient } from "./ambientes";
import type { Density, Shape } from "./formas";
import type { Layout } from "./layouts";
import type { Palette } from "./palettes";
import type { Font } from "./tipografias";

/**
 * El conjunto de opciones de estilo que el panel guarda junto (paleta, estilo de carta, tipografía, forma, densidad y ambientación).
 * Un «look» es una combinación ya armada de estas seis: no agrega nada que no se pueda elegir a mano, así que hereda todas las garantías
 * de los catálogos cerrados (contraste AA de las paletas, textura bajo `PATTERN_OPACITY`, etc.). `looks.test.ts` comprueba que cada
 * clave exista y que los looks sean distintos entre sí.
 */
export type StyleDraft = { palette: Palette; layout: Layout; font: Font; shape: Shape; density: Density; ambient: Ambient };

type LookPreset = StyleDraft & { name: string; description: string };

export const LOOKS = {
  cafeteria: {
    name: "Cafetería de especialidad",
    description: "Cálido y sereno: tonos de cacao, letra suave y granos de café de fondo.",
    palette: "cacao", layout: "minimal", font: "calida", shape: "suave", density: "aireada", ambient: "granos",
  },
  bodegon: {
    name: "Bodegón de barrio",
    description: "Mantel a cuadros, letra de cartel y bordes marcados, con mucha carta a la vista.",
    palette: "trattoria", layout: "clasica", font: "bodegon", shape: "filete", density: "compacta", ambient: "cuadros",
  },
  bar: {
    name: "Bar nocturno",
    description: "Fondo oscuro, títulos enormes numerados y esquinas rectas, como un cartel de noche.",
    palette: "carbon", layout: "afiche", font: "nocturna", shape: "recta", density: "compacta", ambient: "ninguno",
  },
  bistro: {
    name: "Bistró de autor",
    description: "Vino y lino, con letra editorial y filetes finos: sobrio y elegante.",
    palette: "vino", layout: "clasica", font: "editorial", shape: "filete", density: "aireada", ambient: "lino",
  },
  brunch: {
    name: "Brunch y panadería",
    description: "Fresco y luminoso: cítricos, mosaico de categorías y hojitas sueltas.",
    palette: "citrico", layout: "bento", font: "moderna", shape: "suave", density: "aireada", ambient: "hojas",
  },
  moderno: {
    name: "Minimalista moderno",
    description: "Blanco y negro, una columna con fotos grandes y esquinas rectas.",
    palette: "monocromo", layout: "minimal", font: "moderna", shape: "recta", density: "aireada", ambient: "ninguno",
  },
} as const satisfies Record<string, LookPreset>;

export type LookKey = keyof typeof LOOKS;
export const LOOK_KEYS = Object.keys(LOOKS) as LookKey[];

export const lookStyle = (key: LookKey): StyleDraft => {
  const { palette, layout, font, shape, density, ambient } = LOOKS[key];
  return { palette, layout, font, shape, density, ambient };
};

export const sameStyle = (a: StyleDraft, b: StyleDraft): boolean =>
  a.palette === b.palette && a.layout === b.layout && a.font === b.font && a.shape === b.shape && a.density === b.density && a.ambient === b.ambient;

/** El look cuyas seis opciones coinciden con las dadas, o `null` si la combinación es propia. */
export const matchingLook = (style: StyleDraft): LookKey | null => LOOK_KEYS.find(key => sameStyle(lookStyle(key), style)) ?? null;
