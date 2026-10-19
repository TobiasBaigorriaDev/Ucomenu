/**
 * Idiomas de la carta pública (ficha carta-en-varios-idiomas, ADR 0023). El español es el idioma original de todo lo que
 * carga el local; el inglés y el portugués son traducciones opcionales que escribe el propio local. Nada se traduce solo.
 *
 * Módulo puro: lo usan la carta (servidor y cliente), el panel y las pruebas.
 */

export const BASE_LANG = "es";
export const TRANSLATED_LANGS = ["en", "pt"] as const;
export const LANGS = [BASE_LANG, ...TRANSLATED_LANGS] as const;

export type Lang = (typeof LANGS)[number];
export type TranslatedLang = (typeof TRANSLATED_LANGS)[number];

/** Cada idioma se nombra en sí mismo (así lo reconoce quien lo lee) y el selector no depende del idioma activo. */
export const LANG_NAME: Record<Lang, string> = { es: "Español", en: "English", pt: "Português" };

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

export function isTranslatedLang(value: unknown): value is TranslatedLang {
  return typeof value === "string" && (TRANSLATED_LANGS as readonly string[]).includes(value);
}

/** Primer valor de un parámetro de la URL (`?lang=a&lang=b` llega como lista). */
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Idiomas de `Accept-Language` en orden de preferencia (`q`), sin la región: `pt-BR;q=0.8` -> `pt`. */
export function preferredLanguages(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split("-")[0], weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((item) => item.lang && item.lang !== "*" && item.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map((item) => item.lang);
}

/**
 * Idioma con el que se abre la carta. `available` son los idiomas que el local ofrece (siempre incluye el español):
 *  1. el que pidió la persona en la dirección (`?lang=`), si el local lo ofrece;
 *  2. el primero de los idiomas del navegador que el local ofrezca;
 *  3. el español.
 * No se guarda nada en el dispositivo: la elección vive en la dirección de la página.
 */
export function resolveLang(input: {
  param?: string | string[] | undefined;
  acceptLanguage?: string | null;
  available: readonly Lang[];
}): Lang {
  const requested = first(input.param);
  if (requested !== undefined) return isLang(requested) && input.available.includes(requested) ? requested : BASE_LANG;
  for (const candidate of preferredLanguages(input.acceptLanguage)) {
    if (isLang(candidate) && input.available.includes(candidate)) return candidate;
  }
  return BASE_LANG;
}
