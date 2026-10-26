import type { TranslatedLang } from "./idiomas";
import { FIELD_PREFIX, flattenTree, type TranslationNode } from "./panel";
import { TRANSLATED_DESCRIPTION_MAX, TRANSLATED_NAME_MAX } from "./traducciones";

/**
 * Sugerencia de traducciones con un servicio externo (ficha traduccion-automatica). La sugerencia SOLO rellena campos vacíos
 * del formulario del panel: nada se guarda hasta que el local la revisa y pulsa «Guardar». Este módulo no habla con ningún
 * servicio: arma el pedido, valida la respuesta y define el contrato del proveedor (`gemini.ts` lo implementa).
 */

export type SuggestionField = "name" | "description";

/** Un texto por traducir: `key` es el nombre del campo del formulario (`p:{id}:name`), igual que en `readEntries`. */
export type SuggestionItem = { key: string; field: SuggestionField; kind: TranslationNode["kind"]; text: string };

/** Cuántos textos se piden por clic. Lo que quede vacío se completa con otro clic: acota el gasto y el tiempo de la acción. */
export const MAX_SUGGESTIONS_PER_REQUEST = 300;

/** Un proveedor devuelve, por cada `key` que pudo traducir, el texto traducido. Lo que omita o rompa se descarta después. */
export interface TranslationProvider {
  readonly name: string;
  translate(items: SuggestionItem[], lang: TranslatedLang): Promise<Record<string, string>>;
}

/**
 * Los textos que faltan en `lang`: el nombre de cada fila sin nombre traducido y la descripción de cada plato que la tiene y
 * no la tiene traducida. En el orden en que se ven, hasta `limit`.
 */
export function collectMissing(tree: TranslationNode[], lang: TranslatedLang, limit = MAX_SUGGESTIONS_PER_REQUEST): SuggestionItem[] {
  const items: SuggestionItem[] = [];
  for (const node of flattenTree(tree)) {
    const prefix = FIELD_PREFIX[node.kind];
    if (node.translations[lang]?.name === undefined && node.name.trim()) {
      items.push({ key: `${prefix}:${node.id}:name`, field: "name", kind: node.kind, text: node.name });
    }
    if (node.kind === "product" && node.description?.trim() && node.translations[lang]?.description === undefined) {
      items.push({ key: `${prefix}:${node.id}:description`, field: "description", kind: node.kind, text: node.description });
    }
  }
  return items.slice(0, limit);
}

const chars = (text: string) => [...text].length;

/**
 * Deja solo lo que el formulario puede recibir: claves que se pidieron, textos no vacíos y dentro de los topes de la base. La
 * respuesta de un servicio externo nunca se confía tal cual (puede traer claves ajenas, textos vacíos o demasiado largos).
 */
export function validateSuggestions(items: SuggestionItem[], raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const answer = raw as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const item of items) {
    const value = answer[item.key];
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (!text) continue;
    if (chars(text) > (item.field === "name" ? TRANSLATED_NAME_MAX : TRANSLATED_DESCRIPTION_MAX)) continue;
    result[item.key] = text;
  }
  return result;
}

/** Cuántos textos viajan en cada pedido al servicio. */
export const SUGGESTION_CHUNK = 40;

export function chunk<T>(list: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < list.length; start += size) chunks.push(list.slice(start, start + size));
  return chunks;
}

export type SuggestionOutcome = { ok: true; suggestions: Record<string, string>; requested: number } | { ok: false; error: "unavailable" | "empty" };

/**
 * Pide al proveedor las traducciones de lo que falta. Si un tramo falla, los que ya volvieron se conservan (el local ya los
 * puede revisar y el resto se pide con otro clic); solo si no volvió ninguno es un error.
 */
export async function suggestTranslations(
  provider: TranslationProvider,
  tree: TranslationNode[],
  lang: TranslatedLang,
): Promise<SuggestionOutcome> {
  const items = collectMissing(tree, lang);
  if (items.length === 0) return { ok: false, error: "empty" };

  const suggestions: Record<string, string> = {};
  for (const part of chunk(items, SUGGESTION_CHUNK)) {
    try {
      Object.assign(suggestions, validateSuggestions(part, await provider.translate(part, lang)));
    } catch {
      break;
    }
  }
  if (Object.keys(suggestions).length === 0) return { ok: false, error: "unavailable" };
  return { ok: true, suggestions, requested: items.length };
}
