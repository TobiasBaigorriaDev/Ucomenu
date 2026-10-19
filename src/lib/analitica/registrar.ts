import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Suma una vista al plato cuyo detalle se abrió en la carta pública (ficha analitica-basica, ADR 0022). Toda la regla
 * está en la función de base `record_dish_view` (plan con analítica, cuenta al día, sucursal y plato publicados de la
 * misma organización) y lo único que se guarda es un contador por plato y día, nunca nada del comensal. Acá solo se valida
 * el formato. Nunca lanza: una estadística perdida no puede afectar la carta. `false` = no se contó (sin decir por qué).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export async function recordDishView(db: SupabaseClient<Database>, branchId: unknown, productId: unknown): Promise<boolean> {
  if (!isUuid(branchId) || !isUuid(productId)) return false;
  try {
    const { data, error } = await db.rpc("record_dish_view", { p_branch: branchId, p_product: productId });
    return !error && data === true;
  } catch {
    return false;
  }
}
