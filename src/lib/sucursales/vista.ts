import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Vista por sucursal de cada persona (ficha vista-por-sucursal, ADR 0034): qué sucursales de su local mira en la sala, el cartel
 * de avisos y el push de sus dispositivos. Es una PREFERENCIA, no un permiso: la membresía sigue siendo por organización y la
 * base entrega lo mismo a cualquier miembro. Vacío significa «todas».
 */

type Db = SupabaseClient<Database>;

export type SetBranchViewResult = "ok" | "unavailable" | "invalid" | "error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids de sucursales sin repetir; `null` si algo no es un identificador (no se manda nada a la base). */
export function parseBranchIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > 50) return null;
  const ids = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || !UUID.test(item)) return null;
    ids.add(item.toLowerCase());
  }
  return [...ids];
}

/**
 * La vista efectiva de quien llama: sus sucursales elegidas que siguen activas; vacío = todas. Lanza si la base falla: nunca se
 * filtra «a ciegas» ni se asume «todas» ante un error (la lectura falla como cualquier otra y se reintenta).
 */
export async function readBranchView(db: Db, orgId: string): Promise<string[]> {
  const { data, error } = await db.rpc("my_branch_view", { p_org: orgId });
  if (error) throw new Error(`No se pudo leer la vista por sucursal: ${error.message}`);
  return Array.isArray(data) ? data.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Lo que leen las pantallas de Sala: la vista efectiva y las sucursales que el Dueño le asignó a la persona (vacío = sin restricción;
 * ficha personal-por-sucursal). Quien tiene asignadas solo ve esas: ni sus nombres ni sus conteos. Es una restricción de PANTALLA,
 * no de autorización. Lanza si la base falla o responde otra forma (nunca se filtra «a ciegas»).
 */
export type BranchAccess = { view: string[]; assigned: string[] };

const isIdList = (value: unknown): value is string[] => Array.isArray(value) && value.every((id) => typeof id === "string");

export function parseBranchAccess(raw: unknown): BranchAccess | null {
  if (!raw || typeof raw !== "object") return null;
  const { view, assigned } = raw as Record<string, unknown>;
  return isIdList(view) && isIdList(assigned) ? { view, assigned } : null;
}

export async function readBranchAccess(db: Db, orgId: string): Promise<BranchAccess> {
  const { data, error } = await db.rpc("my_branch_access", { p_org: orgId });
  if (error) throw new Error(`No se pudo leer la vista por sucursal: ${error.message}`);
  const access = parseBranchAccess(data);
  if (!access) throw new Error("La base devolvió una respuesta inesperada para la vista por sucursal.");
  return access;
}

/** Deja solo las sucursales asignadas (sin asignación = todas). */
export function onlyAssigned<T extends { id: string }>(branches: readonly T[], assigned: readonly string[]): T[] {
  if (assigned.length === 0) return [...branches];
  const allowed = new Set(assigned);
  return branches.filter((branch) => allowed.has(branch.id));
}

/** ¿Puede esta persona ver algo de esa sucursal? Sin asignación, sí. */
export const canSeeBranch = (assigned: readonly string[], branchId: string): boolean => assigned.length === 0 || assigned.includes(branchId);

/** Guarda la vista de quien llama (vacío = todas). La base valida que sean sucursales activas de ese local. */
export async function setBranchView(db: Db, orgId: string, branchIds: string[]): Promise<SetBranchViewResult> {
  const { data, error } = await db.rpc("set_my_branch_view", { p_org: orgId, p_branches: branchIds });
  if (error) return "error";
  return data === "ok" || data === "unavailable" || data === "invalid" ? data : "error";
}

/** Separa los elementos que entran en la vista de los que no. Vista vacía = todos entran. */
export function splitByView<T extends { branchId: string }>(items: readonly T[], view: readonly string[]): { shown: T[]; others: T[] } {
  if (view.length === 0) return { shown: [...items], others: [] };
  const wanted = new Set(view);
  const shown: T[] = [];
  const others: T[] = [];
  for (const item of items) (wanted.has(item.branchId) ? shown : others).push(item);
  return { shown, others };
}
