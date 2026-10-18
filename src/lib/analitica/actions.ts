"use server";

import { createPublicClient } from "@/lib/supabase/public-client";

/**
 * Suma una vista al plato cuyo detalle se abrió en la carta pública (ficha analitica-basica, ADR 0022). Es una escritura
 * PÚBLICA sin sesión: toda la regla está en la función de base `record_dish_view` (plan con analítica, cuenta al día,
 * sucursal y plato publicados de la misma organización) y lo único que se guarda es un contador por plato y día, nunca
 * nada del comensal. Acá solo se valida el formato. Nunca lanza: una estadística perdida no puede afectar la carta.
 * Devuelve `false` si no se contó, sin decir por qué (la carta deja de intentarlo en esa visita).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function recordDishViewAction(branchId: string, productId: string): Promise<boolean> {
  if (typeof branchId !== "string" || typeof productId !== "string" || !UUID.test(branchId) || !UUID.test(productId)) return false;
  try {
    const { data, error } = await createPublicClient().rpc("record_dish_view", { p_branch: branchId, p_product: productId });
    return !error && data === true;
  } catch {
    return false;
  }
}
