import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEntitlements, type Entitlements } from "@/lib/entitlements";
import type { Database } from "@/lib/supabase/database.types";
import { detectImage, IMAGE_BUCKET, imagePath, isOwnImagePath, MAX_IMAGE_BYTES } from "./images";
import { cartaErrorMessage, writeBlock, type CartaError } from "./messages";
import { changesFor, moveWithin, nextSortOrder, sortForDisplay, type Direction } from "./ordering";
import { parsePrice, type PriceProblem } from "./price";
import { validateDescription, validateName } from "./validation";

/**
 * Gestión de la carta (ficha gestion-de-carta). Todo se hace con el cliente de la PERSONA (rol
 * `authenticated`, RLS): la autorización de fondo —membresía, cuenta al día y tope de platos activos—
 * vive en la base. Este módulo no la reemplaza: la muestra con mensajes claros y NO da por hecho un
 * guardado que la base descartó.
 *
 * Regla de oro: un UPDATE/DELETE bloqueado por RLS afecta 0 filas SIN error. Por eso toda escritura
 * pide de vuelta las filas afectadas (`.select()`) y trata «0 filas» como un fallo con su causa.
 */

type Db = SupabaseClient<Database>;

export type Result<T = void> = { ok: true; data: T } | { ok: false; error: CartaError };

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: CartaError): Result<never> => ({ ok: false, error });

export { cartaErrorMessage };
export type { CartaError };

type PgError = { code?: string; message?: string } | null;

const LIMIT_EXCEEDED = "53400"; // configuration_limit_exceeded (ADR 0006)
const FOREIGN_KEY_VIOLATION = "23503";
const INSUFFICIENT_PRIVILEGE = "42501";

const PRICE_ERROR: Record<PriceProblem, CartaError> = {
  blank: "price_blank",
  invalid: "price_invalid",
  too_many_decimals: "price_decimals",
  too_big: "price_big",
};

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export type CartaProduct = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  sort_order: number;
  is_active: boolean;
  image_path: string | null;
};

export type CartaCategory = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  products: CartaProduct[];
};

const PRODUCT_COLUMNS = "id, category_id, name, description, price_cents, sort_order, is_active, image_path";

/** La carta completa de la organización, incluidos los elementos inactivos, en el orden en que se ve. */
export async function loadCarta(db: Db, orgId: string): Promise<CartaCategory[]> {
  const [categories, products] = await Promise.all([
    db.from("categories").select("id, name, sort_order, is_active").eq("organization_id", orgId),
    db.from("products").select(PRODUCT_COLUMNS).eq("organization_id", orgId),
  ]);
  if (categories.error) throw new Error(`No se pudieron leer las categorías: ${categories.error.message}`);
  if (products.error) throw new Error(`No se pudieron leer los platos: ${products.error.message}`);

  return sortForDisplay(categories.data).map((category) => ({
    ...category,
    products: sortForDisplay(products.data.filter((product) => product.category_id === category.id)),
  }));
}

export async function loadProduct(db: Db, orgId: string, productId: string): Promise<CartaProduct | null> {
  const { data, error } = await db
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("id", productId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el plato: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Apoyo
// ---------------------------------------------------------------------------

async function entitlementsOf(db: Db, orgId: string): Promise<Entitlements | null> {
  const { data, error } = await db.rpc("org_entitlements", { p_org: orgId });
  return error ? null : parseEntitlements(data);
}

/** Corta antes de escribir si la cuenta está en solo lectura o suspendida (la base también lo impediría). */
async function guard(db: Db, orgId: string): Promise<CartaError | null> {
  return writeBlock(await entitlementsOf(db, orgId));
}

/**
 * Una escritura devolvió 0 filas: o el elemento no existe en esta organización, o la base lo bloqueó
 * (cuenta que cambió de estado entre la comprobación y la escritura, por ejemplo). Se distingue leyendo.
 */
async function explainZeroRows(db: Db, orgId: string, table: "categories" | "products", id: string): Promise<CartaError> {
  const { data, error } = await db.from(table).select("id").eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (error) return "unexpected";
  if (!data) return "not_found";
  return (await guard(db, orgId)) ?? "unexpected";
}

function writeError(error: NonNullable<PgError>): CartaError {
  if (error.code === LIMIT_EXCEEDED) return "limit";
  if (error.code === FOREIGN_KEY_VIOLATION) return "category_invalid";
  if (error.code === INSUFFICIENT_PRIVILEGE) return "forbidden";
  return "unexpected";
}

/** Si la escritura fue rechazada por RLS (42501), la causa más probable es la cuenta: se confirma leyendo el estado. */
async function writeFailure(db: Db, orgId: string, error: NonNullable<PgError>): Promise<CartaError> {
  const mapped = writeError(error);
  if (mapped === "forbidden") return (await guard(db, orgId)) ?? "forbidden";
  return mapped;
}

// ---------------------------------------------------------------------------
// Categorías
// ---------------------------------------------------------------------------

export async function createCategory(db: Db, orgId: string, input: { name: string }): Promise<Result<{ id: string }>> {
  const name = validateName(input.name);
  if (!name.ok) return fail(name.problem === "blank" ? "name_blank" : "name_too_long");

  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const existing = await db.from("categories").select("sort_order").eq("organization_id", orgId);
  if (existing.error) return fail("unexpected");

  const { data, error } = await db
    .from("categories")
    .insert({ organization_id: orgId, name: name.value, sort_order: nextSortOrder(existing.data) })
    .select("id")
    .single();
  if (error) return fail(await writeFailure(db, orgId, error));
  return ok({ id: data.id });
}

export async function renameCategory(db: Db, orgId: string, id: string, input: { name: string }): Promise<Result> {
  const name = validateName(input.name);
  if (!name.ok) return fail(name.problem === "blank" ? "name_blank" : "name_too_long");

  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db
    .from("categories")
    .update({ name: name.value })
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id");
  if (error) return fail(await writeFailure(db, orgId, error));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, "categories", id));
  return ok(undefined);
}

export async function setCategoryActive(db: Db, orgId: string, id: string, active: boolean): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db
    .from("categories")
    .update({ is_active: active })
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id");
  if (error) return fail(await writeFailure(db, orgId, error));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, "categories", id));
  return ok(undefined);
}

export async function moveCategory(db: Db, orgId: string, id: string, direction: Direction): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const list = await db.from("categories").select("id, name, sort_order").eq("organization_id", orgId);
  if (list.error) return fail("unexpected");
  if (!list.data.some((item) => item.id === id)) return fail("not_found");

  const final = moveWithin(list.data, id, direction);
  if (!final) return ok(undefined); // ya está en el borde: nada que mover
  return applyOrder(db, orgId, "categories", changesFor(list.data, final));
}

// ---------------------------------------------------------------------------
// Platos
// ---------------------------------------------------------------------------

export type ProductInput = {
  categoryId: string;
  name: string;
  description: string;
  price: string;
};

type ParsedProduct = { name: string; description: string | null; price_cents: number };

function parseProduct(input: ProductInput): Result<ParsedProduct> {
  const name = validateName(input.name);
  if (!name.ok) return fail(name.problem === "blank" ? "name_blank" : "name_too_long");
  const description = validateDescription(input.description);
  if (!description.ok) return fail("description_too_long");
  const price = parsePrice(input.price);
  if (!price.ok) return fail(PRICE_ERROR[price.problem]);
  return ok({ name: name.value, description: description.value, price_cents: price.cents });
}

async function categoryBelongs(db: Db, orgId: string, categoryId: string): Promise<boolean> {
  const { data, error } = await db
    .from("categories")
    .select("id")
    .eq("id", categoryId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return !error && data !== null;
}

async function nextProductOrder(db: Db, orgId: string, categoryId: string): Promise<number | null> {
  const { data, error } = await db
    .from("products")
    .select("sort_order")
    .eq("organization_id", orgId)
    .eq("category_id", categoryId);
  return error ? null : nextSortOrder(data);
}

export async function createProduct(
  db: Db,
  orgId: string,
  input: ProductInput & { active: boolean },
): Promise<Result<{ id: string }>> {
  const parsed = parseProduct(input);
  if (!parsed.ok) return parsed;

  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  if (!(await categoryBelongs(db, orgId, input.categoryId))) return fail("category_invalid");
  const sortOrder = await nextProductOrder(db, orgId, input.categoryId);
  if (sortOrder === null) return fail("unexpected");

  const { data, error } = await db
    .from("products")
    .insert({
      organization_id: orgId,
      category_id: input.categoryId,
      ...parsed.data,
      sort_order: sortOrder,
      is_active: input.active,
    })
    .select("id")
    .single();
  if (error) return fail(await writeFailure(db, orgId, error));
  return ok({ id: data.id });
}

export async function updateProduct(db: Db, orgId: string, id: string, input: ProductInput): Promise<Result> {
  const parsed = parseProduct(input);
  if (!parsed.ok) return parsed;

  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const current = await loadProduct(db, orgId, id);
  if (!current) return fail("not_found");
  if (!(await categoryBelongs(db, orgId, input.categoryId))) return fail("category_invalid");

  // Al cambiar de categoría, el plato va al final de la nueva.
  let sortOrder = current.sort_order;
  if (current.category_id !== input.categoryId) {
    const next = await nextProductOrder(db, orgId, input.categoryId);
    if (next === null) return fail("unexpected");
    sortOrder = next;
  }

  const { data, error } = await db
    .from("products")
    .update({ ...parsed.data, category_id: input.categoryId, sort_order: sortOrder })
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id");
  if (error) return fail(await writeFailure(db, orgId, error));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, "products", id));
  return ok(undefined);
}

export async function setProductActive(db: Db, orgId: string, id: string, active: boolean): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db
    .from("products")
    .update({ is_active: active })
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id");
  if (error) return fail(await writeFailure(db, orgId, error));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, "products", id));
  return ok(undefined);
}

export async function moveProduct(db: Db, orgId: string, id: string, direction: Direction): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const product = await loadProduct(db, orgId, id);
  if (!product) return fail("not_found");

  const list = await db
    .from("products")
    .select("id, name, sort_order")
    .eq("organization_id", orgId)
    .eq("category_id", product.category_id);
  if (list.error) return fail("unexpected");

  const final = moveWithin(list.data, id, direction);
  if (!final) return ok(undefined);
  return applyOrder(db, orgId, "products", changesFor(list.data, final));
}

/** Aplica la renumeración. Cada fila se confirma: si alguna no cambió, el orden no se da por guardado. */
async function applyOrder(
  db: Db,
  orgId: string,
  table: "categories" | "products",
  changes: { id: string; sort_order: number }[],
): Promise<Result> {
  const results = await Promise.all(
    changes.map((change) =>
      db.from(table).update({ sort_order: change.sort_order }).eq("id", change.id).eq("organization_id", orgId).select("id"),
    ),
  );
  for (const [index, result] of results.entries()) {
    if (result.error) return fail(await writeFailure(db, orgId, result.error));
    if (result.data.length === 0) return fail(await explainZeroRows(db, orgId, table, changes[index].id));
  }
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Fotos
// ---------------------------------------------------------------------------

/** Borra un archivo del bucket. Si falla no rompe nada (queda huérfano): se registra la ruta para limpiarlo. */
async function removeObject(db: Db, path: string): Promise<void> {
  const { error } = await db.storage.from(IMAGE_BUCKET).remove([path]);
  if (error) console.error(`No se pudo borrar la foto huérfana ${path}: ${error.message}`);
}

/**
 * Sube la foto de un plato y la deja como la vigente. Orden: validar → subir con nombre nuevo → apuntar el
 * plato → borrar la anterior. Si apuntar el plato falla, se borra la recién subida: no quedan huérfanas
 * por el camino normal.
 */
export async function setProductImage(db: Db, orgId: string, productId: string, file: File | null): Promise<Result> {
  if (!file || file.size === 0) return fail("image_missing");
  if (file.size > MAX_IMAGE_BYTES) return fail("image_big");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectImage(bytes);
  if (!kind) return fail("image_type");

  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const product = await loadProduct(db, orgId, productId);
  if (!product) return fail("not_found");

  const path = imagePath(orgId, productId, kind.ext);
  const upload = await db.storage.from(IMAGE_BUCKET).upload(path, bytes, { contentType: kind.mime, upsert: false });
  if (upload.error) {
    console.error(`No se pudo subir la foto ${path}: ${upload.error.message}`);
    return fail((await guard(db, orgId)) ?? "image_failed");
  }

  const { data, error } = await db
    .from("products")
    .update({ image_path: path })
    .eq("id", productId)
    .eq("organization_id", orgId)
    .select("id");
  if (error || data.length === 0) {
    await removeObject(db, path);
    return fail(error ? await writeFailure(db, orgId, error) : await explainZeroRows(db, orgId, "products", productId));
  }

  if (product.image_path && isOwnImagePath(product.image_path, orgId, productId)) {
    await removeObject(db, product.image_path);
  }
  return ok(undefined);
}

export async function removeProductImage(db: Db, orgId: string, productId: string): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const product = await loadProduct(db, orgId, productId);
  if (!product) return fail("not_found");
  if (!product.image_path) return ok(undefined);

  const { data, error } = await db
    .from("products")
    .update({ image_path: null })
    .eq("id", productId)
    .eq("organization_id", orgId)
    .select("id");
  if (error) return fail(await writeFailure(db, orgId, error));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, "products", productId));

  if (isOwnImagePath(product.image_path, orgId, productId)) await removeObject(db, product.image_path);
  return ok(undefined);
}
