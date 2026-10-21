import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEntitlements, type Entitlements } from "@/lib/entitlements";
import { readAllByKey } from "@/lib/paginar";
import type { Database } from "@/lib/supabase/database.types";
import { detectImage, IMAGE_BUCKET, imagePath, isOwnImagePath, MAX_IMAGE_BYTES } from "./images";
import { cartaErrorMessage, writeBlock, type CartaError } from "./messages";
import { changesFor, moveWithin, nextSortOrder, sortForDisplay, type Direction } from "./ordering";
import { parsePrice, type PriceProblem } from "./price";
import { validateDescription, validateName } from "./validation";
import { parseDietaryTags } from "./dietary";

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

/** Tablas de la carta con `sort_order` e `is_active` que se reordenan con el mismo mecanismo. */
export type OrderedTable = "categories" | "products" | "option_groups" | "options";

export type Result<T = void> = { ok: true; data: T } | { ok: false; error: CartaError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (error: CartaError): Result<never> => ({ ok: false, error });

export { cartaErrorMessage };
export type { CartaError };

type PgError = { code?: string; message?: string } | null;

const LIMIT_EXCEEDED = "53400"; // configuration_limit_exceeded (ADR 0006)
const FOREIGN_KEY_VIOLATION = "23503";
const INSUFFICIENT_PRIVILEGE = "42501";
const OBJECT_NOT_IN_STATE = "55000"; // reorder_siblings: los hermanos cambiaron desde que se leyeron (no 40001: PostgREST lo reintenta solo)

/** Un error con código vino de la base (que revirtió la escritura); sin código es la red: el resultado es incierto. */
export function isDbError(error: { code?: string }): boolean {
  return typeof error.code === "string" && error.code !== "";
}

export const PRICE_ERROR: Record<PriceProblem, CartaError> = {
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
  dietary_tags: string[];
};

export type CartaCategory = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  products: CartaProduct[];
};

const PRODUCT_COLUMNS = "id, category_id, name, description, price_cents, sort_order, is_active, image_path, dietary_tags";

/** La carta completa de la organización, incluidos los elementos inactivos, en el orden en que se ve. */
export async function loadCarta(db: Db, orgId: string): Promise<CartaCategory[]> {
  // Por páginas y con orden estable (id): PostgREST corta cada lectura en 1000 filas sin avisar, y los inactivos no tienen tope.
  const [categories, products] = await Promise.all([
    readAllByKey((after, limit) => {
      const query = db.from("categories").select("id, name, sort_order, is_active").eq("organization_id", orgId);
      return (after ? query.gt("id", after) : query).order("id").limit(limit);
    }),
    readAllByKey((after, limit) => {
      const query = db.from("products").select(PRODUCT_COLUMNS).eq("organization_id", orgId);
      return (after ? query.gt("id", after) : query).order("id").limit(limit);
    }),
  ]);
  if (categories.error) throw new Error(`No se pudieron leer las categorías: ${categories.error.message}`);
  if (products.error) throw new Error(`No se pudieron leer los platos: ${products.error.message}`);

  const byCategory = new Map<string, CartaProduct[]>();
  for (const product of products.data ?? []) {
    const siblings = byCategory.get(product.category_id);
    if (siblings) siblings.push(product);
    else byCategory.set(product.category_id, [product]);
  }
  return sortForDisplay(categories.data ?? []).map((category) => ({
    ...category,
    products: sortForDisplay(byCategory.get(category.id) ?? []),
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
export async function guard(db: Db, orgId: string): Promise<CartaError | null> {
  return writeBlock(await entitlementsOf(db, orgId));
}

/**
 * Una escritura devolvió 0 filas: o el elemento no existe en esta organización, o la base lo bloqueó
 * (cuenta que cambió de estado entre la comprobación y la escritura, por ejemplo). Se distingue leyendo.
 */
export async function explainZeroRows(db: Db, orgId: string, table: OrderedTable, id: string): Promise<CartaError> {
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
export async function writeFailure(db: Db, orgId: string, error: NonNullable<PgError>): Promise<CartaError> {
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

  // Solo hace falta la posición más alta: una fila, no la lista (que se cortaría en 1000).
  const existing = await db
    .from("categories")
    .select("sort_order")
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: false })
    .limit(1);
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

  return moveSibling(db, orgId, { table: "categories", scope: orgId }, id, direction);
}

// ---------------------------------------------------------------------------
// Platos
// ---------------------------------------------------------------------------

export type ProductInput = {
  categoryId: string;
  name: string;
  description: string;
  price: string;
  dietaryTags?: unknown;
};

type ParsedProduct = { name: string; description: string | null; price_cents: number; dietary_tags?: string[] };

function parseProduct(input: ProductInput): Result<ParsedProduct> {
  const name = validateName(input.name);
  if (!name.ok) return fail(name.problem === "blank" ? "name_blank" : "name_too_long");
  const description = validateDescription(input.description);
  if (!description.ok) return fail("description_too_long");
  const price = parsePrice(input.price);
  if (!price.ok) return fail(PRICE_ERROR[price.problem]);
  // Omitido conserva etiquetas en clientes internos antiguos; el formulario siempre envía un arreglo (incluso vacío).
  const tags = input.dietaryTags === undefined ? undefined : parseDietaryTags(input.dietaryTags);
  if (tags === null) return fail("dietary_invalid");
  return ok({ name: name.value, description: description.value, price_cents: price.cents, ...(tags ? { dietary_tags: tags } : {}) });
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
    .eq("category_id", categoryId)
    .order("sort_order", { ascending: false })
    .limit(1);
  return error ? null : nextSortOrder(data);
}

/**
 * Crea un plato. `hiddenBranches` son las sucursales donde NO se muestra: con alguna, el plato y sus ocultamientos se crean en UNA
 * transacción (`create_product_in_branches`, que corre con la RLS de la persona): un fallo (cupo, cuenta en solo lectura,
 * sucursal ajena) no deja un plato visible en todas. Sin ninguna, es el alta de siempre.
 */
export async function createProduct(
  db: Db,
  orgId: string,
  input: ProductInput & { active: boolean; hiddenBranches?: string[] },
): Promise<Result<{ id: string }>> {
  const parsed = parseProduct(input);
  if (!parsed.ok) return parsed;

  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  if (!(await categoryBelongs(db, orgId, input.categoryId))) return fail("category_invalid");
  const sortOrder = await nextProductOrder(db, orgId, input.categoryId);
  if (sortOrder === null) return fail("unexpected");

  if (input.hiddenBranches && input.hiddenBranches.length > 0) {
    const { data, error } = await db.rpc("create_product_in_branches", {
      p_org: orgId,
      p_category: input.categoryId,
      p_name: parsed.data.name,
      p_description: parsed.data.description as string,
      p_price_cents: parsed.data.price_cents,
      p_sort_order: sortOrder,
      p_is_active: input.active,
      p_dietary_tags: parsed.data.dietary_tags ?? [],
      p_hidden_branches: input.hiddenBranches,
    });
    if (error) return fail(await writeFailure(db, orgId, error));
    return typeof data === "string" ? ok({ id: data }) : fail("unexpected");
  }

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

  return moveSibling(db, orgId, { table: "products", scope: product.category_id }, id, direction);
}

/**
 * Los «hermanos» entre los que se mueve un elemento: todas las categorías del local (`scope` = la organización), los platos de
 * una categoría, los grupos de un plato o las opciones de un grupo.
 */
export type OrderScope = { table: OrderedTable; scope: string };

type Sibling = { id: string; name: string; sort_order: number };

/** Todos los hermanos, por páginas y con orden estable: un local puede tener más de 1000 categorías o platos (los inactivos no tienen tope). */
async function readSiblings(db: Db, orgId: string, { table, scope }: OrderScope): Promise<Sibling[] | null> {
  const cols = "id, name, sort_order";
  const page = (after: string | null, limit: number) => {
    switch (table) {
      case "categories": {
        const query = db.from("categories").select(cols).eq("organization_id", orgId);
        return (after ? query.gt("id", after) : query).order("id").limit(limit);
      }
      case "products": {
        const query = db.from("products").select(cols).eq("organization_id", orgId).eq("category_id", scope);
        return (after ? query.gt("id", after) : query).order("id").limit(limit);
      }
      case "option_groups": {
        const query = db.from("option_groups").select(cols).eq("organization_id", orgId).eq("product_id", scope);
        return (after ? query.gt("id", after) : query).order("id").limit(limit);
      }
      case "options": {
        const query = db.from("options").select(cols).eq("organization_id", orgId).eq("group_id", scope);
        return (after ? query.gt("id", after) : query).order("id").limit(limit);
      }
    }
  };
  const { data, error } = await readAllByKey<Sibling>(page);
  return error ? null : data;
}

/** El servidor reintenta con una lectura nueva si otro movimiento se coló entre su lectura y su escritura. */
const MOVE_ATTEMPTS = 5;

/**
 * Sube o baja un elemento un lugar. Lee los hermanos, calcula el orden final y lo aplica con `applyOrder` (una transacción que
 * bloquea a los hermanos y comprueba que siguen como se leyeron). Si dos personas mueven a la vez, la segunda recibe
 * `order_changed`, vuelve a leer y mueve sobre el estado nuevo: los dos movimientos quedan aplicados, uno detrás del otro.
 */
export async function moveSibling(db: Db, orgId: string, order: OrderScope, id: string, direction: Direction): Promise<Result> {
  for (let attempt = 1; ; attempt++) {
    const siblings = await readSiblings(db, orgId, order);
    if (!siblings) return fail("unexpected");
    if (!siblings.some((item) => item.id === id)) return fail("not_found");

    const final = moveWithin(siblings, id, direction);
    if (!final) return ok(undefined); // ya está en el borde: nada que mover

    const applied = await applyOrder(db, orgId, order, siblings, final);
    if (applied.ok || applied.error !== "order_changed" || attempt >= MOVE_ATTEMPTS) return applied;
  }
}

/**
 * Aplica la renumeración con UNA llamada a la base (`reorder_siblings`): o cambian todas las posiciones o ninguna. La función
 * corre con los permisos de la persona (RLS y GRANT por columna siguen mandando) y rechaza el pedido si los hermanos ya no son
 * los que `current` describe (`order_changed`). Un fallo sin código de base (red cortada) es `uncertain`: pudo haberse aplicado.
 */
export async function applyOrder(
  db: Db,
  orgId: string,
  order: OrderScope,
  current: Sibling[],
  finalIds: string[],
): Promise<Result> {
  if (changesFor(current, finalIds).length === 0) return ok(undefined);

  const { error } = await db.rpc("reorder_siblings", {
    p_table: order.table,
    p_org: orgId,
    p_scope: order.scope,
    p_current: current.map((item) => ({ id: item.id, sort_order: item.sort_order })),
    p_final: finalIds,
  });
  if (!error) return ok(undefined);
  if (!isDbError(error)) return fail("uncertain");
  if (error.code === OBJECT_NOT_IN_STATE && error.message === "order_changed") return fail("order_changed");
  return fail(await writeFailure(db, orgId, error));
}

// ---------------------------------------------------------------------------
// Fotos
// ---------------------------------------------------------------------------

/**
 * Borra un archivo del bucket. Si falla no rompe nada (queda huérfano): se registra la ruta para limpiarlo y se devuelve `false`.
 * Un borrado que Storage descarta por RLS devuelve CERO objetos y ningún error, así que también se cuenta.
 */
async function removeObject(db: Db, path: string): Promise<boolean> {
  try {
    const { data, error } = await db.storage.from(IMAGE_BUCKET).remove([path]);
    if (error) {
      console.error(`No se pudo borrar la foto huérfana ${path}: ${error.message}`);
      return false;
    }
    if (!data || data.length === 0) {
      console.error(`No se pudo borrar la foto huérfana ${path}: Storage no borró ningún objeto.`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`No se pudo borrar la foto huérfana ${path}: ${String(error)}`);
    return false;
  }
}

/** Resultado de reemplazar o quitar una foto: `filesComplete: false` = el archivo saliente quedó sin borrar (ya registrado). */
export type ImageOutcome = { filesComplete: boolean };

export type Swap =
  | { kind: "swapped"; previous: string | null }
  | { kind: "none" } // 0 filas: no existe en esta organización o la base lo bloqueó
  | { kind: "rejected"; error: NonNullable<PgError> } // la base lo rechazó y revirtió
  | { kind: "uncertain" }; // sin respuesta de la base: pudo haberse aplicado

/** Interpreta la respuesta de `replace_product_image` / `replace_organization_logo`. */
export function parseSwap(result: { data: unknown; error: { code?: string; message?: string } | null }): Swap {
  if (result.error) return isDbError(result.error) ? { kind: "rejected", error: result.error } : { kind: "uncertain" };
  const data = result.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { kind: "uncertain" };
  const { updated, previous } = data as { updated?: unknown; previous?: unknown };
  if (updated !== true) return { kind: "none" };
  return { kind: "swapped", previous: typeof previous === "string" ? previous : null };
}

/**
 * Cambia la foto de un plato (`path`) o la quita (`null`) con UNA llamada que bloquea la fila y devuelve la referencia que
 * dejó de usarse. El archivo saliente se borra por esa ruta exacta: con dos reemplazos simultáneos cada uno borra lo que
 * ÉL desplazó, nunca el vigente ni la subida del otro.
 */
async function swapProductImage(db: Db, orgId: string, productId: string, path: string | null): Promise<Swap> {
  // `p_path` admite NULL en la base (quita la foto); el tipo generado no distingue argumentos opcionales.
  return parseSwap(await db.rpc("replace_product_image", { p_org: orgId, p_product: productId, p_path: path as string }));
}

/**
 * Sube la foto de un plato y la deja como la vigente. Orden: validar → subir con nombre nuevo → apuntar el plato (devuelve la
 * foto anterior) → borrar esa anterior. Un fallo al apuntar borra la recién subida; un fallo al limpiar NO toca la foto vigente
 * y se informa como limpieza incompleta (`filesComplete: false`). Si la respuesta de la base no llega (no se sabe si apuntó),
 * NO se borra nada: se prefiere un archivo de más a dejar el plato apuntando a una foto inexistente.
 */
export async function setProductImage(db: Db, orgId: string, productId: string, file: File | null): Promise<Result<ImageOutcome>> {
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

  const swap = await swapProductImage(db, orgId, productId, path);
  if (swap.kind === "none") {
    await removeObject(db, path);
    return fail(await explainZeroRows(db, orgId, "products", productId));
  }
  if (swap.kind === "rejected") {
    await removeObject(db, path);
    return fail(await writeFailure(db, orgId, swap.error));
  }
  if (swap.kind === "uncertain") {
    // Pudo haberse aplicado: se mira el estado real. Solo se da por hecho (y se sigue) si el plato ya apunta a la foto nueva.
    const now = await loadProduct(db, orgId, productId).catch(() => null);
    if (now?.image_path === path) {
      console.error(`La foto ${path} quedó aplicada pero no se pudo saber cuál reemplazó: la anterior pudo quedar sin borrar.`);
      return ok({ filesComplete: false });
    }
    console.error(`No se pudo confirmar si la foto ${path} quedó aplicada: no se borra por las dudas.`);
    return fail("uncertain");
  }

  const outgoing = swap.previous;
  if (outgoing && outgoing !== path && isOwnImagePath(outgoing, orgId, productId)) {
    return ok({ filesComplete: await removeObject(db, outgoing) });
  }
  return ok({ filesComplete: true });
}

export async function removeProductImage(db: Db, orgId: string, productId: string): Promise<Result<ImageOutcome>> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const product = await loadProduct(db, orgId, productId);
  if (!product) return fail("not_found");

  // Siempre se escribe (aunque ya no tenga foto): así un cliente sin permiso no recibe un éxito vacío, y se borra la
  // referencia que de verdad estaba guardada al bloquear la fila, no la que se leyó antes.
  const swap = await swapProductImage(db, orgId, productId, null);
  if (swap.kind === "none") return fail(await explainZeroRows(db, orgId, "products", productId));
  if (swap.kind === "rejected") return fail(await writeFailure(db, orgId, swap.error));
  if (swap.kind === "uncertain") return fail("uncertain");

  if (swap.previous && isOwnImagePath(swap.previous, orgId, productId)) {
    return ok({ filesComplete: await removeObject(db, swap.previous) });
  }
  return ok({ filesComplete: true });
}

// ---------------------------------------------------------------------------
// Borrado (ficha borrado-de-categorias-y-platos)
// ---------------------------------------------------------------------------

/** Resultado de limpiar Storage tras un borrado: `filesComplete: false` = quedaron archivos sin borrar (ya registrados). */
export type DeleteOutcome = { filesComplete: boolean };

const FILES_PAGE = 100;
const FILES_PARALLEL = 8;
/** Filas por lectura (PostgREST corta en 1000): se pagina para no contar ni limpiar de menos. */
const ROWS_PAGE = 1000;

/**
 * Borra los archivos de `product-images/{org}/{plato}/` de platos que YA no existen: la ruta que tenían guardada y
 * cualquier otro archivo suelto de su carpeta. Nunca lanza; si algo falla o Storage descarta un borrado (cero objetos,
 * sin error) lo deja en el log con la organización y el plato y devuelve `false`.
 */
async function removeProductFolders(db: Db, orgId: string, products: { id: string; image_path: string | null }[]): Promise<boolean> {
  let complete = true;
  const bucket = db.storage.from(IMAGE_BUCKET);
  const warn = (productId: string, reason: string) => {
    complete = false;
    console.error(`Fotos sin borrar del plato ${productId} (organización ${orgId}) tras borrarlo: ${reason}`);
  };

  async function cleanOne(product: { id: string; image_path: string | null }) {
    try {
      const paths = new Set<string>();
      if (product.image_path && isOwnImagePath(product.image_path, orgId, product.id)) paths.add(product.image_path);

      for (let offset = 0; ; offset += FILES_PAGE) {
        const { data, error } = await bucket.list(`${orgId}/${product.id}`, { limit: FILES_PAGE, offset, sortBy: { column: "name", order: "asc" } });
        if (error) {
          warn(product.id, `no se pudo listar la carpeta: ${error.message}`);
          break;
        }
        for (const entry of data) if (entry.id) paths.add(`${orgId}/${product.id}/${entry.name}`);
        if (data.length < FILES_PAGE) break;
      }

      const all = [...paths];
      for (let i = 0; i < all.length; i += FILES_PAGE) {
        const chunk = all.slice(i, i + FILES_PAGE);
        const { data, error } = await bucket.remove(chunk);
        if (error) warn(product.id, error.message);
        else if (!data || data.length < chunk.length) warn(product.id, `Storage borró ${data?.length ?? 0} de ${chunk.length} objetos.`);
      }
    } catch (error) {
      warn(product.id, String(error));
    }
  }

  for (let i = 0; i < products.length; i += FILES_PARALLEL) {
    await Promise.all(products.slice(i, i + FILES_PARALLEL).map(cleanOne));
  }
  return complete;
}

/** Todos los platos de una categoría (id y foto), paginados. `null` si no se pudieron leer. */
async function productsOfCategory(db: Db, orgId: string, categoryId: string) {
  const rows: { id: string; image_path: string | null }[] = [];
  for (let from = 0; ; from += ROWS_PAGE) {
    const { data, error } = await db
      .from("products")
      .select("id, image_path")
      .eq("organization_id", orgId)
      .eq("category_id", categoryId)
      .order("id")
      .range(from, from + ROWS_PAGE - 1);
    if (error) return null;
    rows.push(...data);
    if (data.length < ROWS_PAGE) return rows;
  }
}

/**
 * Borra un plato y, solo después de confirmar el borrado, su foto y los archivos sueltos de su carpeta. Las variantes, los
 * adicionales y la disponibilidad se van por cascada; el historial de precios se conserva (ADR 0012).
 */
export async function deleteProduct(db: Db, orgId: string, id: string): Promise<Result<DeleteOutcome>> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const product = await loadProduct(db, orgId, id);
  if (!product) return fail("not_found");

  const { data, error } = await db.from("products").delete().eq("id", id).eq("organization_id", orgId).select("id");
  if (error) return fail(await writeFailure(db, orgId, error));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, "products", id));

  return ok({ filesComplete: await removeProductFolders(db, orgId, [product]) });
}

/**
 * Borra una categoría con todos sus platos. Solo borra lo que la persona vio: `expectedProducts` es la cantidad que se le
 * mostró (si cambió, no se borra) y, si tiene platos, `confirmName` tiene que ser el nombre exacto. Las fotos se limpian
 * después del borrado.
 */
export async function deleteCategory(
  db: Db,
  orgId: string,
  id: string,
  confirmation: { expectedProducts: number; confirmName: string },
): Promise<Result<DeleteOutcome & { products: number }>> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const category = await db.from("categories").select("id, name").eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (category.error) return fail("unexpected");
  if (!category.data) return fail("not_found");

  const products = await productsOfCategory(db, orgId, id);
  if (!products) return fail("unexpected");
  if (products.length !== confirmation.expectedProducts) return fail("category_changed");
  if (products.length > 0 && confirmation.confirmName.trim() !== category.data.name) return fail("confirm_mismatch");

  const { data, error } = await db.from("categories").delete().eq("id", id).eq("organization_id", orgId).select("id");
  if (error) return fail(await writeFailure(db, orgId, error));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, "categories", id));

  // Entre la lectura y el borrado otra persona pudo mover un plato a otra categoría: ese sobrevive y NO se le tocan los archivos.
  const gone = await productsGone(db, orgId, products);
  if (!gone) {
    console.error(`Fotos sin borrar de la categoría ${id} (organización ${orgId}): no se pudo comprobar qué platos se borraron.`);
    return ok({ products: products.length, filesComplete: false });
  }
  return ok({ products: products.length, filesComplete: await removeProductFolders(db, orgId, gone) });
}

/** De los platos dados, los que ya no existen en la organización. `null` si no se pudo comprobar (ante la duda no se borra nada). */
async function productsGone<T extends { id: string }>(db: Db, orgId: string, products: T[]): Promise<T[] | null> {
  const alive = new Set<string>();
  for (let i = 0; i < products.length; i += FILES_PAGE) {
    const ids = products.slice(i, i + FILES_PAGE).map((product) => product.id);
    const { data, error } = await db.from("products").select("id").eq("organization_id", orgId).in("id", ids);
    if (error) return null;
    for (const row of data) alive.add(row.id);
  }
  return products.filter((product) => !alive.has(product.id));
}
