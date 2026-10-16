/** Reglas puras de las sucursales (ficha gestion-de-sucursales): nombre, identificador y sugerencia. Se prueban en `sucursales.test.ts`. */
import { isValidSlug, SLUG_MAX_LENGTH } from "@/lib/slug";

/** Debe coincidir con el CHECK `branches_name_max_length` de la base (en caracteres, no en bytes). */
export const BRANCH_NAME_MAX = 80;

export type NameProblem = "blank" | "too_long";

export function validateBranchName(raw: unknown): { ok: true; value: string } | { ok: false; problem: NameProblem } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) return { ok: false, problem: "blank" };
  if ([...value].length > BRANCH_NAME_MAX) return { ok: false, problem: "too_long" };
  return { ok: true, value };
}

export type SlugProblem = "blank" | "invalid";

/**
 * Identificador de la dirección pública (`/m/{local}/{sucursal}`): el mismo contrato que la base (minúsculas, dígitos y
 * guiones simples, de 1 a 64). Se recortan los espacios y se pasa a minúsculas, pero no se «arregla» nada más: lo que
 * escribió la persona es lo que queda, o se rechaza.
 */
export function validateBranchSlug(raw: unknown): { ok: true; value: string } | { ok: false; problem: SlugProblem } {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value.length === 0) return { ok: false, problem: "blank" };
  return isValidSlug(value) ? { ok: true, value } : { ok: false, problem: "invalid" };
}

/** Propuesta de identificador a partir del nombre: sin acentos, minúsculas, guiones simples y a lo sumo 64 caracteres. */
export function suggestSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}
