import { describe, expect, it } from "vitest";
import { LANGS } from "@/lib/idiomas/idiomas";
import { PALETTES, type Palette } from "./palettes";
import { activeTheme, buenosAiresDay, isDay, isTheme, MOTIFS, NO_THEME, patternSvg, PATTERN_OPACITY, themeStatus, themeStyle, THEME_KEYS, THEMES } from "./temas";

const at = (iso: string) => new Date(iso);

describe("ventana de fechas del tema", () => {
  const setting = { theme: "navidad", from: "2026-12-20", until: "2026-12-26" };

  it("usa el día calendario de Buenos Aires, no el de UTC", () => {
    // 02:30 UTC del 21 todavía es 23:30 del 20 en Buenos Aires (UTC−3).
    expect(buenosAiresDay(at("2026-12-21T02:30:00Z"))).toBe("2026-12-20");
    expect(buenosAiresDay(at("2026-12-21T03:00:00Z"))).toBe("2026-12-21");
  });
  it("«desde» y «hasta» son inclusivos", () => {
    expect(activeTheme(setting, at("2026-12-20T03:00:00Z"))).toBe("navidad"); // 00:00 del 20 en Buenos Aires
    expect(activeTheme(setting, at("2026-12-27T02:59:00Z"))).toBe("navidad"); // 23:59 del 26
    expect(activeTheme(setting, at("2026-12-20T02:59:00Z"))).toBeNull(); // 23:59 del 19
    expect(activeTheme(setting, at("2026-12-27T03:00:00Z"))).toBeNull(); // 00:00 del 27
  });
  it("distingue programado, activo y vencido", () => {
    expect(themeStatus(setting, at("2026-12-01T12:00:00Z"))).toEqual({ kind: "scheduled", theme: "navidad", from: "2026-12-20" });
    expect(themeStatus(setting, at("2026-12-22T12:00:00Z"))).toEqual({ kind: "active", theme: "navidad", until: "2026-12-26" });
    expect(themeStatus(setting, at("2027-01-05T12:00:00Z"))).toEqual({ kind: "expired", theme: "navidad", until: "2026-12-26" });
  });
  it("cualquiera de las dos fechas puede faltar; sin ninguna queda activo hasta que se apague", () => {
    expect(activeTheme({ theme: "halloween", from: "2026-10-25" }, at("2030-01-01T12:00:00Z"))).toBe("halloween");
    expect(activeTheme({ theme: "halloween", from: "2026-10-25" }, at("2026-10-24T12:00:00Z"))).toBeNull();
    expect(activeTheme({ theme: "halloween", until: "2026-11-02" }, at("2020-01-01T12:00:00Z"))).toBe("halloween");
    expect(activeTheme({ theme: "halloween", until: "2026-11-02" }, at("2026-11-03T12:00:00Z"))).toBeNull();
    expect(activeTheme({ theme: "halloween", from: null, until: null }, at("2026-06-01T12:00:00Z"))).toBe("halloween");
  });
  it("sin tema, o con un valor desconocido, no hay nada que mostrar", () => {
    for (const theme of [NO_THEME, "__proto__", "toString", "otro", "", null, undefined]) {
      expect(activeTheme({ theme }, at("2026-12-22T12:00:00Z")), String(theme)).toBeNull();
      expect(themeStatus({ theme }, at("2026-12-22T12:00:00Z")).kind).toBe("none");
    }
  });
  it("una fecha mal formada se ignora en vez de ocultar o forzar el tema", () => {
    expect(activeTheme({ theme: "navidad", from: "mañana", until: "2026-13-40" }, at("2026-12-22T12:00:00Z"))).toBe("navidad");
  });
  it("solo acepta fechas reales del calendario", () => {
    for (const ok of ["2026-02-28", "2028-02-29"]) expect(isDay(ok), ok).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "2026-2-1", "20260201", "", null, 20260201]) expect(isDay(bad), String(bad)).toBe(false);
  });
});

describe("catálogo de temas", () => {
  it("solo admite los temas conocidos", () => {
    for (const key of THEME_KEYS) expect(isTheme(key)).toBe(true);
    for (const value of [NO_THEME, "__proto__", "constructor", "#fff", null]) expect(isTheme(value)).toBe(false);
  });
  it.each(THEME_KEYS)("%s: saludo en cada idioma, motivos conocidos y patrón generado", (key) => {
    const info = THEMES[key];
    for (const lang of LANGS) expect(info.greeting[lang].trim(), `${key}.${lang}`).not.toBe("");
    expect(info.greeting.en).not.toBe(info.greeting.es);
    expect(info.motifs.length).toBeGreaterThan(0);
    for (const motif of info.motifs) expect(MOTIFS[motif]).toBeDefined();
    const svg = patternSvg(key);
    expect(svg).toMatch(/^<svg [^>]*width="96" height="96"/);
    expect(svg.match(/<g /g)).toHaveLength(3);
    // El patrón es una máscara: solo importa la transparencia, y sin recursos externos ni scripts.
    expect(svg).not.toMatch(/href|<script|<image|url\(/i);
    const style = themeStyle(key) as Record<string, string>;
    expect(style["--tema-patron"]).toMatch(/^url\("data:image\/svg\+xml,/);
    expect(style["--tema-opacidad"]).toBe(String(PATTERN_OPACITY));
  });
  it("sin tema no se agrega ninguna variable", () => {
    expect(themeStyle(null)).toEqual({});
    expect(themeStyle(undefined)).toEqual({});
  });
  it("los temas de la base y los del código coinciden", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../../../supabase/migrations/20261109100000_temas_de_fecha.sql", import.meta.url), "utf8");
    const list = sql.match(/menu_theme in \(([^)]*)\)/)?.[1] ?? "";
    expect([...list.matchAll(/'([a-z]+)'/g)].map(([, value]) => value).sort()).toEqual([NO_THEME, ...THEME_KEYS].sort());
  });
});

// ── Contraste con el patrón puesto ─────────────────────────────────────────────────────────────────────────────────

function channels(hex: string) {
  return hex.replace("#", "").match(/../g)!.map((x) => parseInt(x, 16));
}
function luminance(hex: string) {
  return channels(hex)
    .map((x) => x / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
}
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
/** El color de `over` con la opacidad `alpha` sobre `under`. */
function blend(over: string, under: string, alpha: number) {
  const o = channels(over);
  const u = channels(under);
  return `#${o.map((c, i) => Math.round(c * alpha + u[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
}

describe("el patrón no le quita legibilidad al texto", () => {
  // Peor caso: el patrón cubre por completo el punto donde cae el texto (la máscara real cubre una parte pequeña del mosaico).
  it.each(Object.entries(PALETTES) as [Palette, (typeof PALETTES)[Palette]][])("%s conserva AA sobre el fondo teñido", (_key, p) => {
    const tinted = blend(p.terra, p.background, PATTERN_OPACITY);
    expect(contrast(p.ink, tinted)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.muted, tinted)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.accent, tinted)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.terra, tinted)).toBeGreaterThanOrEqual(4.5);
    // El texto de «agotado» y los avisos van en la tinta sobre el fondo de la página.
    expect(contrast(p.ink, tinted)).toBeGreaterThanOrEqual(7);
  });
});
