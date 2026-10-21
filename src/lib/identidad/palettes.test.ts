import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isOwnLogoPath } from "./logos";
import type { CSSProperties } from "react";
import { isPalette, PALETTE_KEYS, PALETTES, PLATFORM_PALETTE, paletteStyle, platformStyle, type Palette } from "./palettes";

function luminance(hex: string) {
  const channels = hex.replace("#", "").match(/../g)!.map((x) => parseInt(x, 16) / 255);
  return channels.map((x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
}
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

type Colors = Omit<(typeof PALETTES)[Palette], "name" | "scheme" | "panel">;

/** Todos los pares de la carta y del panel: texto sobre fondo, blush y arena; texto sobre acento y terracota; precios en terracota. */
function expectAA(p: Colors) {
  for (const background of [p.background, p.blush, p.sand]) {
    expect(contrast(p.ink, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.muted, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.accent, background)).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrast(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(p.onAccent, p.terra)).toBeGreaterThanOrEqual(4.5);
  // Sobre las fotos del mosaico el texto es blanco con un degradado oscuro; mientras la foto carga, el fondo es `deep`.
  expect(contrast("#ffffff", p.deep)).toBeGreaterThanOrEqual(4.5);
  // El precio y las diferencias de opciones van en terracota y texto chico, sobre el fondo y sobre las cards sin foto (arena).
  expect(contrast(p.terra, p.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(p.terra, p.sand)).toBeGreaterThanOrEqual(4.5);
}

describe("paletas de la carta", () => {
  it.each([...Object.entries(PALETTES), ["plataforma (SuperAdmin)", PLATFORM_PALETTE] as const])("%s conserva contraste AA en texto, botones y foco", (_key, p) => {
    expectAA(p);
  });
  it.each(Object.entries(PALETTES).filter(([, p]) => p.scheme === "dark"))("%s (oscura) trae un panel claro con contraste AA", (_key, p) => {
    expect(p.panel).toBeDefined();
    expect(luminance(p.background)).toBeLessThan(0.1);
    expect(luminance(p.panel!.background)).toBeGreaterThan(0.6);
    expectAA(p.panel!);
  });
  it("el panel del Dueño nunca es oscuro y la carta de una paleta oscura avisa al navegador", () => {
    for (const key of Object.keys(PALETTES) as Palette[]) {
      expect(luminance(String(paletteStyle(key, "panel")["--porcelain" as keyof CSSProperties]))).toBeGreaterThan(0.6);
    }
    expect(paletteStyle("carbon")).toMatchObject({ colorScheme: "dark", "--on-accent": "#161412" });
    expect(paletteStyle("oliva")).not.toHaveProperty("colorScheme");
  });
  it("las paletas se ofrecen primero claras y después oscuras", () => {
    const schemes = PALETTE_KEYS.map((key) => PALETTES[key].scheme);
    expect(schemes).toEqual([...schemes].sort((a, b) => (a === b ? 0 : a === "light" ? -1 : 1)));
  });
  it("solo admite las paletas conocidas y recupera la predeterminada ante datos desconocidos", () => {
    for (const value of ["__proto__", "toString", "#ffffff", "otra", null]) expect(isPalette(value)).toBe(false);
    expect(paletteStyle("desconocida")).toEqual(paletteStyle("oliva"));
  });
  it("los colores predeterminados de .carta coinciden con Oliva", () => {
    const css = readFileSync(new URL("../../components/menu/carta.css", import.meta.url), "utf8");
    const block = css.match(/\.carta\s*\{([^}]*)\}/)?.[1];
    expect(block).toBeDefined();
    const defaults = Object.fromEntries(
      [...block!.matchAll(/(--[\w-]+)\s*:\s*(#[\da-f]{6})\s*;/gi)].map(([, name, color]) => [name, color.toLowerCase()]),
    );
    expect(defaults).toEqual(paletteStyle("oliva"));
  });
});

it("la paleta de la plataforma conserva los verdes de UcoNext y no es elegible por un local", () => {
  expect(PLATFORM_PALETTE.accent).toBe("#155b20");
  expect(PLATFORM_PALETTE.vivid).toBe("#4a9e38");
  expect(isPalette("plataforma")).toBe(false);
  expect(platformStyle()).toMatchObject({ "--cobalt": "#155b20", "--vivid": "#4a9e38" });
});

it("un logo solo pertenece a su carpeta exacta", () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const file = "22222222-2222-4222-8222-222222222222.png";
  expect(isOwnLogoPath(`${org}/${file}`, org)).toBe(true);
  for (const path of [`otro/${file}`, `${org}/../${file}`, `${org}/${file}.svg`, `${org}/sub/${file}`]) {
    expect(isOwnLogoPath(path, org)).toBe(false);
  }
});
