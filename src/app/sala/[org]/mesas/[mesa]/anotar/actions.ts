"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth/session";
import { failureFromDb, parseAddItemInput, type AddResult } from "@/lib/sala/anotar";
import {
  operateFailureFromDb,
  parseCloseInput,
  parseEditInput,
  parseStatusInput,
  parseVoidInput,
  type OperateFailure,
  type OperateResult,
} from "@/lib/sala/operar";
import { parseResetInput, resetFailureFromDb, type ResetResult } from "@/lib/sala/turno";
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

// ---------------------------------------------------------------------------
// Operar el pedido (ficha sala-operar-pedido): estados, modificar, cancelar, cerrar y anular
// ---------------------------------------------------------------------------

const opFailed = (reason: OperateFailure): OperateResult => ({ status: "failed", reason });

/**
 * Cada acción vuelve a exigir sesión y membresía del local pedido, valida la forma de la entrada, comprueba que la línea o el pedido
 * sean DE ESE local (con la RLS de la persona) y llama a la función de la base con su cliente: la base decide las transiciones, el motivo
 * obligatorio y quién puede (plan y mora; cerrar y anular nunca dependen de ellos). Repetir un cambio ya aplicado devuelve `unchanged`.
 */
async function operate(
  slug: string,
  owns: (db: Awaited<ReturnType<typeof createSessionClient>>, orgId: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  call: (db: Awaited<ReturnType<typeof createSessionClient>>) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  gone: OperateFailure,
): Promise<OperateResult> {
  const { membership } = await requireMembership(slug, `/sala/${slug}/mesas`);
  try {
    const db = await createSessionClient();
    const found = await owns(db, membership.org.id);
    if (found.error) return opFailed("unexpected");
    if (!found.data) return opFailed(gone);

    const { data, error } = await call(db);
    if (error) return opFailed(operateFailureFromDb(error.message));

    revalidatePath("/sala/[org]/mesas/[mesa]/anotar", "page");
    revalidatePath(`/sala/${slug}/mesas`);
    const unchanged = typeof data === "object" && data !== null && !Array.isArray(data) && (data as { unchanged?: unknown }).unchanged === true;
    return { status: "done", unchanged };
  } catch {
    // Sin respuesta de la base: no se sabe si se aplicó. Repetir es seguro (devuelve `unchanged`); la pantalla se recarga.
    return opFailed("unexpected");
  }
}

const ownsItem = (itemId: string) => (db: Awaited<ReturnType<typeof createSessionClient>>, orgId: string) =>
  db.from("order_items").select("id").eq("id", itemId).eq("organization_id", orgId).maybeSingle();
const ownsOrder = (orderId: string) => (db: Awaited<ReturnType<typeof createSessionClient>>, orgId: string) =>
  db.from("orders").select("id").eq("id", orderId).eq("organization_id", orgId).maybeSingle();

/** Pasa una línea a «en cocina», «entregado» o «cancelado» (cancelar una entregada exige motivo; lo comprueba la base). */
export async function setLineStatusAction(slug: string, raw: unknown): Promise<OperateResult> {
  const input = parseStatusInput(raw);
  if (input === "invalid") return opFailed("invalid");
  return operate(
    slug,
    ownsItem(input.itemId),
    // `p_reason` admite NULL en la base (sin motivo); el tipo generado no distingue argumentos opcionales.
    (db) => db.rpc("set_order_item_status", { p_item: input.itemId, p_status: input.status, p_reason: input.reason as string }),
    "item_gone",
  );
}

/** Modifica cantidad y observación de una línea anotada (la observación vacía la quita). */
export async function updateLineAction(slug: string, raw: unknown): Promise<OperateResult> {
  const input = parseEditInput(raw);
  if (input === "invalid") return opFailed("invalid");
  return operate(
    slug,
    ownsItem(input.itemId),
    (db) => db.rpc("update_order_item", { p_item: input.itemId, p_quantity: input.quantity, p_note: input.note as string }),
    "item_gone",
  );
}

/** Cierra el pedido de la mesa (la mesa queda libre). Funciona aunque el plan o la cuenta ya no permitan pedidos. */
export async function closeOrderAction(slug: string, raw: unknown): Promise<OperateResult> {
  const input = parseCloseInput(raw);
  if (input === "invalid") return opFailed("invalid");
  return operate(slug, ownsOrder(input.orderId), (db) => db.rpc("close_order", { p_order: input.orderId }), "order_gone");
}

/** Anula el pedido de la mesa con motivo obligatorio (lo comprueba la base). Funciona aunque el plan o la cuenta ya no permitan pedidos. */
export async function voidOrderAction(slug: string, raw: unknown): Promise<OperateResult> {
  const input = parseVoidInput(raw);
  if (input === "invalid") return opFailed("invalid");
  return operate(slug, ownsOrder(input.orderId), (db) => db.rpc("void_order", { p_order: input.orderId, p_reason: input.reason as string }), "order_gone");
}

/**
 * «Reiniciar QR de la mesa» (ficha turno-de-mesa, ADR 0044): los celulares que escanearon antes dejan de ver la cuenta; el QR impreso
 * y su token no cambian. Vuelve a exigir sesión y membresía del local pedido y llama a `reset_table_turn` con el cliente de la PERSONA:
 * la base comprueba que la mesa sea de su organización. No depende del plan ni de la mora. Repetirlo es seguro (solo mueve la hora).
 */
export async function resetTableTurnAction(slug: string, raw: unknown): Promise<ResetResult> {
  const { membership } = await requireMembership(slug, `/sala/${slug}/mesas`);
  const input = parseResetInput(raw);
  if (input === "invalid") return { status: "failed", reason: "invalid" };
  try {
    const db = await createSessionClient();
    const table = await db.from("tables").select("id").eq("id", input.tableId).eq("organization_id", membership.org.id).maybeSingle();
    if (table.error) return { status: "failed", reason: "unexpected" };
    if (!table.data) return { status: "failed", reason: "table_gone" };

    const { error } = await db.rpc("reset_table_turn", { p_table: input.tableId });
    if (error) return { status: "failed", reason: resetFailureFromDb(error.message) };
    revalidatePath("/sala/[org]/mesas/[mesa]/anotar", "page");
    return { status: "done" };
  } catch {
    return { status: "failed", reason: "unexpected" };
  }
}
