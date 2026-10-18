import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { ANALYTICS_DAYS, parseCallsByHour, parseTopDishes, TOP_DISHES, type HourCalls, type TopDishes } from "./lectura";

type Db = SupabaseClient<Database>;

/**
 * Platos más vistos y llamados por hora de una organización, para su Dueño con analítica (ADR 0022). Con la sesión de la
 * persona: la base vuelve a comprobar que sea Dueño con el plan y entrega solo lo permitido. Un fallo de una sección no
 * tira la otra: esa queda en `null` y la pantalla lo dice.
 */
export async function loadAnalytics(db: Db, orgId: string, branchId: string | null) {
  const [dishes, calls] = await Promise.all([
    db.rpc("owner_top_dishes", { p_org: orgId, p_days: ANALYTICS_DAYS, p_limit: TOP_DISHES, ...(branchId ? { p_branch: branchId } : {}) }),
    db.rpc("owner_calls_by_hour", { p_org: orgId, ...(branchId ? { p_branch: branchId } : {}) }),
  ]);
  return {
    dishes: (dishes.error ? null : parseTopDishes(dishes.data)) as TopDishes | null,
    calls: (calls.error ? null : parseCallsByHour(calls.data)) as HourCalls[] | null,
  };
}
