import type { SupabaseClient } from "@supabase/supabase-js";
import { explainZeroRows, guard, writeFailure, type CartaError, type OrderedTable } from "@/lib/carta/catalog";
import { sortForDisplay } from "@/lib/carta/ordering";
import { readAllPages } from "@/lib/paginar";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { TranslatedLang } from "./idiomas";
import { applyTranslationInput, parseTranslations, sameTranslations, type Translations } from "./traducciones";

/**
 * Traducciones de la carta en el panel (ficha carta-en-varios-idiomas, ADR 0023). Mismas reglas que el resto de la carta:
 * se lee y se escribe con el cliente de la PERSONA (RLS), la autorización de fondo vive en la base (membresía y cuenta
 * al día) y un UPDATE bloqueado afecta 0 filas SIN error, así que cada escritura pide de vuelta las filas.
 */

type Db = SupabaseClient<Database>;

export type NodeKind = "category" | "product" | "group" | "option";

const TABLE: Record<NodeKind, OrderedTable> = { category: "categories", product: "products", group: "option_groups", option: "options" };
/** Prefijo del nombre de los campos del formulario: `c:{id}:name`, `p:{id}:description`. */
export const FIELD_PREFIX: Record<NodeKind, string> = { category: "c", product: "p", group: "g", option: "o" };
const KIND_BY_PREFIX = Object.fromEntries(Object.entries(FIELD_PREFIX).map(([kind, prefix]) => [prefix, kind])) as Record<string, NodeKind>;

export type TranslationNode = {
  kind: NodeKind;
  id: string;
  /** Texto original, en español. */
  name: string;
  /** Solo los platos tienen descripción. */
  description: string | null;
  isActive: boolean;
  translations: Translations;
  children: TranslationNode[];
};

type Row = { id: string; name: string; sort_order: number; is_active: boolean; translations: Json };
type ProductRow = Row & { category_id: string; description: string | null };
type GroupRow = Row & { product_id: string };
type OptionRow = Row & { group_id: string };

const node = (kind: NodeKind, row: Row, description: string | null, children: TranslationNode[]): TranslationNode => ({
  kind,
  id: row.id,
  name: row.name,
  description,
  isActive: row.is_active,
  translations: parseTranslations(row.translations),
  children,
});

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(key(row));
    if (list) list.push(row);
    else map.set(key(row), [row]);
  }
  return map;
}

/**
 * Toda la carta de la organización (también lo oculto: se puede traducir antes de publicar) como árbol: categorías, sus
 * platos, los grupos de cada plato y las opciones de cada grupo, en el orden en que se ven. Lee página por página.
 */
export async function loadTranslationTree(db: Db, orgId: string): Promise<TranslationNode[]> {
  const [categories, products, groups, options] = await Promise.all([
    readAllPages((from, to) =>
      db.from("categories").select("id, name, sort_order, is_active, translations").eq("organization_id", orgId).order("id").range(from, to),
    ),
    readAllPages((from, to) =>
      db
        .from("products")
        .select("id, category_id, name, description, sort_order, is_active, translations")
        .eq("organization_id", orgId)
        .order("id")
        .range(from, to),
    ),
    readAllPages((from, to) =>
      db
        .from("option_groups")
        .select("id, product_id, name, sort_order, is_active, translations")
        .eq("organization_id", orgId)
        .order("id")
        .range(from, to),
    ),
    readAllPages((from, to) =>
      db.from("options").select("id, group_id, name, sort_order, is_active, translations").eq("organization_id", orgId).order("id").range(from, to),
    ),
  ]);
  for (const read of [categories, products, groups, options]) {
    if (read.error) throw new Error(`No se pudo leer la carta para traducir: ${read.error.message}`);
  }

  const optionsByGroup = groupBy((options.data ?? []) as OptionRow[], (row) => row.group_id);
  const groupsByProduct = groupBy((groups.data ?? []) as GroupRow[], (row) => row.product_id);
  const productsByCategory = groupBy((products.data ?? []) as ProductRow[], (row) => row.category_id);

  const groupNode = (group: GroupRow) =>
    node("group", group, null, sortForDisplay(optionsByGroup.get(group.id) ?? []).map((option) => node("option", option, null, [])));
  const productNode = (product: ProductRow) =>
    node("product", product, product.description, sortForDisplay(groupsByProduct.get(product.id) ?? []).map(groupNode));

  return sortForDisplay((categories.data ?? []) as Row[]).map((category) =>
    node("category", category, null, sortForDisplay(productsByCategory.get(category.id) ?? []).map(productNode)),
  );
}

/** Recorre el árbol en el orden en que se muestra. */
export function flattenTree(tree: TranslationNode[]): TranslationNode[] {
  return tree.flatMap((item) => [item, ...flattenTree(item.children)]);
}

/** Cuántos textos hay para traducir en el idioma y cuántos ya tienen traducción. Las descripciones cuentan solo si el plato la tiene. */
export function translationProgress(tree: TranslationNode[], lang: TranslatedLang): { total: number; done: number } {
  let total = 0;
  let done = 0;
  for (const item of flattenTree(tree)) {
    total += 1;
    if (item.translations[lang]?.name !== undefined) done += 1;
    if (item.kind === "product" && item.description) {
      total += 1;
      if (item.translations[lang]?.description !== undefined) done += 1;
    }
  }
  return { total, done };
}

/** Un campo del formulario ya leído: qué fila y qué texto. */
export type TranslationEntry = { kind: NodeKind; id: string; name?: string; description?: string };

const FIELD = /^([cpgo]):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(name|description)$/;

/**
 * Lee los campos `c|p|g|o:{id}:name|description` del formulario. Lo que no tiene esa forma se ignora, y la descripción solo
 * vale para los platos.
 */
export function readEntries(formData: FormData): TranslationEntry[] {
  const entries = new Map<string, TranslationEntry>();
  for (const [key, value] of formData.entries()) {
    const match = FIELD.exec(key);
    if (!match || typeof value !== "string") continue;
    const kind = KIND_BY_PREFIX[match[1]];
    const field = match[3] as "name" | "description";
    if (field === "description" && kind !== "product") continue;
    const id = match[2];
    const entry = entries.get(`${kind}:${id}`) ?? { kind, id };
    entry[field] = value;
    entries.set(`${kind}:${id}`, entry);
  }
  return [...entries.values()];
}

/** `changed` son las filas que SÍ se guardaron: aunque una falle a mitad, las anteriores quedan guardadas y la carta pública debe refrescarse. */
export type SaveResult = { ok: true; changed: number } | { ok: false; error: CartaError; changed: number };

/** Cuántas escrituras van a la vez (cada una es un pedido a la base). */
const BATCH = 8;

/**
 * Guarda las traducciones al `lang` de las filas que cambiaron. Un campo vacío borra esa traducción (vuelve a verse en
 * español); las filas que no cambiaron no se escriben. Se parte del estado leído de la base, así que una fila ajena a
 * esta organización o inexistente simplemente se ignora. Si la cuenta no puede escribir, no toca nada. Límite aceptado: si
 * dos personas guardan DISTINTOS idiomas de la misma fila en el mismo instante, gana la última (se reescribe la columna).
 */
export async function saveTranslations(
  db: Db,
  orgId: string,
  lang: TranslatedLang,
  entries: TranslationEntry[],
): Promise<SaveResult> {
  const blocked = await guard(db, orgId);
  if (blocked) return { ok: false, error: blocked, changed: 0 };

  const current = new Map(flattenTree(await loadTranslationTree(db, orgId)).map((item) => [`${item.kind}:${item.id}`, item]));

  const writes: { kind: NodeKind; id: string; value: Translations }[] = [];
  for (const entry of entries) {
    const existing = current.get(`${entry.kind}:${entry.id}`);
    if (!existing) continue;
    const next = applyTranslationInput(existing.translations, lang, { name: entry.name, description: entry.description });
    if (!next.ok) return { ok: false, error: next.problem, changed: 0 };
    if (!sameTranslations(existing.translations, next.value)) writes.push({ kind: entry.kind, id: entry.id, value: next.value });
  }

  let saved = 0;
  for (let start = 0; start < writes.length; start += BATCH) {
    const batch = writes.slice(start, start + BATCH);
    const results = await Promise.all(
      batch.map((write) =>
        db
          .from(TABLE[write.kind])
          .update({ translations: write.value as NonNullable<Json> })
          .eq("id", write.id)
          .eq("organization_id", orgId)
          .select("id"),
      ),
    );
    // Se cuentan todas las del grupo antes de informar el primer fallo: las que sí se guardaron ya cambiaron la carta.
    let failure: CartaError | null = null;
    for (const [index, result] of results.entries()) {
      if (!result.error && result.data.length > 0) {
        saved += 1;
      } else if (!failure) {
        failure = result.error
          ? await writeFailure(db, orgId, result.error)
          : await explainZeroRows(db, orgId, TABLE[batch[index].kind], batch[index].id);
      }
    }
    if (failure) return { ok: false, error: failure, changed: saved };
  }
  return { ok: true, changed: saved };
}
