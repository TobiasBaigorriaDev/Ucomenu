import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGE_SIZE, encodeCursor, parseCursor, type Cursor } from "@/lib/precios/historial";
import type { Database } from "@/lib/supabase/database.types";
import type { DiscountType } from "./precio";
import { datesLabel, daysLabel, discountLabel, windowLabel } from "./reglas";

/**
 * Historial de las promociones (ficha historial-de-promociones, ADR 0040). Se lee con el cliente de la PERSONA (RLS: miembros de la
 * organización). `promotion_history` no tiene clave foránea a la promoción ni a la persona (sobrevive a la baja de las dos), así que el
 * nombre sale de la constancia misma y el plato, la categoría o la sucursal se resuelven aparte, tolerando que ya no existan.
 */

type Db = SupabaseClient<Database>;

export { PAGE_SIZE, parseCursor };
export type { Cursor };

export type PromotionEvent = "created" | "updated" | "deleted" | "target_added" | "target_removed" | "branch_added" | "branch_removed";

export type HistoryEntry = {
  id: string;
  promotionId: string;
  event: PromotionEvent;
  changedBy: string | null;
  changedAt: string;
  snapshot: Record<string, unknown>;
};

export type HistoryPage = { entries: HistoryEntry[]; next: string | null };

/** Una página del historial de una organización, del más nuevo al más viejo. `null` si la base falló (no un «sin cambios» falso). */
export async function loadPromotionHistory(db: Db, orgId: string, cursor: Cursor | null): Promise<HistoryPage | null> {
  let query = db
    .from("promotion_history")
    .select("id, promotion_id, event, changed_by, changed_at, snapshot")
    .eq("organization_id", orgId)
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (cursor) query = query.or(`changed_at.lt.${cursor.changedAt},and(changed_at.eq.${cursor.changedAt},id.lt.${cursor.id})`);
  const { data, error } = await query;
  if (error || !data) return null;
  const entries = data.slice(0, PAGE_SIZE).map(
    (row): HistoryEntry => ({
      id: row.id,
      promotionId: row.promotion_id,
      event: row.event as PromotionEvent,
      changedBy: row.changed_by,
      changedAt: row.changed_at,
      snapshot: row.snapshot && typeof row.snapshot === "object" && !Array.isArray(row.snapshot) ? (row.snapshot as Record<string, unknown>) : {},
    }),
  );
  const next = data.length > PAGE_SIZE && entries.length > 0 ? encodeCursor(entries[entries.length - 1]) : null;
  return { entries, next };
}

/**
 * El nombre con que se conoció cada promoción: el de su constancia más reciente de alta, cambio o baja. Las que ya no existen
 * conservan el nombre que tenían. Una promoción sin constancia de esas (no debería pasar) figura como «Promoción».
 */
export async function loadPromotionNames(db: Db, orgId: string, promotionIds: string[]): Promise<Map<string, string> | null> {
  const ids = [...new Set(promotionIds)];
  if (ids.length === 0) return new Map();
  const { data, error } = await db
    .from("promotion_history")
    .select("promotion_id, snapshot")
    .eq("organization_id", orgId)
    .in("promotion_id", ids)
    .in("event", ["created", "updated", "deleted"])
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false });
  if (error || !data) return null;
  const names = new Map<string, string>();
  for (const row of data) {
    if (names.has(row.promotion_id)) continue;
    const name = (row.snapshot as Record<string, unknown> | null)?.name;
    if (typeof name === "string") names.set(row.promotion_id, name);
  }
  return names;
}

export type NameLookups = {
  products: ReadonlyMap<string, string>;
  categories: ReadonlyMap<string, string>;
  branches: ReadonlyMap<string, string>;
};

/** Platos, categorías y sucursales de ESTE local que aparecen en las constancias. `null` si la base falló. */
export async function loadNameLookups(db: Db, orgId: string, entries: readonly HistoryEntry[]): Promise<NameLookups | null> {
  const productIds = new Set<string>();
  const categoryIds = new Set<string>();
  const branchIds = new Set<string>();
  const take = (set: Set<string>, value: unknown) => {
    if (typeof value === "string") set.add(value);
  };
  for (const entry of entries) {
    take(productIds, entry.snapshot.product_id);
    take(categoryIds, entry.snapshot.category_id);
    take(branchIds, entry.snapshot.branch_id);
  }
  const read = async (table: "products" | "categories" | "branches", ids: Set<string>) => {
    if (ids.size === 0) return new Map<string, string>();
    const { data, error } = await db.from(table).select("id, name").eq("organization_id", orgId).in("id", [...ids]);
    if (error || !data) return null;
    return new Map(data.map((row) => [row.id, row.name]));
  };
  const [products, categories, branches] = await Promise.all([read("products", productIds), read("categories", categoryIds), read("branches", branchIds)]);
  return products && categories && branches ? { products, categories, branches } : null;
}

function arrayOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : [];
}

// ---------------------------------------------------------------------------
// En palabras (puro)
// ---------------------------------------------------------------------------

export const EVENT_LABEL: Record<PromotionEvent, string> = {
  created: "Se creó",
  updated: "Se cambió",
  deleted: "Se borró",
  target_added: "Se sumó un plato o categoría",
  target_removed: "Se quitó un plato o categoría",
  branch_added: "Se sumó una sucursal",
  branch_removed: "Se quitó una sucursal",
};

const DISCOUNT_TYPES: readonly string[] = ["percent", "amount", "fixed_price"];

/** El descuento, el horario y el estado que dice una constancia de la promoción misma. `null` si la constancia no trae esos datos. */
export function describePromotionSnapshot(snapshot: Record<string, unknown>): string | null {
  const { discount_type: type, discount_value: value, weekdays_mask: mask, start_minute: start, end_minute: end } = snapshot;
  if (typeof type !== "string" || !DISCOUNT_TYPES.includes(type) || typeof value !== "number") return null;
  if (typeof mask !== "number" || typeof start !== "number" || typeof end !== "number") return null;
  const dates = datesLabel(typeof snapshot.starts_on === "string" ? snapshot.starts_on : null, typeof snapshot.ends_on === "string" ? snapshot.ends_on : null);
  const parts = [discountLabel(type as DiscountType, value), daysLabel(mask), windowLabel(start, end), ...(dates ? [dates] : [])];
  if (snapshot.is_active === false) parts.push("pausada");
  return parts.join(" · ");
}

/** Qué plato, categoría o sucursal es una constancia de objetivo o de sucursal. */
function describeObject(snapshot: Record<string, unknown>, names: NameLookups): string {
  if (typeof snapshot.product_id === "string") return `Plato: ${names.products.get(snapshot.product_id) ?? "plato eliminado"}`;
  if (typeof snapshot.category_id === "string") return `Categoría: ${names.categories.get(snapshot.category_id) ?? "categoría eliminada"}`;
  if (typeof snapshot.branch_id === "string") return `Sucursal: ${names.branches.get(snapshot.branch_id) ?? "sucursal desactivada o eliminada"}`;
  return "";
}

export function describeEntry(entry: Pick<HistoryEntry, "event" | "snapshot">, names: NameLookups): string {
  if (entry.event === "created" || entry.event === "updated") return describePromotionSnapshot(entry.snapshot) ?? "";
  if (entry.event === "deleted") {
    const targets = arrayOf(entry.snapshot.targets).length;
    const branches = arrayOf(entry.snapshot.branches).length;
    const summary = describePromotionSnapshot(entry.snapshot);
    const had = `Tenía ${targets} ${targets === 1 ? "plato o categoría" : "platos o categorías"}${branches > 0 ? ` y ${branches} ${branches === 1 ? "sucursal" : "sucursales"}` : ""}`;
    return summary ? `${summary} · ${had}` : had;
  }
  return describeObject(entry.snapshot, names);
}
