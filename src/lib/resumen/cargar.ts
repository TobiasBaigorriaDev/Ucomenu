import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseProducts, parseSales } from "@/lib/analitica/ventas";
import type { Database } from "@/lib/supabase/database.types";
import { buildHoy, HOY_DAYS, HOY_TOP, WEEK, type HoyView } from "./hoy";

type Db = SupabaseClient<Database>;

/**
 * Las cifras del día del Resumen para el Dueño con analítica (ficha resumen-del-panel). Con la sesión de la persona: la base
 * devuelve `null` si no es el Dueño con el plan, y eso es `null` acá (el Resumen dice que no pudo leer). Las ventas fallan por
 * separado de los platos: sin platos se muestran igual las cifras.
 */
export async function loadHoy(db: Db, orgId: string): Promise<HoyView | null> {
  const [sales, products] = await Promise.all([
    db.rpc("owner_sales_overview", { p_org: orgId, p_days: HOY_DAYS }),
    db.rpc("owner_products_performance", { p_org: orgId, p_days: WEEK, p_limit: HOY_TOP }),
  ]);
  const parsedSales = sales.error ? null : parseSales(sales.data);
  if (!parsedSales) return null;
  return buildHoy(parsedSales, products.error ? null : parseProducts(products.data));
}
