import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AMBIENT_KEYS, AMBIENTS, ambientStyle, isAmbient, visibleAmbient } from "./ambientes";
import { DEFAULT_LOOK, lookProps, readLook } from "./apariencia";
import { DENSITY_KEYS, isDensity, isShape, SHAPE_KEYS } from "./formas";
import { PALETTES, type Palette } from "./palettes";
import { MOTIFS, PATTERN_OPACITY } from "./temas";
import { FONT_KEYS, FONTS, isFont } from "./tipografias";

const migration = (name: string) => readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8");
const listIn = (sql: string, column: string) => [...(sql.match(new RegExp(`${column} in \\(([^)]*)\\)`))?.[1] ?? "").matchAll(/'([a-z]+)'/g)].map(([, value]) => value).sort();

describe("catálogos cerrados de la personalización ampliada", () => {
  it("las listas de la base y las del código coinciden", () => {
    const sql = migration("20261212100000_personalizacion_ampliada.sql");
    expect(listIn(sql, "menu_font")).toEqual([...FONT_KEYS].sort());
    expect(listIn(sql, "menu_shape")).toEqual([...SHAPE_KEYS].sort());
    expect(listIn(sql, "menu_density")).toEqual([...DENSITY_KEYS].sort());
    expect(listIn(sql, "menu_ambient")).toEqual([...AMBIENT_KEYS].sort());
  });

  it("solo admiten claves conocidas (nada heredado del prototipo)", () => {
    for (const bad of ["__proto__", "constructor", "toString", "Clasica", "", null, undefined, 3]) {
      expect(isFont(bad), String(bad)).toBe(false);
      expect(isShape(bad), String(bad)).toBe(false);
      expect(isDensity(bad), String(bad)).toBe(false);
      expect(isAmbient(bad), String(bad)).toBe(false);
    }
  });

  it("cada voz tiene una escala sensata para el nombre del local", () => {
    for (const key of FONT_KEYS) {
      expect(FONTS[key].scale, key).toBeGreaterThan(0.7);
      expect(FONTS[key].scale, key).toBeLessThanOrEqual(1);
    }
  });
});

describe("lectura de la apariencia", () => {
  it("lo desconocido o ausente cae al predeterminado", () => {
    expect(readLook({})).toEqual(DEFAULT_LOOK);
    expect(readLook({ menu_font: "Comic", menu_shape: 1, menu_density: null, menu_ambient: "__proto__" })).toEqual(DEFAULT_LOOK);
    expect(readLook({ menu_font: "bodegon", menu_shape: "filete", menu_density: "compacta", menu_ambient: "lino" })).toEqual({ font: "bodegon", shape: "filete", density: "compacta", ambient: "lino" });
  });

  it("deja los atributos que usa carta.css y la escala del título", () => {
    const { attrs, style } = lookProps({ font: "nocturna", shape: "recta", density: "compacta", ambient: "cuadros" }, false);
    expect(attrs).toEqual({ "data-fuente": "nocturna", "data-forma": "recta", "data-densidad": "compacta", "data-ambiente": "cuadros" });
    expect((style as Record<string, string>)["--titulo-escala"]).toBe(String(FONTS.nocturna.scale));
    expect((style as Record<string, string>)["--ambiente-patron"]).toMatch(/^url\("data:image\/svg\+xml,/);
  });

  it("con un tema de fecha vigente la textura permanente no se dibuja", () => {
    const { attrs, style } = lookProps({ ...DEFAULT_LOOK, ambient: "granos" }, true);
    expect(attrs["data-ambiente"]).toBeUndefined();
    expect(style as Record<string, string>).not.toHaveProperty("--ambiente-patron");
    expect(visibleAmbient("granos", true)).toBeNull();
    expect(visibleAmbient("ninguno", false)).toBeNull();
    expect(visibleAmbient("granos", false)).toBe("granos");
  });
});

describe("ambientación", () => {
  it.each(AMBIENT_KEYS.filter(key => AMBIENTS[key].tile))("%s: mosaico sin recursos externos y con su tamaño", (key) => {
    const tile = AMBIENTS[key].tile!;
    expect(tile.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /);
    expect(tile.svg).toContain(`width="${tile.size}"`);
    expect(tile.svg).not.toMatch(/href|<script|<image|url\(|on\w+=/i);
    const style = ambientStyle(key) as Record<string, string>;
    expect(style["--ambiente-opacidad"]).toBe(String(PATTERN_OPACITY));
    expect(style["--ambiente-tile"]).toBe(`${tile.size}px`);
  });

  it("los adornos del pie son motivos que existen", () => {
    for (const key of AMBIENT_KEYS) for (const motif of AMBIENTS[key].footer ?? []) expect(MOTIFS[motif], `${key}.${motif}`).toBeDefined();
  });

  it("liso no agrega variables", () => {
    expect(ambientStyle("ninguno")).toEqual({});
    expect(ambientStyle(null)).toEqual({});
  });
});

// ── Contraste con la textura puesta: mismo peor caso y misma opacidad que los temas de fecha ──────────────────────────
const channels = (hex: string) => hex.replace("#", "").match(/../g)!.map(x => parseInt(x, 16));
const luminance = (hex: string) => channels(hex).map(x => x / 255).map(x => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const blend = (over: string, under: string, alpha: number) => `#${channels(over).map((c, i) => Math.round(c * alpha + channels(under)[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;

describe("la textura no le quita legibilidad al texto", () => {
  // Peor caso: la textura cubre por completo el punto donde cae el texto (la máscara real cubre una parte del mosaico).
  it.each(Object.entries(PALETTES) as [Palette, (typeof PALETTES)[Palette]][])("%s conserva AA con cualquier textura", (_key, p) => {
    const tinted = blend(p.terra, p.background, PATTERN_OPACITY);
    for (const color of [p.ink, p.muted, p.accent, p.terra]) expect(contrast(color, tinted)).toBeGreaterThanOrEqual(4.5);
  });
});
