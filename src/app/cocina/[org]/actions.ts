"use server";

import { revalidatePath } from "next/cache";
import { requireKitchen } from "@/lib/auth/session";
import { kitchenFailureFromDb, parseAvailabilityInput, parseReadyInput, type KitchenResult } from "@/lib/cocina/cocina";
import { createSessionClient } from "@/lib/supabase/server";

const failed = (reason: Extract<KitchenResult, { status: "failed" }>["reason"]): KitchenResult => ({ status: "failed", reason });

const isUnchanged = (data: unknown): boolean => typeof data === "object" && data !== null && !Array.isArray(data) && (data as { unchanged?: unknown }).unchanged === true;

/**
 * «Listo» (y deshacerlo) de una línea. Vuelve a exigir sesión y membresía del local pedido (en cualquier rol de cocina) y llama a
 * `set_order_item_status` con el cliente de la PERSONA: la base decide si puede (el cocinero solo `ready` y `noted`, con el plan y la
 * cuenta al día) y registra quién lo hizo. Repetir el toque devuelve `unchanged`, sin error.
 */
export async function markReadyAction(slug: string, raw: unknown): Promise<KitchenResult> {
  await requireKitchen(slug, `/cocina/${slug}`);
  const input = parseReadyInput(raw);
  if (input === "invalid") return failed("invalid");

  try {
    const { data, error } = await (await createSessionClient()).rpc("set_order_item_status", { p_item: input.itemId, p_status: input.target });
    if (error) return failed(kitchenFailureFromDb(error.message));
    revalidatePath(`/cocina/${slug}`);
    return { status: "done", unchanged: isUnchanged(data) };
  } catch {
    return failed("unexpected");
  }
}

/**
 * Agotado / disponible de un plato en una sucursal. Vuelve a exigir sesión y membresía del local y llama a
 * `set_kitchen_availability`, que escribe SOLO `is_available` (nunca visibilidad ni precio) y exige plan y cuenta editable.
 */
export async function setAvailabilityAction(slug: string, raw: unknown): Promise<KitchenResult> {
  const { membership } = await requireKitchen(slug, `/cocina/${slug}/carta`);
  const input = parseAvailabilityInput(raw);
  if (input === "invalid") return failed("invalid");

  try {
    const { error } = await (await createSessionClient()).rpc("set_kitchen_availability", {
      p_org: membership.org.id,
      p_product: input.productId,
      p_branch: input.branchId,
      p_available: input.available,
    });
    if (error) return failed(kitchenFailureFromDb(error.message));
    revalidatePath(`/cocina/${slug}/carta`);
    // La carta pública lee la disponibilidad en vivo; el listado del panel resume los agotados por plato.
    revalidatePath(`/panel/${slug}/carta`);
    return { status: "done", unchanged: false };
  } catch {
    return failed("unexpected");
  }
}
