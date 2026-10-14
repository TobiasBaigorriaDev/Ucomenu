/** Validaciones puras de textos y ids de la carta (sin base ni red): se prueban en `carta.test.ts`. */

export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 300;

export type TextProblem = "blank" | "too_long";

const length = (text: string) => [...text].length;

export function validateName(raw: unknown): { ok: true; value: string } | { ok: false; problem: TextProblem } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) return { ok: false, problem: "blank" };
  if (length(value) > NAME_MAX) return { ok: false, problem: "too_long" };
  return { ok: true, value };
}

/** La descripción es opcional: vacía se guarda como `null`. */
export function validateDescription(raw: unknown): { ok: true; value: string | null } | { ok: false; problem: "too_long" } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) return { ok: true, value: null };
  if (length(value) > DESCRIPTION_MAX) return { ok: false, problem: "too_long" };
  return { ok: true, value };
}

export const NAME_MESSAGE: Record<TextProblem, string> = {
  blank: "Ingresá un nombre.",
  too_long: `El nombre puede tener hasta ${NAME_MAX} caracteres.`,
};

export const DESCRIPTION_MESSAGE = `La descripción puede tener hasta ${DESCRIPTION_MAX} caracteres.`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un id que llega de la URL o de un campo oculto: se descarta lo que no es uuid antes de ir a la base. */
export function asUuid(raw: unknown): string | null {
  return typeof raw === "string" && UUID.test(raw) ? raw.toLowerCase() : null;
}
