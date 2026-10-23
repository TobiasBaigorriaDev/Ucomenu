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

// ---------------------------------------------------------------------------
// Enlace de reseñas de Google (ficha enlace-de-resenas-de-google)
// ---------------------------------------------------------------------------

/** Debe coincidir con el CHECK `branches_google_review_url_check` de la base (en caracteres). */
export const REVIEW_URL_MAX = 500;

/**
 * Únicos sitios a los que puede apuntar el enlace: los de los perfiles de Google (`g.page`, `search.google.com`, `maps.app.goo.gl`,
 * Maps…). Es la MISMA lista que el CHECK de la base; ampliarla es una migración. Sin puertos ni usuario: solo el host exacto.
 */
export const GOOGLE_REVIEW_HOSTS = [
  "g.page",
  "g.co",
  "goo.gl",
  "maps.app.goo.gl",
  "share.google",
  "search.google.com",
  "maps.google.com",
  "google.com",
  "www.google.com",
  "google.com.ar",
  "www.google.com.ar",
] as const;

const escapeHost = (host: string) => host.replace(/\./g, String.raw`\.`);

/**
 * https, host exacto de la lista y, si sigue algo, empieza con «/». Sin espacios, caracteres de control ni barras invertidas.
 * Espejo del CHECK de la base: una prueba de RLS compara los dos con la misma tabla de casos.
 */
export const REVIEW_URL_PATTERN = new RegExp(
  String.raw`^https://(${GOOGLE_REVIEW_HOSTS.map(escapeHost).join("|")})(/[^\s\u0000-\u001f\u007f\\]*)?$`,
  "i",
);

export type ReviewLinkProblem = "invalid" | "too_long";

/**
 * Enlace de reseñas tal como lo escribe la persona. Vacío = quitarlo (`value: null`). Se recortan los espacios de los bordes y no se
 * «arregla» nada más: lo que no sea una dirección https de Google se rechaza.
 */
export function validateReviewLink(raw: unknown): { ok: true; value: string | null } | { ok: false; problem: ReviewLinkProblem } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, problem: "invalid" };
  const value = raw.trim();
  if (value === "") return { ok: true, value: null };
  if ([...value].length > REVIEW_URL_MAX) return { ok: false, problem: "too_long" };
  return REVIEW_URL_PATTERN.test(value) ? { ok: true, value } : { ok: false, problem: "invalid" };
}

/**
 * El enlace de reseñas como lo usa la carta pública: el guardado, si cumple la lista de Google, o `null`. La carta no confía en
 * la columna (el CHECK ya la acota; esto es la segunda barrera antes de ponerla en un `href`) y no «arregla» nada.
 */
export function publicReviewUrl(stored: unknown): string | null {
  return typeof stored === "string" && [...stored].length <= REVIEW_URL_MAX && REVIEW_URL_PATTERN.test(stored) ? stored : null;
}
