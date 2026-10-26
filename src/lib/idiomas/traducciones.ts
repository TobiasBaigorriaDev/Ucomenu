import { isTranslatedLang, TRANSLATED_LANGS, type Lang, type TranslatedLang } from "./idiomas";

/**
 * Traducciones de un texto de la carta (ficha carta-en-varios-idiomas, ADR 0023). Viven en la columna `translations` de la
 * misma fila: `{"en": {"name": "Flat white", "description": "…"}}`. El español es el texto original de la fila; cada campo
 * que falta en un idioma se muestra en español. Módulo puro (se prueba en `traducciones.test.ts`).
 */

export type Translation = { name?: string; description?: string };
export type Translations = Partial<Record<TranslatedLang, Translation>>;

/** Mismos topes que el texto original (`validation.ts`) y que el CHECK de la base. */
export const TRANSLATED_NAME_MAX = 80;
export const TRANSLATED_DESCRIPTION_MAX = 300;

const length = (text: string) => [...text].length;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Lee la columna de la base sin confiar en su forma: lo que no es un texto no vacío de un idioma conocido se ignora. La base
 * ya lo garantiza (CHECK), pero la carta pública nunca debe romperse por un dato raro.
 */
export function parseTranslations(raw: unknown): Translations {
  if (!isRecord(raw)) return {};
  const result: Translations = {};
  for (const lang of TRANSLATED_LANGS) {
    const entry = raw[lang];
    if (!isRecord(entry)) continue;
    const name = typeof entry.name === "string" && entry.name.trim() ? entry.name : undefined;
    const description = typeof entry.description === "string" && entry.description.trim() ? entry.description : undefined;
    if (name !== undefined || description !== undefined) {
      result[lang] = { ...(name !== undefined ? { name } : {}), ...(description !== undefined ? { description } : {}) };
    }
  }
  return result;
}

/** El texto en `lang`, o el original si ese idioma no lo tiene (siempre el español para `es`). */
export function translated(original: string, translations: Translations | undefined, lang: Lang, field: "name"): string;
export function translated(original: string | null, translations: Translations | undefined, lang: Lang, field: "description"): string | null;
export function translated(
  original: string | null,
  translations: Translations | undefined,
  lang: Lang,
  field: "name" | "description",
): string | null {
  if (!isTranslatedLang(lang)) return original;
  return translations?.[lang]?.[field] ?? original;
}

/** ¿Tiene alguna traducción cargada en `lang`? */
export function hasTranslation(translations: Translations | undefined, lang: TranslatedLang): boolean {
  const entry = translations?.[lang];
  return entry !== undefined && (entry.name !== undefined || entry.description !== undefined);
}

export type TranslationProblem = "name_too_long" | "description_too_long";

/**
 * Nuevo valor de la traducción de una fila al guardar el formulario. `name` y `description` son lo escrito en el campo, o
 * `undefined` si el campo no viajó (las filas sin descripción: categorías, grupos y opciones): ese campo no se toca.
 * Un campo vacío borra la traducción de ese campo (vuelve a verse en español). Si el idioma queda sin campos, se quita el
 * idioma. Devuelve la columna completa y conserva los demás idiomas.
 */
export function applyTranslationInput(
  current: Translations,
  lang: TranslatedLang,
  input: { name?: string; description?: string },
): { ok: true; value: Translations } | { ok: false; problem: TranslationProblem } {
  const previous = current[lang] ?? {};
  const next: Translation = { ...previous };

  for (const field of ["name", "description"] as const) {
    const raw = input[field];
    if (raw === undefined) continue;
    const text = raw.trim();
    if (!text) delete next[field];
    else if (length(text) > (field === "name" ? TRANSLATED_NAME_MAX : TRANSLATED_DESCRIPTION_MAX)) {
      return { ok: false, problem: field === "name" ? "name_too_long" : "description_too_long" };
    } else next[field] = text;
  }

  const value: Translations = { ...current };
  if (next.name === undefined && next.description === undefined) delete value[lang];
  else value[lang] = { ...(next.name !== undefined ? { name: next.name } : {}), ...(next.description !== undefined ? { description: next.description } : {}) };
  return { ok: true, value };
}

/**
 * Quita de TODOS los idiomas los campos cuyo texto original (en español) cambió. Una traducción vieja que sigue visible
 * mientras el original cambió puede mostrar a un comensal extranjero un ingrediente o una opción que ya no son los de la
 * carta; sin traducción, ese campo vuelve a verse en español. Los idiomas que quedan sin campos se quitan.
 */
export function dropStaleTranslations(current: Translations, changed: { name?: boolean; description?: boolean }): Translations {
  const result: Translations = {};
  for (const lang of TRANSLATED_LANGS) {
    const entry = current[lang];
    if (!entry) continue;
    const name = changed.name ? undefined : entry.name;
    const description = changed.description ? undefined : entry.description;
    if (name === undefined && description === undefined) continue;
    result[lang] = { ...(name !== undefined ? { name } : {}), ...(description !== undefined ? { description } : {}) };
  }
  return result;
}

/** ¿Dos columnas son iguales? Sirve para escribir solo las filas que cambiaron. */
export function sameTranslations(a: Translations, b: Translations): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(value: Translations) {
  return TRANSLATED_LANGS.map((lang) => [lang, value[lang]?.name ?? null, value[lang]?.description ?? null]);
}
