/** Etiquetas de mesa: validación, orden natural y sugerencia del próximo nombre. Puro: se prueba en `mesas.test.ts`. */

export const LABEL_MAX = 40;

export type LabelProblem = "blank" | "too_long";

export function validateLabel(raw: unknown): { ok: true; value: string } | { ok: false; problem: LabelProblem } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) return { ok: false, problem: "blank" };
  if ([...value].length > LABEL_MAX) return { ok: false, problem: "too_long" };
  return { ok: true, value };
}

/** Orden natural: «Mesa 2» antes de «Mesa 10», sin distinguir mayúsculas ni acentos. */
const collator = new Intl.Collator("es-AR", { numeric: true, sensitivity: "base" });

export function sortByLabel<T extends { label: string }>(tables: T[]): T[] {
  return [...tables].sort((a, b) => collator.compare(a.label, b.label));
}

/** «Mesa N+1» según la mayor numeración «Mesa N» que ya exista; si no hay ninguna, «Mesa {cantidad + 1}». */
export function suggestNextLabel(labels: string[]): string {
  let max = 0;
  for (const label of labels) {
    const match = /^\s*mesa\s+(\d{1,6})\s*$/i.exec(label);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `Mesa ${max > 0 ? max + 1 : labels.length + 1}`;
}
