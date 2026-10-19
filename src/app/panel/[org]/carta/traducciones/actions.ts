"use server";

import { cartaErrorMessage } from "@/lib/carta/catalog";
import type { FormState } from "@/lib/form-state";
import { isTranslatedLang } from "@/lib/idiomas/idiomas";
import { readEntries, saveTranslations } from "@/lib/idiomas/panel";
import { NOT_FOUND, prepare, refresh } from "../action-helpers";

/**
 * Guarda las traducciones de un idioma (ficha carta-en-varios-idiomas). Igual que el resto de las acciones de la carta:
 * exige sesión y membresía del local, escribe con el cliente de la persona (RLS) y, si guardó algo, vence la caché de la
 * carta pública. Un campo vacío borra esa traducción.
 */
export async function saveTranslationsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const lang = formData.get("lang");
  if (!isTranslatedLang(lang)) return NOT_FOUND;

  const result = await saveTranslations(db, orgId, lang, readEntries(formData));
  // Aunque una escritura falle a mitad, las anteriores quedaron guardadas: la carta pública se refresca igual.
  if (result.changed > 0) refresh(slug, orgId);

  if (!result.ok) {
    // Se devuelve lo escrito (los campos de traducción) para no perder el trabajo ante un error.
    const values: Record<string, string> = {};
    for (const [key, value] of formData.entries()) if (typeof value === "string" && /^[cpgo]:/.test(key)) values[key] = value;
    const saved = result.changed > 0 ? ` Se guardaron ${result.changed} cambios antes del error.` : "";
    return { error: `${cartaErrorMessage(result.error, null)}${saved}`, values };
  }
  const message =
    result.changed === 0 ? "No había cambios para guardar." : result.changed === 1 ? "Se guardó 1 cambio." : `Se guardaron ${result.changed} cambios.`;
  return { ok: true, message };
}
