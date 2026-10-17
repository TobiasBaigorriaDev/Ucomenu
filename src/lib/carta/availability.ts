import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { readAllPages } from "@/lib/paginar";
import { fail, guard, loadProduct, ok, writeFailure, type Result } from "./catalog";

type Db = SupabaseClient<Database>;
export type BranchAvailability = { id: string; name: string; is_available: boolean };

export async function loadProductAvailability(db: Db, orgId: string, productId: string): Promise<BranchAvailability[]> {
  const [branches, states] = await Promise.all([
    readAllPages((from, to) => db.from("branches").select("id, name").eq("organization_id", orgId).order("id").range(from, to)),
    readAllPages((from, to) => db.from("product_availability").select("branch_id, is_available").eq("organization_id", orgId).eq("product_id", productId).order("branch_id").range(from, to)),
  ]);
  if (branches.error || states.error) throw new Error("No se pudo leer la disponibilidad por sucursal.");
  const byBranch = new Map(states.data?.map((state) => [state.branch_id, state.is_available]));
  return (branches.data ?? []).map((branch) => ({ ...branch, is_available: byBranch.get(branch.id) ?? true }))
    .sort((a, b) => a.name.localeCompare(b.name, "es-AR", { numeric: true }));
}

/** Lee en vivo, fuera de la caché de catálogo compartida por todas las sucursales. */
export async function loadSoldOutProducts(db: Db, orgId: string, branchId: string): Promise<Set<string>> {
  const result = await readAllPages((from, to) => db.from("product_availability")
    .select("product_id").eq("organization_id", orgId).eq("branch_id", branchId).eq("is_available", false)
    .order("product_id").range(from, to));
  if (result.error) throw new Error("No se pudo leer la disponibilidad de la carta.");
  return new Set(result.data?.map((row) => row.product_id));
}

/** Estado deseado explícito: dos personas/reintentos nunca alternan a ciegas. Sin elevar privilegios. */
export async function setProductAvailability(db: Db, orgId: string, productId: string, branchId: string, available: boolean): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);
  const [product, branch] = await Promise.all([
    loadProduct(db, orgId, productId),
    db.from("branches").select("id").eq("organization_id", orgId).eq("id", branchId).maybeSingle(),
  ]);
  if (!product || !branch.data || branch.error) return fail("not_found");

  const update = () => db.from("product_availability").update({ is_available: available })
    .eq("organization_id", orgId).eq("product_id", productId).eq("branch_id", branchId).select("is_available");
  const changed = await update();
  if (changed.error) return fail(await writeFailure(db, orgId, changed.error));
  if (changed.data.length) return changed.data[0].is_available === available ? ok(undefined) : fail("unexpected");

  const inserted = await db.from("product_availability")
    .insert({ organization_id: orgId, branch_id: branchId, product_id: productId, is_available: available }).select("is_available");
  // Otra petición pudo crear la fila después del UPDATE. Se escribe el estado deseado, sin cambiar claves.
  if (inserted.error?.code === "23505") {
    const retried = await update();
    if (retried.error) return fail(await writeFailure(db, orgId, retried.error));
    if (retried.data.length && retried.data[0].is_available === available) return ok(undefined);
    return fail((await guard(db, orgId)) ?? "unexpected");
  }
  if (inserted.error) return fail(await writeFailure(db, orgId, inserted.error));
  return inserted.data.length && inserted.data[0].is_available === available ? ok(undefined) : fail("unexpected");
}
