import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isOwnLogoPath } from "./logos";
import { isPalette, PALETTES, paletteStyle } from "./palettes";

function luminance(hex: string) {
  const channels = hex.replace("#", "").match(/../g)!.map((x) => parseInt(x, 16) / 255);
  return channels.map((x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
}
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

describe("paletas de la carta", () => {
  it.each(Object.entries(PALETTES))("%s conserva contraste AA en texto, botones y foco", (_key, p) => {
    for (const background of [p.background, p.blush, p.sand]) {
      expect(contrast(p.ink, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.muted, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.accent, background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast("#ffffff", p.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", p.deep)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", p.terra)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.terra, p.background)).toBeGreaterThanOrEqual(3);
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

it("un logo solo pertenece a su carpeta exacta", () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const file = "22222222-2222-4222-8222-222222222222.png";
  expect(isOwnLogoPath(`${org}/${file}`, org)).toBe(true);
  for (const path of [`otro/${file}`, `${org}/../${file}`, `${org}/${file}.svg`, `${org}/sub/${file}`]) {
    expect(isOwnLogoPath(path, org)).toBe(false);
  }
});
