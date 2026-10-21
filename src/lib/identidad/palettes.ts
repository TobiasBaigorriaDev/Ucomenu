import type { CSSProperties } from "react";

type Colors = { background: string; ink: string; muted: string; accent: string; deep: string; terra: string; blush: string; sand: string; onAccent: string };
/**
 * `onAccent` es el color del texto sobre `accent` y `terra` (botones, celdas de la carta): blanco en las paletas claras y la tinta
 * oscura del fondo en las oscuras. Las oscuras traen además `panel`: el panel del Dueño es siempre claro, así que usa esa variante.
 */
type Entry = Colors & { name: string; scheme: "light" | "dark"; panel?: Colors };

// Contrastes verificados en palettes.test.ts; los valores se aplican dentro de .carta y de .panel (panel del Dueño).
const DEFINITIONS = {
  oliva: { name: "Oliva", scheme: "light", background: "#f4efe4", ink: "#2a2622", muted: "#655d52", accent: "#3d5f48", deep: "#2f4a39", terra: "#a43f22", blush: "#f3d2c6", sand: "#e8dcc2", onAccent: "#ffffff" },
  azul: { name: "Azul", scheme: "light", background: "#f1f2eb", ink: "#253039", muted: "#566166", accent: "#284e68", deep: "#1c394e", terra: "#914335", blush: "#e6d8c9", sand: "#e2e6d8", onAccent: "#ffffff" },
  vino: { name: "Vino", scheme: "light", background: "#fbf3e8", ink: "#33262b", muted: "#715b63", accent: "#713a4a", deep: "#552c37", terra: "#99492f", blush: "#f0d8d7", sand: "#ede0c9", onAccent: "#ffffff" },
  cacao: { name: "Cacao", scheme: "light", background: "#f5efe3", ink: "#30271f", muted: "#6a5e4c", accent: "#654633", deep: "#4d3528", terra: "#8f4c29", blush: "#f2dfce", sand: "#e6dbbf", onAccent: "#ffffff" },
  citrico: { name: "Cítrico", scheme: "light", background: "#fffdf5", ink: "#1f2418", muted: "#5a604e", accent: "#a14000", deep: "#7a3000", terra: "#566f00", blush: "#ffe2c7", sand: "#f3efc8", onAccent: "#ffffff" },
  mar: { name: "Mar", scheme: "light", background: "#f2f8f8", ink: "#10292e", muted: "#4b6368", accent: "#0b6e78", deep: "#084b52", terra: "#a63a24", blush: "#cfeaea", sand: "#dfecec", onAccent: "#ffffff" },
  trattoria: { name: "Trattoria", scheme: "light", background: "#fbf6ee", ink: "#2b1a17", muted: "#6b5550", accent: "#b3261e", deep: "#7f1a14", terra: "#1f5f3a", blush: "#f6d5cc", sand: "#efe3cf", onAccent: "#ffffff" },
  monocromo: { name: "Monocromo", scheme: "light", background: "#ffffff", ink: "#111111", muted: "#595959", accent: "#111111", deep: "#000000", terra: "#4d4d4d", blush: "#e8e8e8", sand: "#f2f2f2", onAccent: "#ffffff" },
  carbon: {
    name: "Carbón", scheme: "dark", background: "#161412", ink: "#f2ebe0", muted: "#b3a998", accent: "#d4a54a", deep: "#2a2318", terra: "#e58a55", blush: "#33291f", sand: "#26211c", onAccent: "#161412",
    panel: { background: "#f5f1ea", ink: "#26221c", muted: "#675d4d", accent: "#7a5a10", deep: "#4f3a0a", terra: "#9a4a1a", blush: "#efe0c3", sand: "#e9dfc9", onAccent: "#ffffff" },
  },
  medianoche: {
    name: "Medianoche", scheme: "dark", background: "#0f1824", ink: "#e8eef5", muted: "#a5b3c2", accent: "#d9915f", deep: "#16283b", terra: "#7fb6e6", blush: "#1d2c3f", sand: "#172334", onAccent: "#0f1824",
    panel: { background: "#eef2f7", ink: "#16212e", muted: "#53606f", accent: "#1c3a5c", deep: "#13283f", terra: "#9a4f26", blush: "#dbe4ee", sand: "#e3e8ee", onAccent: "#ffffff" },
  },
  bosque: {
    name: "Bosque", scheme: "dark", background: "#101a14", ink: "#eef0e4", muted: "#aeb9a6", accent: "#9cc98a", deep: "#1b3326", terra: "#e0b45a", blush: "#223629", sand: "#1a2a20", onAccent: "#101a14",
    panel: { background: "#eff3ec", ink: "#1b2a20", muted: "#55645a", accent: "#2f5d3a", deep: "#1f4029", terra: "#8a5a12", blush: "#d9e6d3", sand: "#e4e8da", onAccent: "#ffffff" },
  },
  borgona: {
    name: "Borgoña", scheme: "dark", background: "#1d0f14", ink: "#f6eadf", muted: "#c4aaa5", accent: "#d9ab6b", deep: "#35151f", terra: "#e58f84", blush: "#3a1b25", sand: "#2b151c", onAccent: "#1d0f14",
    panel: { background: "#f8eeee", ink: "#2d1519", muted: "#6d5258", accent: "#6e1f32", deep: "#4e1523", terra: "#7c4c0c", blush: "#f0d6d6", sand: "#eadccb", onAccent: "#ffffff" },
  },
} as const satisfies Record<string, Entry>;

export type Palette = keyof typeof DEFINITIONS;
export const PALETTES: Record<Palette, Entry> = DEFINITIONS;

/** Claves de las paletas, en el orden en que se ofrecen (primero las claras). */
export const PALETTE_KEYS = Object.keys(PALETTES) as Palette[];
export const isPalette = (value: unknown): value is Palette => typeof value === "string" && Object.hasOwn(PALETTES, value);

/**
 * Paleta de la plataforma para el área SuperAdmin (colores de UcoNext): verde oscuro #155B20 (confianza, tecnología), verde
 * vivo #4A9E38 (innovación) y neutros cálidos. No está en `PALETTES`: ningún local puede elegirla. El verde vivo no alcanza
 * contraste AA con texto blanco, así que solo se usa como acento decorativo (`vivid`); los tonos con texto salen de `terra`.
 */
export const PLATFORM_PALETTE = {
  name: "UcoNext", background: "#f6f5f0", ink: "#242621", muted: "#5c5f55", accent: "#155b20", deep: "#0f4318", terra: "#2e7424", blush: "#dcebd3", sand: "#e8e6dc", onAccent: "#ffffff", vivid: "#4a9e38",
} as const;

/** `surface: "panel"` da la variante clara de las paletas oscuras (el panel del Dueño nunca es oscuro); en la carta se usa la paleta tal cual. */
export function paletteStyle(value: string | null | undefined, surface: "carta" | "panel" = "carta"): CSSProperties {
  const entry = PALETTES[isPalette(value) ? value : "oliva"];
  if (entry.scheme === "dark" && surface === "carta") return { ...colorsStyle(entry), colorScheme: "dark" };
  return colorsStyle((surface === "panel" && entry.panel) || entry);
}

export function platformStyle(): CSSProperties {
  return { ...colorsStyle(PLATFORM_PALETTE), "--vivid": PLATFORM_PALETTE.vivid } as CSSProperties;
}

function colorsStyle(p: Colors): CSSProperties {
  return {
    "--porcelain": p.background, "--ink": p.ink, "--muted": p.muted, "--cobalt": p.accent,
    "--carta-green": p.accent, "--carta-green-deep": p.deep, "--carta-terra": p.terra,
    "--carta-blush": p.blush, "--carta-sand": p.sand, "--on-accent": p.onAccent,
  } as CSSProperties;
}
