import type { SupabaseClient } from "@supabase/supabase-js";
import { dropStaleTranslations, parseTranslations, sameTranslations } from "@/lib/idiomas/traducciones";
import type { Database, Json } from "@/lib/supabase/database.types";

/**
 * Información alimentaria al día en todos los idiomas: cuando el local cambia el nombre o la descripción en español (por
 * ejemplo, agrega un ingrediente o una opción), la traducción anterior ya no dice lo mismo y no puede seguir publicada. Al
 * guardar el cambio se quita la traducción de ESE campo en todos los idiomas; ese campo vuelve a verse en español hasta que
 * el local lo traduzca de nuevo. Lo demás se conserva.
 */

type Db = SupabaseClient<Database>;
export type TranslatedTable = "products" | "option_groups" | "options";
type Original = { name: string; description?: string | null };
type Stored = { name: string; description: string | null; translations: Json };

async function readStored(db: Db, table: TranslatedTable, orgId: string, id: string): Promise<{ row: Stored | null } | null> {
  if (table === "products") {
    const { data, error } = await db.from("products").select("name, description, translations").eq("id", id).eq("organization_id", orgId).maybeSingle();
    return error ? null : { row: data };
  }
  const { data, error } = await db.from(table).select("name, translations").eq("id", id).eq("organization_id", orgId).maybeSingle();
  return error ? null : { row: data ? { ...data, description: null } : null };
}

/**
 * Lo que hay que sumar al UPDATE del texto original: `{ translations }` si algún campo cambió y había traducción, o `{}` si
 * no hay nada que quitar. `null` si no se pudo leer el valor actual (quien llama no guarda: sin lectura no se sabe si hay
 * una traducción que quitar). Una fila que no existe da `{}`: el UPDATE mismo informa que no hubo filas.
 */
export async function staleTranslationsPatch(
  db: Db,
  table: TranslatedTable,
  orgId: string,
  id: string,
  next: Original,
): Promise<{ translations: NonNullable<Json> } | Record<string, never> | null> {
  const stored = await readStored(db, table, orgId, id);
  if (!stored) return null;
  if (!stored.row) return {};
  const current = parseTranslations(stored.row.translations);
  const changed = {
    name: next.name !== stored.row.name,
    // Solo los platos tienen descripción: si `next` no la trae, no hay campo que comparar.
    description: next.description !== undefined && (next.description ?? null) !== stored.row.description,
  };
  const kept = dropStaleTranslations(current, changed);
  return sameTranslations(current, kept) ? {} : { translations: kept as NonNullable<Json> };
}
