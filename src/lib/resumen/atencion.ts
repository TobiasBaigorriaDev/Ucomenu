import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Pendientes del Resumen del panel (ficha resumen-del-panel): cosas que esperan una decisión de una persona y a dónde ir a
 * resolverlas. `buildAttention` es pura (se prueba en `atencion.test.ts`); las lecturas usan la sesión de la persona (RLS) y
 * filtran por organización. Cada lectura es independiente: una que falla es `null` y el pendiente simplemente no se afirma.
 */

type Db = SupabaseClient<Database>;

export type AttentionItem = {
  id: "comentarios" | "agotados" | "plan";
  text: string;
  href: string;
  cta: string;
};

export type AttentionUsage = { label: string; used: number; limit: number };

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Desde qué fracción del tope se avisa (el 90 %): avisar tarde no deja tiempo, avisar siempre es ruido. */
export const NEAR_LIMIT = 0.9;

/**
 * Los pendientes, en orden de urgencia. `null` en un dato = no se pudo leer o no corresponde: ese pendiente no se muestra.
 * `usage` solo lo recibe el Dueño (el Personal no ve planes ni límites).
 */
export function buildAttention(input: {
  slug: string;
  pendingComments: number | null;
  soldOutProducts: number | null;
  usage: readonly AttentionUsage[] | null;
}): AttentionItem[] {
  const base = `/panel/${input.slug}`;
  const items: AttentionItem[] = [];
  if (input.pendingComments !== null && input.pendingComments > 0) {
    items.push({
      id: "comentarios",
      text: `${plural(input.pendingComments, "comentario espera", "comentarios esperan")} tu aprobación. No se ven en la carta hasta entonces.`,
      href: `${base}/comentarios`,
      cta: "Revisar comentarios",
    });
  }
  if (input.soldOutProducts !== null && input.soldOutProducts > 0) {
    items.push({
      id: "agotados",
      text: `${plural(input.soldOutProducts, "plato figura agotado", "platos figuran agotados")} en alguna sucursal. Si ya hay stock, volvé a habilitarlos.`,
      href: `${base}/carta`,
      cta: "Revisar platos",
    });
  }
  for (const resource of input.usage ?? []) {
    if (resource.limit <= 0 || resource.used < resource.limit * NEAR_LIMIT) continue;
    items.push({
      id: "plan",
      text:
        resource.used >= resource.limit
          ? `${resource.label}: llegaste al tope del plan (${resource.used} de ${resource.limit}).`
          : `${resource.label}: ${resource.used} de ${resource.limit}, cerca del tope del plan.`,
      href: `${base}/suscripcion`,
      cta: "Ver el plan",
    });
  }
  return items;
}

/** Comentarios del feed por revisar, o `null` si no se pudo leer. */
export async function loadPendingComments(db: Db, orgId: string): Promise<number | null> {
  const { count, error } = await db
    .from("video_comments")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("status", "pending");
  return error ? null : (count ?? 0);
}

/**
 * Platos ACTIVOS agotados en al menos una sucursal ACTIVA (cuenta cada plato una vez), o `null` si no se pudo leer. Por clave
 * compuesta: PostgREST corta cada lectura en 1000 filas sin avisar.
 */
export async function loadSoldOutProducts(db: Db, orgId: string): Promise<number | null> {
  const ids = new Set<string>();
  let after: { product_id: string; branch_id: string } | null = null;
  for (;;) {
    let query = db
      .from("product_availability")
      .select("product_id, branch_id, branches!inner(is_active), products!inner(is_active)")
      .eq("organization_id", orgId)
      .eq("is_available", false)
      .eq("branches.is_active", true)
      .eq("products.is_active", true);
    if (after) query = query.gte("product_id", after.product_id);
    const { data, error } = await query.order("product_id").order("branch_id").limit(1000);
    if (error) return null;
    const fresh: typeof data = after
      ? data.filter((row) => row.product_id > after!.product_id || (row.product_id === after!.product_id && row.branch_id > after!.branch_id))
      : data;
    for (const row of fresh) ids.add(row.product_id);
    if (data.length < 1000 || fresh.length === 0) break;
    after = { product_id: data[data.length - 1].product_id, branch_id: data[data.length - 1].branch_id };
  }
  return ids.size;
}
