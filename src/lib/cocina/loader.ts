import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  kitchenFailureFromDb,
  parseKitchenBranches,
  parseKitchenMenu,
  parseKitchenOrders,
  sortKitchenOrders,
  type KitchenBranch,
  type KitchenCategory,
  type KitchenState,
} from "./cocina";

type Db = SupabaseClient<Database>;

/** El plan o la cuenta no permiten pedidos, o la persona ya no trabaja en el local: no es una falla, la pantalla lo explica. */
const notAllowed = (error: { message?: string } | null): boolean => error !== null && kitchenFailureFromDb(error.message) === "not_allowed";

/**
 * Estado de la pantalla de cocina, con el cliente de la PERSONA (las funciones comprueban quién es, su plan y su cuenta; no hay
 * lectura directa de tablas). Sin permiso: `enabled: false`. Una falla de la base o una respuesta con otra forma lanza (la ruta de
 * consulta responde 503 y la pantalla reintenta): nunca se muestra una lista vacía como si no hubiera pedidos.
 */
export async function loadKitchen(db: Db, orgId: string, now: Date = new Date()): Promise<KitchenState> {
  const [branches, orders] = await Promise.all([db.rpc("kitchen_branches", { p_org: orgId }), db.rpc("kitchen_orders", { p_org: orgId })]);
  if (notAllowed(branches.error) || notAllowed(orders.error)) return { serverNow: now.toISOString(), enabled: false, branches: [], orders: [] };
  if (branches.error) throw new Error(`No se pudieron leer las sucursales de la cocina: ${branches.error.message}`);
  if (orders.error) throw new Error(`No se pudieron leer los pedidos de la cocina: ${orders.error.message}`);

  const parsedBranches = parseKitchenBranches(branches.data);
  const parsedOrders = parseKitchenOrders(orders.data);
  if (!parsedBranches || !parsedOrders) throw new Error("La base devolvió una respuesta inesperada para la cocina.");
  return { serverNow: parsedOrders.serverNow, enabled: true, branches: parsedBranches, orders: sortKitchenOrders(parsedOrders.orders) };
}

export type KitchenMenuState =
  | { enabled: false }
  | { enabled: true; branches: KitchenBranch[]; branchId: string | null; categories: KitchenCategory[] };

/**
 * Platos de la sucursal elegida (la primera si no se eligió una válida) para marcarlos agotados o disponibles. Sin permiso:
 * `enabled: false`. Sin sucursales activas: lista vacía.
 */
export async function loadKitchenMenu(db: Db, orgId: string, wantedBranch: string | null): Promise<KitchenMenuState> {
  const branchesResult = await db.rpc("kitchen_branches", { p_org: orgId });
  if (notAllowed(branchesResult.error)) return { enabled: false };
  if (branchesResult.error) throw new Error(`No se pudieron leer las sucursales de la cocina: ${branchesResult.error.message}`);
  const branches = parseKitchenBranches(branchesResult.data);
  if (!branches) throw new Error("La base devolvió una respuesta inesperada para la cocina.");

  const branchId = branches.find((branch) => branch.id === wantedBranch)?.id ?? branches[0]?.id ?? null;
  if (!branchId) return { enabled: true, branches, branchId: null, categories: [] };

  const menu = await db.rpc("kitchen_menu", { p_org: orgId, p_branch: branchId });
  if (notAllowed(menu.error)) return { enabled: false };
  if (menu.error) throw new Error(`No se pudo leer la carta de la cocina: ${menu.error.message}`);
  const categories = parseKitchenMenu(menu.data);
  if (!categories) throw new Error("La base devolvió una respuesta inesperada para la cocina.");
  return { enabled: true, branches, branchId, categories };
}
