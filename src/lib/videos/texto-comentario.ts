/**
 * Reglas del texto de un comentario (ficha comentarios-del-feed). Módulo PURO, sin dependencias del servidor: lo usa también el
 * formulario del navegador para contar caracteres con la misma regla que la base y la acción.
 */

export const MAX_COMMENT_LENGTH = 280;
export const MAX_ALIAS_LENGTH = 30;

/** Caracteres de control (incluidos saltos de línea y tabulaciones) y los invisibles que cambian el sentido del texto. */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]+/g;

/** El texto como lo guarda la base: sin invisibles, con los espacios y los saltos de línea colapsados en uno solo y sin los bordes. */
export function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.replace(INVISIBLE, " ").replace(/\s+/g, " ").trim() : "";
}

/** Largo en caracteres, como lo cuenta la base (puntos de código: un emoji vale 1). */
export const lengthOf = (value: string): number => [...value].length;

export type ParsedComment =
  | { ok: true; body: string; alias: string | null }
  | { ok: false; problem: "blank" | "body_too_long" | "alias_too_long" };

/** Valida y normaliza el comentario y el alias. El alias vacío es «sin alias». */
export function parseComment(body: unknown, alias: unknown): ParsedComment {
  const text = normalizeText(body);
  if (text === "") return { ok: false, problem: "blank" };
  if (lengthOf(text) > MAX_COMMENT_LENGTH) return { ok: false, problem: "body_too_long" };
  const name = normalizeText(alias);
  if (lengthOf(name) > MAX_ALIAS_LENGTH) return { ok: false, problem: "alias_too_long" };
  return { ok: true, body: text, alias: name === "" ? null : name };
}

/** Un comentario aprobado, como lo ve el público. */
export type PublicComment = { id: string; alias: string | null; body: string; created_at: string };
