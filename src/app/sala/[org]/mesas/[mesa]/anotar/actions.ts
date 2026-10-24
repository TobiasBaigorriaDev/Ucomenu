"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth/session";
import { failureFromDb, parseAddItemInput, type AddResult } from "@/lib/sala/anotar";
import { createSessionClient } from "@/lib/supabase/server";

const failed = (reason: Extract<AddResult, { status: "failed" }>["reason"]): AddResult => ({ status: "failed", reason });

/**
 * «Anotar» un plato en una mesa (ficha sala-anotar-pedido, ADR 0041). Vuelve a exigir sesión y membresía del local pedido (el `slug`
 * viaja desde la pantalla, pero la autoridad es la membresía de la persona) y llama a `add_order_item` con el cliente de la PERSONA: la
 * base decide si puede anotar (plan y cuenta al día), calcula el precio efectivo y las diferencias de las opciones, valida el catálogo,
 * los mínimos y los máximos y abre el pedido de la mesa si hace falta. De acá no sale ningún precio: la sucursal sale de la mesa, no
 * del navegador. Repetir con la misma `clientKey` devuelve la línea ya anotada (cortó la red) en vez de duplicarla.
 */
export async function addOrderItemAction(slug: string, raw: unknown): Promise<AddResult> {
  const { membership } = await requireMembership(slug, `/sala/${slug}/mesas`);
  const input = parseAddItemInput(raw);
  if (input === "invalid") return failed("invalid");

  try {
    const db = await createSessionClient();
    const table = await db
      .from("tables")
      .select("branch_id, is_active")
      .eq("id", input.tableId)
      .eq("organization_id", membership.org.id)
      .maybeSingle();
    if (table.error) return failed("unexpected");
    if (!table.data || !table.data.is_active) return failed("table_gone");

    const { data, error } = await db.rpc("add_order_item", {
      p_branch: table.data.branch_id,
      p_table: input.tableId,
      p_product: input.productId,
      p_quantity: input.quantity,
      p_client_key: input.clientKey,
      p_options: input.optionIds,
      // `p_note` admite NULL en la base (sin observación); el tipo generado no distingue argumentos opcionales.
      p_note: input.note as string,
    });
    if (error) return failed(failureFromDb(error.message));

    revalidatePath(`/sala/${slug}/mesas/${input.tableId}/anotar`);
    revalidatePath(`/sala/${slug}/mesas`);
    const replayed = typeof data === "object" && data !== null && !Array.isArray(data) && (data as { replayed?: unknown }).replayed === true;
    return { status: "added", replayed };
  } catch {
    // Sin respuesta de la base: no se sabe si se anotó. La pantalla lo dice y, al reintentar con la MISMA clave, no se duplica.
    return failed("unexpected");
  }
}
