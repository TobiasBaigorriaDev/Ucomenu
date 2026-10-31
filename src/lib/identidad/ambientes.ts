import type { CSSProperties } from "react";
import { PATTERN_OPACITY, scatterSvg, type MotifName } from "./temas";

/**
 * Ambientación permanente de la carta (ADR 0050): una textura muy suave de fondo y los adornos del pie. Es el mismo mecanismo que
 * los temas de fecha (máscara SVG inline sobre la terracota de la paleta, opacidad fija `PATTERN_OPACITY`, sin red ni imágenes
 * subidas), así que `ambientes.test.ts` y `temas.test.ts` comprueban el mismo peor caso de contraste AA. Mientras un tema de fecha
 * está vigente, él manda: la textura no se dibuja.
 */
type Info = {
  name: string;
  description: string;
  /** SVG del mosaico (solo importa la transparencia) y su lado en px; `null` = fondo liso. */
  tile: { svg: string; size: number } | null;
  /** Adornos del pie, en orden; `null` = los rombos de siempre. */
  footer: readonly MotifName[] | null;
};

const svg = (size: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;

export const AMBIENTS = {
  ninguno: { name: "Liso", description: "Sin textura: el fondo de tu paleta.", tile: null, footer: null },
  lino: {
    name: "Lino",
    description: "Trama fina de tela.",
    tile: { svg: svg(6, '<path d="M0 .5H6M.5 0V6" stroke="#000" stroke-width="1" fill="none"/>'), size: 6 },
    footer: ["diamond", "diamond", "diamond"],
  },
  cuadros: {
    name: "Cuadros",
    description: "Mantel vichy de bodegón.",
    tile: { svg: svg(32, '<rect width="16" height="32" fill="#000" fill-opacity=".55"/><rect width="32" height="16" fill="#000" fill-opacity=".55"/>'), size: 32 },
    footer: ["star", "diamond", "star"],
  },
  rayas: {
    name: "Rayas",
    description: "Toldo de rayas verticales.",
    tile: { svg: svg(24, '<rect width="12" height="24" fill="#000"/>'), size: 24 },
    footer: ["diamond", "star", "diamond"],
  },
  granos: {
    name: "Granos",
    description: "Granos de café repartidos.",
    tile: { svg: scatterSvg(["bean"]), size: 96 },
    footer: ["bean", "bean", "bean"],
  },
  hojas: {
    name: "Follaje",
    description: "Hojitas sueltas, fresco y natural.",
    tile: { svg: scatterSvg(["leaf"]), size: 96 },
    footer: ["leaf", "flower", "leaf"],
  },
} as const satisfies Record<string, Info>;

export type Ambient = keyof typeof AMBIENTS;
export const AMBIENT_KEYS = Object.keys(AMBIENTS) as Ambient[];
export const NO_AMBIENT: Ambient = "ninguno";
export const isAmbient = (value: unknown): value is Ambient => typeof value === "string" && Object.hasOwn(AMBIENTS, value);

/** Ambiente que se dibuja: `null` si es liso o si hay un tema de fecha vigente (el tema manda). */
export function visibleAmbient(ambient: unknown, themeActive: boolean): Ambient | null {
  return isAmbient(ambient) && ambient !== NO_AMBIENT && !themeActive ? ambient : null;
}

/** Variables CSS de la textura dentro de `.carta` (ver `carta.css`). */
export function ambientStyle(ambient: Ambient | null | undefined): CSSProperties {
  const tile = ambient ? AMBIENTS[ambient].tile : null;
  if (!tile) return {};
  return {
    "--ambiente-patron": `url("data:image/svg+xml,${encodeURIComponent(tile.svg)}")`,
    "--ambiente-tile": `${tile.size}px`,
    "--ambiente-opacidad": String(PATTERN_OPACITY),
  } as CSSProperties;
}
