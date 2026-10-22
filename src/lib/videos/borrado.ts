import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { MuxClient } from "./mux";

type Db = SupabaseClient<Database>;

/**
 * - `deleted`: el asset (si lo había) y la fila ya no existen.
 * - `pending_mux`: no se pudo borrar el asset en Mux (no configurado o falló); la fila queda en «deleting» para reintentar.
 * - `not_found`: no hay un video con ese id en el local.
 * - `not_deleting`: el video no está en «deleting»; no se toca.
 * - `unexpected`: falló la base.
 */
export type DeletionOutcome = "deleted" | "pending_mux" | "not_found" | "not_deleting" | "unexpected";

/**
 * Segundo paso del borrado (ficha videos-del-panel-base): con la clave de servicio, borra el asset en Mux y recién
 * entonces la fila. Orden a propósito: si Mux falla, la fila sigue como recordatorio de lo que falta; si se borrara
 * primero la fila, el asset quedaría huérfano para siempre (cuesta y sigue sirviendo el video).
 *
 * Un video que todavía no tiene asset pero sí una subida abierta (`mux_upload_id`) la cancela en Mux. Si la cancelación falla
 * o la subida terminó justo antes, no es grave: el asset llega después por el webhook, no encuentra fila y se borra como huérfano.
 *
 * El llamador ya comprobó, con el cliente de la persona (RLS), que es miembro del local y que la cuenta puede escribir. Acá
 * se vuelve a exigir que el video sea de ESA organización y esté en «deleting»: la clave de servicio no se usa para nada más.
 */
export async function finalizeVideoDeletion(admin: Db, mux: MuxClient | null, orgId: string, id: string): Promise<DeletionOutcome> {
  const found = await admin
    .from("menu_videos")
    .select("id, status, mux_asset_id, mux_upload_id")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (found.error) return "unexpected";
  if (!found.data) return "not_found";
  if (found.data.status !== "deleting") return "not_deleting";

  if (found.data.mux_asset_id) {
    if (!mux) return "pending_mux";
    try {
      await mux.deleteAsset(found.data.mux_asset_id);
    } catch {
      return "pending_mux";
    }
  } else if (found.data.mux_upload_id && mux) {
    try {
      await mux.cancelUpload(found.data.mux_upload_id);
    } catch {
      // Sigue: un asset que aparezca después se limpia por el webhook (no hay fila que lo defienda).
    }
  }

  const removed = await admin.from("menu_videos").delete().eq("id", id).eq("organization_id", orgId).eq("status", "deleting").select("id");
  return removed.error ? "unexpected" : "deleted";
}
