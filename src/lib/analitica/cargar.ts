import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { parseCallsByHour, parseTopDishes, TOP_DISHES, type HourCalls, type TopDishes } from "./lectura";
import { parseProducts, parseSales, PRODUCT_LIST_SIZE, type PeriodDays, type Products, type Sales } from "./ventas";

type Db = SupabaseClient<Database>;

/**
 * Platos más vistos (en `days` días) y llamados por hora (siempre 14 días: es lo que conserva la purga, ADR 0014) de una
 * organización, para su Dueño con analítica (ADR 0022). Con la sesión de la persona: la base vuelve a comprobar que sea Dueño
 * con el plan y entrega solo lo permitido. Un fallo de una sección no tira la otra: esa queda en `null` y la pantalla lo dice.
 */
export async function loadAnalytics(db: Db, orgId: string, branchId: string | null, days: PeriodDays) {
  const [dishes, calls] = await Promise.all([
    db.rpc("owner_top_dishes", { p_org: orgId, p_days: days, p_limit: TOP_DISHES, ...(branchId ? { p_branch: branchId } : {}) }),
    db.rpc("owner_calls_by_hour", { p_org: orgId, ...(branchId ? { p_branch: branchId } : {}) }),
  ]);
  return {
    dishes: (dishes.error ? null : parseTopDishes(dishes.data)) as TopDishes | null,
    calls: (calls.error ? null : parseCallsByHour(calls.data)) as HourCalls[] | null,
  };
}

/**
 * Ventas y platos del período a partir de los pedidos cerrados (ADR 0045). Cada lectura falla por separado y queda en `null`:
 * `owner_*` devuelve `null` si quien llama no es el Dueño con el plan, y eso también se muestra como «no pudimos leer».
 */
export async function loadSales(db: Db, orgId: string, days: PeriodDays, branchId: string | null) {
  const branch = branchId ? { p_branch: branchId } : {};
  const [sales, products] = await Promise.all([
    db.rpc("owner_sales_overview", { p_org: orgId, p_days: days, ...branch }),
    db.rpc("owner_products_performance", { p_org: orgId, p_days: days, p_limit: PRODUCT_LIST_SIZE, ...branch }),
  ]);
  return {
    sales: (sales.error ? null : parseSales(sales.data)) as Sales | null,
    products: (products.error ? null : parseProducts(products.data)) as Products | null,
  };
}
