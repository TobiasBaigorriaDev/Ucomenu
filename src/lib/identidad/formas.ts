/**
 * Carácter de las piezas de la carta (ADR 0050): esquinas, bordes y densidad. No cambian ningún color, así que el contraste de las
 * paletas queda intacto, y los objetivos táctiles conservan su mínimo (`min-h-11`). Ortogonal al estilo de composición: «Afiche»
 * ya trae esquinas rectas y filetes propios y no cambia con la forma.
 */
export const SHAPES = {
  suave: { name: "Suave", description: "Esquinas redondeadas y píldoras, como hoy." },
  recta: { name: "Recta", description: "Esquinas en ángulo recto: más sobria y de imprenta." },
  filete: { name: "Filete", description: "Ángulo recto con bordes de tinta marcados, como un menú de bistró." },
} as const;

export const DENSITIES = {
  aireada: { name: "Aireada", description: "Más espacio entre platos y secciones." },
  compacta: { name: "Compacta", description: "Menos espacio: se ven más platos sin desplazarse tanto." },
} as const;

export type Shape = keyof typeof SHAPES;
export type Density = keyof typeof DENSITIES;
export const SHAPE_KEYS = Object.keys(SHAPES) as Shape[];
export const DENSITY_KEYS = Object.keys(DENSITIES) as Density[];
export const DEFAULT_SHAPE: Shape = "suave";
export const DEFAULT_DENSITY: Density = "aireada";
export const isShape = (value: unknown): value is Shape => typeof value === "string" && Object.hasOwn(SHAPES, value);
export const isDensity = (value: unknown): value is Density => typeof value === "string" && Object.hasOwn(DENSITIES, value);
