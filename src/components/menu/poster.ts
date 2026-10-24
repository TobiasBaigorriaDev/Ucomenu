import type { MenuSection } from "@/lib/menu";

/**
 * Ancho de las mayúsculas de Big Shoulders a peso 800, en em (medido en el navegador). Casi todas rondan 0,5; estas se apartan.
 * Las letras con tilde miden lo mismo que su base. Es lo que permite que un título llene el ancho sin medirlo en el navegador.
 */
const GLYPH_EM: Record<string, number> = { M: 0.81, W: 0.83, N: 0.6, "&": 0.62, I: 0.25, "1": 0.28, " ": 0.22, "'": 0.21, ".": 0.25, ",": 0.27, L: 0.4, E: 0.43, F: 0.43, T: 0.43, Z: 0.42 };
const DEFAULT_EM = 0.51;
/** Margen para el redondeo del navegador y la fuente de reemplazo mientras carga. */
const SAFETY = 0.96;
/** Ancho de referencia del contenido en el celular de 390 px (sin los gutters), para decidir en cuántas líneas va un título. */
const REFERENCE_PX = 358;

const widthEm = (text: string) => [...text.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase()].reduce((sum, ch) => sum + (GLYPH_EM[ch] ?? DEFAULT_EM), 0);

/** El ancho de la línea más larga al repartir las palabras en `lines` líneas lo más parejas posible (en orden, sin partirlas). */
function widestLine(words: string[], lines: number): number {
  const width = (from: number, to: number) => widthEm(words.slice(from, to).join(" "));
  // best[k][i]: la mejor línea más ancha para las primeras i palabras en k líneas.
  let best = words.map((_, i) => width(0, i + 1));
  for (let k = 2; k <= Math.min(lines, words.length); k++) {
    best = words.map((_, i) => {
      let result = best[i];
      for (let j = k - 2; j < i; j++) result = Math.min(result, Math.max(best[j], width(j + 1, i + 1)));
      return result;
    });
  }
  return best[words.length - 1];
}

/**
 * Tamaño de un título del estilo «afiche» que llena el ancho de su contenedor (`cqi`, el elemento padre lleva `@container`).
 * Prueba en 1, 2… `maxLines` líneas parejas y se queda con la primera que no baja de `min` en el celular; la palabra más larga
 * siempre entra en una línea. Entre `min` y `max` (rem) manda el ancho; un nombre larguísimo parte con `overflow-wrap`.
 */
export function posterFontSize(text: string, { min, max, maxLines = 3 }: { min: number; max: number; maxLines?: number }): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return `${min}rem`;
  let size = 0;
  for (let lines = 1; lines <= maxLines; lines++) {
    size = (100 * SAFETY) / widestLine(words, lines);
    if ((size / 100) * REFERENCE_PX >= min * 16) break;
  }
  // Redondeado hacia abajo: un centésimo de más ya puede pasar una palabra a otra línea.
  return `clamp(${min}rem, ${Math.floor(size * 100) / 100}cqi, ${max}rem)`;
}

/**
 * Número decorativo de cada plato dentro de su categoría (1, 2, 3…), según el orden completo de la carta. Se calcula sobre
 * las secciones sin filtrar: al buscar o filtrar por dieta, cada plato conserva su número. No se guarda ni cambia el orden.
 */
export function dishNumbers(sections: MenuSection[]): Map<string, number> {
  return new Map(sections.flatMap((section) => section.products.map((product, i) => [product.id, i + 1] as const)));
}

/** «01», «02»… «10»: dos cifras como mínimo. */
export const formatDishNumber = (n: number): string => String(n).padStart(2, "0");
