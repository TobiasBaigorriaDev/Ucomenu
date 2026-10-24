import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entitlements } from "@/lib/entitlements";
import { readAllPages } from "@/lib/paginar";
import type { Database } from "@/lib/supabase/database.types";
import { promocionesErrorMessage, promocionesWriteBlock, type PromocionesError } from "./mensajes";
import type { DiscountType } from "./precio";
import { PROMOTION_NAME_MAX, findOverlaps, type OverlapSubject, type PromotionInput } from "./reglas";

/**
 * Promociones del local (ficha panel-de-promociones). Todo con el cliente de la PERSONA (rol `authenticated`, RLS): quién puede
 * escribir (solo el Dueño), que la cuenta esté al día y que el plan incluya la función viven en la base
 * (`private.can_manage_promotions`). Este módulo los muestra con mensajes claros y no da por hecho un guardado que la base
 * descartó: un UPDATE o DELETE bloqueado por RLS afecta 0 filas SIN error, así que toda escritura pide las filas de vuelta.
 */

type Db = SupabaseClient<Database>;

export type Result<T = void> = { ok: true; data: T } | { ok: false; error: PromocionesError };

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: PromocionesError): Result<never> => ({ ok: false, error });

export { promocionesErrorMessage };
export type { PromocionesError };

const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
const INSUFFICIENT_PRIVILEGE = "42501";
const NO_DATA = "P0002";
const NUMERIC_OUT_OF_RANGE = "22003";

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export type PromotionView = {
  id: string;
  name: string;
  discountType: DiscountType;
  discountValue: number;
  weekdaysMask: number;
  startMinute: number;
  endMinute: number;
  startsOn: string | null;
  endsOn: string | null;
  allBranches: boolean;
  isActive: boolean;
  branchIds: string[];
  productIds: string[];
  categoryIds: string[];
};

export type CatalogView = {
  categories: { id: string; name: string }[];
  products: { id: string; name: string; categoryId: string; isActive: boolean }[];
  branches: { id: string; slug: string; name: string; timeZone: string }[];
};

export type PromotionsScreen = {
  promotions: PromotionView[];
  catalog: CatalogView;
  /** Para cada promoción, los nombres de las activas que se le superponen. */
  overlaps: Map<string, string[]>;
};

const collator = new Intl.Collator("es-AR", { numeric: true, sensitivity: "base" });

/** El catálogo que se ofrece para elegir (categorías, platos y sucursales activas), en orden natural. */
export async function loadCatalog(db: Db, orgId: string): Promise<CatalogView> {
  const [categories, products, branches] = await Promise.all([
    readAllPages((from, to) => db.from("categories").select("id, name").eq("organization_id", orgId).order("id").range(from, to)),
    readAllPages((from, to) => db.from("products").select("id, name, category_id, is_active").eq("organization_id", orgId).order("id").range(from, to)),
    readAllPages((from, to) =>
      db.from("branches").select("id, slug, name, timezone").eq("organization_id", orgId).eq("is_active", true).order("id").range(from, to),
    ),
  ]);
  if (categories.error) throw new Error(`No se pudieron leer las categorías: ${categories.error.message}`);
  if (products.error) throw new Error(`No se pudieron leer los platos: ${products.error.message}`);
  if (branches.error) throw new Error(`No se pudieron leer las sucursales: ${branches.error.message}`);
  return {
    categories: (categories.data ?? []).sort((a, b) => collator.compare(a.name, b.name)),
    products: (products.data ?? [])
      .map((p) => ({ id: p.id, name: p.name, categoryId: p.category_id, isActive: p.is_active }))
      .sort((a, b) => collator.compare(a.name, b.name)),
    branches: (branches.data ?? [])
      .map((b) => ({ id: b.id, slug: b.slug, name: b.name, timeZone: b.timezone }))
      .sort((a, b) => collator.compare(a.name, b.name)),
  };
}

/** Todas las promociones de la organización, con sus platos, categorías y sucursales. */
export async function loadPromotions(db: Db, orgId: string): Promise<PromotionView[]> {
  const [promotions, targets, branches] = await Promise.all([
    readAllPages((from, to) => db.from("promotions").select("*").eq("organization_id", orgId).order("id").range(from, to)),
    readAllPages((from, to) =>
      db.from("promotion_targets").select("id, promotion_id, product_id, category_id").eq("organization_id", orgId).order("id").range(from, to),
    ),
    readAllPages((from, to) =>
      db.from("promotion_branches").select("promotion_id, branch_id").eq("organization_id", orgId).order("promotion_id").order("branch_id").range(from, to),
    ),
  ]);
  if (promotions.error) throw new Error(`No se pudieron leer las promociones: ${promotions.error.message}`);
  if (targets.error) throw new Error(`No se pudieron leer los platos de las promociones: ${targets.error.message}`);
  if (branches.error) throw new Error(`No se pudieron leer las sucursales de las promociones: ${branches.error.message}`);

  const byPromotion = <T extends { promotion_id: string }>(rows: T[] | null) => {
    const map = new Map<string, T[]>();
    for (const row of rows ?? []) map.set(row.promotion_id, [...(map.get(row.promotion_id) ?? []), row]);
    return map;
  };
  const targetsOf = byPromotion(targets.data);
  const branchesOf = byPromotion(branches.data);

  return (promotions.data ?? [])
    .map((p): PromotionView => ({
      id: p.id,
      name: p.name,
      discountType: p.discount_type as DiscountType,
      discountValue: p.discount_value,
      weekdaysMask: p.weekdays_mask,
      startMinute: p.start_minute,
      endMinute: p.end_minute,
      startsOn: p.starts_on,
      endsOn: p.ends_on,
      allBranches: p.all_branches,
      isActive: p.is_active,
      branchIds: (branchesOf.get(p.id) ?? []).map((b) => b.branch_id),
      productIds: (targetsOf.get(p.id) ?? []).flatMap((t) => (t.product_id ? [t.product_id] : [])),
      categoryIds: (targetsOf.get(p.id) ?? []).flatMap((t) => (t.category_id ? [t.category_id] : [])),
    }))
    .sort((a, b) => collator.compare(a.name, b.name));
}

/** Resuelve las categorías de cada promoción a platos y calcula quién se superpone con quién. */
export function overlapsOf(promotions: readonly PromotionView[], catalog: CatalogView): Map<string, string[]> {
  const productsOfCategory = new Map<string, string[]>();
  for (const product of catalog.products) {
    productsOfCategory.set(product.categoryId, [...(productsOfCategory.get(product.categoryId) ?? []), product.id]);
  }
  const subjects: OverlapSubject[] = promotions.map((p) => ({
    id: p.id,
    name: p.name,
    isActive: p.isActive,
    weekdaysMask: p.weekdaysMask,
    startMinute: p.startMinute,
    endMinute: p.endMinute,
    startsOn: p.startsOn,
    endsOn: p.endsOn,
    allBranches: p.allBranches,
    branchIds: new Set(p.branchIds),
    productIds: new Set([...p.productIds, ...p.categoryIds.flatMap((id) => productsOfCategory.get(id) ?? [])]),
  }));
  return new Map([...findOverlaps(subjects)].map(([id, others]) => [id, others.map((o) => o.name)]));
}

export async function loadPromotionsScreen(db: Db, orgId: string): Promise<PromotionsScreen> {
  const [promotions, catalog] = await Promise.all([loadPromotions(db, orgId), loadCatalog(db, orgId)]);
  return { promotions, catalog, overlaps: overlapsOf(promotions, catalog) };
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

/** Traduce el error de una escritura. El RLS rechazado (42501) se explica con el estado de la cuenta si lo hay. */
function writeFailure(error: { code?: string }, ent: Entitlements | null): PromocionesError {
  switch (error.code) {
    case CHECK_VIOLATION:
    case NUMERIC_OUT_OF_RANGE:
      return "values_rejected";
    case FOREIGN_KEY_VIOLATION:
      return "foreign_object";
    case NO_DATA:
      return "not_found";
    case INSUFFICIENT_PRIVILEGE:
      return promocionesWriteBlock(ent) ?? "forbidden";
    default:
      return "unexpected";
  }
}

/**
 * Crea (`id` nulo) o edita una promoción con sus platos, categorías y sucursales, en una sola transacción (`save_promotion`).
 * Solo el Dueño con la cuenta al día y la función en el plan: lo imponen las políticas de las tablas.
 */
export async function savePromotion(db: Db, orgId: string, id: string | null, input: PromotionInput, ent: Entitlements | null): Promise<Result<{ id: string }>> {
  const blocked = promocionesWriteBlock(ent);
  if (blocked) return fail(blocked);

  const { data, error } = await db.rpc("save_promotion", {
    p_org: orgId,
    p_id: id as string,
    p_name: input.name,
    p_discount_type: input.discountType,
    p_discount_value: input.discountValue,
    p_weekdays_mask: input.weekdaysMask,
    p_start_minute: input.startMinute,
    p_end_minute: input.endMinute,
    p_starts_on: input.startsOn as string,
    p_ends_on: input.endsOn as string,
    p_all_branches: input.allBranches,
    p_is_active: input.isActive,
    p_products: input.productIds,
    p_categories: input.categoryIds,
    p_branches: input.branchIds,
  });
  if (error) return fail(writeFailure(error, ent));
  return ok({ id: data });
}

/** Pausa o reanuda una promoción (no se borra). */
export async function setPromotionActive(db: Db, orgId: string, id: string, active: boolean, ent: Entitlements | null): Promise<Result> {
  const blocked = promocionesWriteBlock(ent);
  if (blocked) return fail(blocked);
  const { data, error } = await db.from("promotions").update({ is_active: active }).eq("id", id).eq("organization_id", orgId).select("id, is_active");
  if (error) return fail(writeFailure(error, ent));
  if (data.length === 0) return fail(await missingOrForbidden(db, orgId, id));
  return data[0].is_active === active ? ok(undefined) : fail("unexpected");
}

/** Borra una promoción (su historial se conserva). */
export async function deletePromotion(db: Db, orgId: string, id: string, ent: Entitlements | null): Promise<Result> {
  const blocked = promocionesWriteBlock(ent);
  if (blocked) return fail(blocked);
  const { data, error } = await db.from("promotions").delete().eq("id", id).eq("organization_id", orgId).select("id");
  if (error) return fail(writeFailure(error, ent));
  if (data.length === 0) return fail(await missingOrForbidden(db, orgId, id));
  return ok(undefined);
}

/** Una copia pausada con los mismos platos, sucursales y horario: así no duplica el descuento hasta que se la revise y se la active. */
export async function duplicatePromotion(db: Db, orgId: string, id: string, ent: Entitlements | null): Promise<Result<{ id: string }>> {
  const blocked = promocionesWriteBlock(ent);
  if (blocked) return fail(blocked);
  const original = (await loadPromotions(db, orgId)).find((p) => p.id === id);
  if (!original) return fail("not_found");
  const suffix = " (copia)";
  const name = `${[...original.name].slice(0, PROMOTION_NAME_MAX - suffix.length).join("").trimEnd()}${suffix}`;
  return savePromotion(
    db,
    orgId,
    null,
    {
      name,
      discountType: original.discountType,
      discountValue: original.discountValue,
      weekdaysMask: original.weekdaysMask,
      startMinute: original.startMinute,
      endMinute: original.endMinute,
      startsOn: original.startsOn,
      endsOn: original.endsOn,
      allBranches: original.allBranches,
      branchIds: original.branchIds,
      productIds: original.productIds,
      categoryIds: original.categoryIds,
      isActive: false,
    },
    ent,
  );
}

/** 0 filas: o la promoción no es de esta organización / ya no existe, o la base la bloqueó (rol, plan o cuenta). Se distingue leyendo. */
async function missingOrForbidden(db: Db, orgId: string, id: string): Promise<PromocionesError> {
  const exists = await db.from("promotions").select("id").eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (exists.error) return "unexpected";
  return exists.data ? "forbidden" : "not_found";
}

// ---------------------------------------------------------------------------
// Vista previa por día y hora
// ---------------------------------------------------------------------------

export type PreviewRow = {
  productId: string;
  productName: string;
  basePriceCents: number;
  priceCents: number;
  promotionName: string;
  discountType: DiscountType;
  endsLocal: string;
};

/**
 * Qué platos tienen promoción en una sucursal en un instante dado, con el precio que tendrían: la misma `effective_prices` que usa la
 * carta, con el instante pedido (la base solo lo respeta a un miembro). Lanza si la lectura falla: nunca se muestra «sin promociones»
 * por un error.
 */
export async function previewPrices(db: Db, orgId: string, branchId: string, at: Date): Promise<PreviewRow[]> {
  const { data, error } = await db.rpc("effective_prices", { p_branch: branchId, p_product: undefined, p_at: at.toISOString() });
  if (error) throw new Error(`No se pudo calcular la vista previa: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const names = await readAllPages((from, to) => db.from("products").select("id, name").eq("organization_id", orgId).order("id").range(from, to));
  if (names.error) throw new Error(`No se pudieron leer los platos: ${names.error.message}`);
  const nameOf = new Map((names.data ?? []).map((p) => [p.id, p.name]));
  return rows
    .flatMap((row) =>
      row.promotion_id && row.promotion_name && row.ends_local
        ? [
            {
              productId: row.product_id,
              productName: nameOf.get(row.product_id) ?? "Plato",
              basePriceCents: row.base_price_cents,
              priceCents: row.price_cents,
              promotionName: row.promotion_name,
              discountType: row.discount_type as DiscountType,
              endsLocal: row.ends_local,
            },
          ]
        : [],
    )
    .sort((a, b) => collator.compare(a.productName, b.productName));
}
