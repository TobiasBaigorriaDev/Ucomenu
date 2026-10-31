import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contraste WCAG 2.x AA de los colores de la portada (ficha portada-ucomenu, «Contraste AA»). Lee los tokens `--mk-*` de
 * `marketing.css`: si alguien cambia un color y un par de texto baja de 4,5:1 (3:1 en componentes sin texto), esta prueba falla.
 * Mide pares de colores planos; el texto sobre fotos y video no se puede medir acá.
 */
const css = readFileSync(path.join(__dirname, "marketing.css"), "utf8");
const token = (name: string): [number, number, number] => {
  const m = css.match(new RegExp(`--mk-${name}` + String.raw`:\s*#([0-9a-f]{6})`, "i"));
  if (!m) throw new Error(`falta el token --mk-${name}`);
  const h = m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};
const WHITE: [number, number, number] = [255, 255, 255];
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const mix = (fg: number[], bg: number[], alpha: number) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
const ratio = (a: number[], b: number[]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("contraste de la portada", () => {
  const ink = token("ink");
  const muted = token("muted");
  const fondos = { paper: token("paper"), sand: token("sand"), mint: token("mint"), blanco: WHITE };

  it.each(Object.entries(fondos))("el texto principal y el secundario se leen sobre %s (AA, 4,5:1)", (_nombre, fondo) => {
    expect(ratio(ink, fondo)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(muted, fondo)).toBeGreaterThanOrEqual(4.5);
  });

  it("el texto blanco, también al 82 % de opacidad, se lee sobre el verde y el verde profundo", () => {
    for (const fondo of [token("green"), token("deep")]) {
      expect(ratio(WHITE, fondo)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(mix(WHITE, fondo, 0.82), fondo)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("los enlaces y títulos en verde se leen sobre el papel, la menta y el blanco", () => {
    expect(ratio(token("green"), token("paper"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(token("green"), token("mint"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(token("deep"), token("mint"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(token("deep"), WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it("el verde vivo (solo rombos decorativos, sin texto) cumple los 3:1 de los componentes gráficos", () => {
    expect(ratio(token("vivid"), token("paper"))).toBeGreaterThanOrEqual(3);
  });
});
