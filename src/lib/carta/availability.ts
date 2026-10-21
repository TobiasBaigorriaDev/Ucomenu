import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { readAllByKey, readAllPages } from "@/lib/paginar";
import { fail, guard, loadProduct, ok, writeFailure, type Result } from "./catalog";

/**
 * Ajustes de UNA sucursal sobre un plato del catálogo central (ADR 0035): agotado, oculto y precio propio. Cada ajuste es
 * opcional: sin fila (o con los valores por defecto) el plato es visible, disponible y tiene el precio base. Las tres cosas
 * viven en `product_availability` y se escriben por separado, cada una con su estado deseado explícito.
 */

type Db = SupabaseClient<Database>;

export type BranchAvailability = {
  id: string;
  name: string;
  is_available: boolean;
  is_visible: boolean;
  /** Precio propio de la sucursal en centavos; `null` = hereda el precio base (0 es un precio). */
  price_cents: number | null;
};

export async function loadProductAvailability(db: Db, orgId: string, productId: string): Promise<BranchAvailability[]> {
  const [branches, states] = await Promise.all([
    readAllPages((from, to) => db.from("branches").select("id, name").eq("organization_id", orgId).eq("is_active", true).order("id").range(from, to)),
    readAllPages((from, to) =>
      db.from("product_availability").select("branch_id, is_available, is_visible, price_cents").eq("organization_id", orgId).eq("product_id", productId).order("branch_id").range(from, to),
    ),
  ]);
  if (branches.error || states.error) throw new Error("No se pudo leer la disponibilidad por sucursal.");
  const byBranch = new Map(states.data?.map((state) => [state.branch_id, state]));
  return (branches.data ?? [])
    .map((branch) => {
      const state = byBranch.get(branch.id);
      return {
        ...branch,
        is_available: state?.is_available ?? true,
        is_visible: state?.is_visible ?? true,
        price_cents: state?.price_cents ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es-AR", { numeric: true }));
}

// ---------------------------------------------------------------------------
// Lectura para la carta pública
// ---------------------------------------------------------------------------

export type BranchProductSetting = { isAvailable: boolean; isVisible: boolean; priceCents: number | null };

/**
 * Los ajustes de una sucursal que se apartan de lo normal (agotado, oculto o con precio propio), por plato. Se lee EN VIVO en cada
 * pedido de la carta (no entra en la caché del catálogo, que es de toda la organización) y por clave (`product_id`): una baja
 * o un alta mientras se lee no salta filas. Un fallo de lectura lanza: nunca se interpreta como «sin ajustes» (se publicarían
 * platos ocultos y precios equivocados).
 */
export async function loadBranchSettings(db: Db, orgId: string, branchId: string): Promise<Map<string, BranchProductSetting>> {
  const result = await readAllByKey((after, limit) => {
    const query = db
      .from("product_availability")
      .select("id:product_id, is_available, is_visible, price_cents")
      .eq("organization_id", orgId)
      .eq("branch_id", branchId)
      .or("is_available.eq.false,is_visible.eq.false,price_cents.not.is.null");
    return (after ? query.gt("product_id", after) : query).order("product_id").limit(limit);
  });
  if (result.error) throw new Error("No se pudieron leer los ajustes de la sucursal de la carta.");
  return new Map(
    (result.data ?? []).map((row) => [row.id, { isAvailable: row.is_available, isVisible: row.is_visible, priceCents: row.price_cents }]),
  );
}

/**
 * Aplica los ajustes de la sucursal a los platos del catálogo (que ya vienen filtrados a lo publicable): quita los ocultos, pone el
 * precio propio (cero incluido) y marca los agotados. Sin ajuste, el plato queda con su precio base y disponible. Función pura.
 */
export function applyBranchSettings<P extends { id: string; price_cents: number }>(
  products: readonly P[],
  settings: ReadonlyMap<string, BranchProductSetting>,
): (P & { is_available: boolean })[] {
  return products.flatMap((product) => {
    const setting = settings.get(product.id);
    if (!setting) return [{ ...product, is_available: true }];
    if (!setting.isVisible) return [];
    return [{ ...product, price_cents: setting.priceCents ?? product.price_cents, is_available: setting.isAvailable }];
  });
}

// ---------------------------------------------------------------------------
// Resumen para el listado del panel
// ---------------------------------------------------------------------------

export type SettingsSummary = { hidden: number; priced: number; soldOut: number };

/**
 * Cuántas sucursales ACTIVAS tienen cada ajuste, por plato (solo los que tienen alguno). Por clave compuesta
 * (`product_id`, `branch_id`): una fila nunca se salta ni se repite si algo cambia mientras se lee.
 */
export async function loadSettingsSummary(db: Db, orgId: string): Promise<Map<string, SettingsSummary>> {
  const rows: { product_id: string; branch_id: string; is_available: boolean; is_visible: boolean; price_cents: number | null }[] = [];
  let after: { product_id: string; branch_id: string } | null = null;
  for (;;) {
    let query = db
      .from("product_availability")
      .select("product_id, branch_id, is_available, is_visible, price_cents, branches!inner(is_active)")
      .eq("organization_id", orgId)
      .eq("branches.is_active", true)
      .or("is_available.eq.false,is_visible.eq.false,price_cents.not.is.null");
    // Se pide desde el plato del cursor (`gte`) y se descartan en memoria las filas ya leídas: así el filtro de arriba (un solo `or`)
    // no se mezcla con el del cursor. Un plato tiene a lo sumo una fila por sucursal, muy por debajo de la página.
    if (after) query = query.gte("product_id", after.product_id);
    const { data, error } = await query.order("product_id").order("branch_id").limit(1000);
    if (error) throw new Error("No se pudo leer el resumen de ajustes por sucursal.");
    const fresh: typeof rows = after
      ? data.filter((row) => row.product_id > after!.product_id || (row.product_id === after!.product_id && row.branch_id > after!.branch_id))
      : data;
    rows.push(...fresh);
    if (data.length < 1000 || fresh.length === 0) break;
    after = { product_id: data[data.length - 1].product_id, branch_id: data[data.length - 1].branch_id };
  }
  const summary = new Map<string, SettingsSummary>();
  for (const row of rows) {
    const entry = summary.get(row.product_id) ?? { hidden: 0, priced: 0, soldOut: 0 };
    if (!row.is_visible) entry.hidden += 1;
    if (row.price_cents !== null) entry.priced += 1;
    if (!row.is_available) entry.soldOut += 1;
    summary.set(row.product_id, entry);
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

type SettingPatch = { is_available?: boolean; is_visible?: boolean; price_cents?: number | null };

/**
 * Escribe SOLO las columnas pedidas, con su estado deseado explícito (dos personas o reintentos nunca alternan a ciegas), sin
 * elevar privilegios: la RLS exige miembro de la organización y cuenta editable. Las claves no se pueden actualizar, por eso es
 * UPDATE y, si no había fila, INSERT (y de nuevo UPDATE si otra petición la creó entre medio).
 */
async function writeSetting(db: Db, orgId: string, productId: string, branchId: string, patch: SettingPatch): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);
  const [product, branch] = await Promise.all([
    loadProduct(db, orgId, productId),
    db.from("branches").select("id").eq("organization_id", orgId).eq("id", branchId).maybeSingle(),
  ]);
  if (!product || !branch.data || branch.error) return fail("not_found");

  const columns = "is_available, is_visible, price_cents";
  const matches = (row: { is_available: boolean; is_visible: boolean; price_cents: number | null }) =>
    (Object.keys(patch) as (keyof SettingPatch)[]).every((key) => row[key] === patch[key]);

  const update = () =>
    db.from("product_availability").update(patch).eq("organization_id", orgId).eq("product_id", productId).eq("branch_id", branchId).select(columns);
  const changed = await update();
  if (changed.error) return fail(await writeFailure(db, orgId, changed.error));
  if (changed.data.length) return matches(changed.data[0]) ? ok(undefined) : fail("unexpected");

  const inserted = await db
    .from("product_availability")
    .insert({ organization_id: orgId, branch_id: branchId, product_id: productId, ...patch })
    .select(columns);
  // Otra petición pudo crear la fila después del UPDATE. Se escribe el estado deseado, sin cambiar claves.
  if (inserted.error?.code === "23505") {
    const retried = await update();
    if (retried.error) return fail(await writeFailure(db, orgId, retried.error));
    if (retried.data.length && matches(retried.data[0])) return ok(undefined);
    return fail((await guard(db, orgId)) ?? "unexpected");
  }
  if (inserted.error) return fail(await writeFailure(db, orgId, inserted.error));
  return inserted.data.length && matches(inserted.data[0]) ? ok(undefined) : fail("unexpected");
}

export const setProductAvailability = (db: Db, orgId: string, productId: string, branchId: string, available: boolean) =>
  writeSetting(db, orgId, productId, branchId, { is_available: available });

/** `false` = el plato no aparece en la carta de esa sucursal (listado, búsqueda ni detalle). */
export const setProductVisibility = (db: Db, orgId: string, productId: string, branchId: string, visible: boolean) =>
  writeSetting(db, orgId, productId, branchId, { is_visible: visible });

/** Precio propio de la sucursal en centavos; `null` = «usar el precio general» (0 es un precio). */
export const setProductBranchPrice = (db: Db, orgId: string, productId: string, branchId: string, priceCents: number | null) =>
  writeSetting(db, orgId, productId, branchId, { price_cents: priceCents });
