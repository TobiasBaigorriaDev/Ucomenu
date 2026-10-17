import type { CSSProperties } from "react";

// Contrastes verificados en palettes.test.ts; los valores se aplican solo dentro de .carta.
export const PALETTES = {
  oliva: { name: "Oliva", background: "#f4efe4", ink: "#2a2622", muted: "#655d52", accent: "#3d5f48", deep: "#2f4a39", terra: "#a43f22", blush: "#f3d2c6", sand: "#e8dcc2" },
  azul: { name: "Azul", background: "#f1f2eb", ink: "#253039", muted: "#566166", accent: "#284e68", deep: "#1c394e", terra: "#914335", blush: "#e6d8c9", sand: "#e2e6d8" },
  vino: { name: "Vino", background: "#fbf3e8", ink: "#33262b", muted: "#715b63", accent: "#713a4a", deep: "#552c37", terra: "#99492f", blush: "#f0d8d7", sand: "#ede0c9" },
  cacao: { name: "Cacao", background: "#f5efe3", ink: "#30271f", muted: "#6a5e4c", accent: "#654633", deep: "#4d3528", terra: "#8f4c29", blush: "#f2dfce", sand: "#e6dbbf" },
} as const;

export type Palette = keyof typeof PALETTES;
export const isPalette = (value: unknown): value is Palette => typeof value === "string" && Object.hasOwn(PALETTES, value);

export function paletteStyle(value: string | null | undefined): CSSProperties {
  const p = PALETTES[isPalette(value) ? value : "oliva"];
  return {
    "--porcelain": p.background, "--ink": p.ink, "--muted": p.muted, "--cobalt": p.accent,
    "--carta-green": p.accent, "--carta-green-deep": p.deep, "--carta-terra": p.terra,
    "--carta-blush": p.blush, "--carta-sand": p.sand,
  } as CSSProperties;
}
