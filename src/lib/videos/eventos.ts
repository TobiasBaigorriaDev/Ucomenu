import type { SupabaseClient } from "@supabase/supabase-js";
import { asUuid } from "@/lib/carta/validation";
import type { Database } from "@/lib/supabase/database.types";
import { finalizeVideoDeletion } from "./borrado";
import { MAX_VIDEO_SECONDS, type MuxError } from "./estado";
import type { MuxClient } from "./mux";

type Db = SupabaseClient<Database>;

/**
 * Eventos del webhook de Mux (ficha videos-mux-parte-b). La firma ya se verificó en la ruta; acá se aplica el evento a la base
 * con la clave de servicio, de forma IDEMPOTENTE y tolerante al ORDEN: el mismo evento repetido, o `ready` antes que
 * `asset_created`, dejan el mismo resultado, y nada retrocede un video ya `ready`.
 *
 * Qué fila toca un evento: la que tiene el `id` que viaja en `passthrough` Y el `mux_upload_id` del evento. Un evento nunca
 * cambia la organización, el título ni el estado de publicación. Todo asset con `passthrough` de la forma de nuestros ids que no
 * tiene fila (el video se borró mientras subía) o cuya fila está en «deleting» se borra en Mux: así no quedan huérfanos. Un
 * asset sin ese `passthrough` (subido a mano en el panel de Mux) no se toca.
 *
 * Lanza ante un fallo de la base o de Mux (la ruta responde 500 y Mux reintenta): repetir es seguro.
 */

export type MuxEvent = { type: string; data: Record<string, unknown> };

/** `applied`: cambió la base · `ignored`: no era para nosotros o no había nada que hacer · los otros dos: se borró un asset sobrante. */
export type EventOutcome = "applied" | "ignored" | "orphan_removed" | "removed_deleting";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** El evento tal como lo manda Mux (`type` y `data`), o `null` si el cuerpo no tiene esa forma. */
export function parseMuxEvent(text: string): MuxEvent | null {
  try {
    const json: unknown = JSON.parse(text);
    if (!isRecord(json) || typeof json.type !== "string" || !isRecord(json.data)) return null;
    return { type: json.type, data: json.data };
  } catch {
    return null;
  }
}

type VideoRow = { id: string; organization_id: string; status: string; mux_status: string; mux_upload_id: string | null; mux_asset_id: string | null };
const ROW_COLUMNS = "id, organization_id, status, mux_status, mux_upload_id, mux_asset_id";

async function findById(admin: Db, id: string): Promise<VideoRow | null> {
  const { data, error } = await admin.from("menu_videos").select(ROW_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`No se pudo leer el video: ${error.message}`);
  return data;
}

async function findByUpload(admin: Db, uploadId: string): Promise<VideoRow | null> {
  const { data, error } = await admin.from("menu_videos").select(ROW_COLUMNS).eq("mux_upload_id", uploadId).maybeSingle();
  if (error) throw new Error(`No se pudo leer el video: ${error.message}`);
  return data;
}

function needMux(mux: MuxClient | null): MuxClient {
  if (!mux) throw new Error("Mux no está configurado: no se puede borrar el asset.");
  return mux;
}

/** El video se estaba borrando: se anota el asset que acaba de aparecer y se termina el borrado (asset y fila). */
async function removeDeleting(admin: Db, mux: MuxClient | null, row: VideoRow, assetId: string): Promise<EventOutcome> {
  if (row.mux_asset_id !== assetId) {
    const { error } = await admin.from("menu_videos").update({ mux_asset_id: assetId }).eq("id", row.id);
    if (error) throw new Error(`No se pudo anotar el asset del video que se borra: ${error.message}`);
  }
  const outcome = await finalizeVideoDeletion(admin, mux, row.organization_id, row.id);
  if (outcome === "deleted" || outcome === "not_found") return "removed_deleting";
  throw new Error(`No se pudo terminar el borrado del video (${outcome}).`);
}

async function markErrored(admin: Db, row: VideoRow, assetId: string | null, code: MuxError): Promise<void> {
  const { error } = await admin
    .from("menu_videos")
    .update({ mux_status: "errored", mux_error: code, ...(assetId ? { mux_asset_id: assetId } : {}) })
    .eq("id", row.id)
    .neq("mux_status", "ready")
    .neq("status", "deleting");
  if (error) throw new Error(`No se pudo marcar el video con error: ${error.message}`);
}

/** Resuelve la fila de un evento de asset: por `passthrough` (nuestro id) y, si no, por la subida. */
async function rowForAsset(admin: Db, passthrough: string | null, uploadId: string | null): Promise<{ row: VideoRow | null; ours: boolean }> {
  const videoId = asUuid(passthrough);
  if (videoId) return { row: await findById(admin, videoId), ours: true };
  if (uploadId) {
    const row = await findByUpload(admin, uploadId);
    return { row, ours: row !== null };
  }
  return { row: null, ours: false };
}

async function onUploadAssetCreated(admin: Db, mux: MuxClient | null, data: Record<string, unknown>): Promise<EventOutcome> {
  const uploadId = str(data.id);
  const assetId = str(data.asset_id);
  if (!uploadId || !assetId) return "ignored";
  const settings = isRecord(data.new_asset_settings) ? data.new_asset_settings : {};
  const { row, ours } = await rowForAsset(admin, str(settings.passthrough), uploadId);

  if (!row) {
    if (!ours) return "ignored";
    await needMux(mux).deleteAsset(assetId);
    return "orphan_removed";
  }
  if (row.mux_upload_id !== uploadId) return "ignored";
  if (row.status === "deleting") return removeDeleting(admin, mux, row, assetId);

  const { data: updated, error } = await admin
    .from("menu_videos")
    .update({ mux_asset_id: assetId, mux_status: "processing" })
    .eq("id", row.id)
    .eq("mux_upload_id", uploadId)
    .in("mux_status", ["awaiting_upload", "processing"])
    .neq("status", "deleting")
    .select("id");
  if (error) throw new Error(`No se pudo anotar el asset del video: ${error.message}`);
  return updated.length > 0 ? "applied" : "ignored";
}

async function onAssetReady(admin: Db, mux: MuxClient | null, data: Record<string, unknown>): Promise<EventOutcome> {
  const assetId = str(data.id);
  const uploadId = str(data.upload_id);
  if (!assetId) return "ignored";
  const { row, ours } = await rowForAsset(admin, str(data.passthrough), uploadId);

  if (!row) {
    if (!ours) return "ignored";
    await needMux(mux).deleteAsset(assetId);
    return "orphan_removed";
  }
  if (!uploadId || row.mux_upload_id !== uploadId) return "ignored";
  if (row.status === "deleting") return removeDeleting(admin, mux, row, assetId);
  if (row.mux_status === "ready") return "ignored";

  const duration = typeof data.duration === "number" && Number.isFinite(data.duration) ? data.duration : null;
  const playbacks = Array.isArray(data.playback_ids) ? data.playback_ids : [];
  const publicPlayback = playbacks.find((item): item is Record<string, unknown> => isRecord(item) && item.policy === "public" && str(item.id) !== null);
  const playbackId = publicPlayback ? str(publicPlayback.id) : null;

  // Un asset que no cumple la regla no llega a «ready»: se anota el motivo y se borra en Mux (cuesta y no se va a publicar).
  const rejection: MuxError | null =
    duration === null || duration <= 0 ? "processing_failed" : duration > MAX_VIDEO_SECONDS ? "too_long" : playbackId === null ? "no_playback" : null;
  if (rejection || duration === null || playbackId === null) {
    await markErrored(admin, row, assetId, rejection ?? "processing_failed");
    await needMux(mux).deleteAsset(assetId);
    return "applied";
  }

  const { data: updated, error } = await admin
    .from("menu_videos")
    .update({
      mux_asset_id: assetId,
      mux_playback_id: playbackId,
      duration_seconds: Math.round(duration * 100) / 100,
      mux_status: "ready",
      mux_error: null,
    })
    .eq("id", row.id)
    .eq("mux_upload_id", uploadId)
    .neq("mux_status", "ready")
    .neq("status", "deleting")
    .select("id");
  if (error) throw new Error(`No se pudo dejar el video listo: ${error.message}`);
  if (updated.length > 0) return "applied";

  // 0 filas: se borró (o empezó a borrarse) entre la lectura y la escritura. Si sigue acá y se está borrando, se termina de borrar.
  const again = await findById(admin, row.id);
  return again?.status === "deleting" ? removeDeleting(admin, mux, again, assetId) : "ignored";
}

async function onAssetErrored(admin: Db, mux: MuxClient | null, data: Record<string, unknown>): Promise<EventOutcome> {
  const assetId = str(data.id);
  if (!assetId) return "ignored";
  const uploadId = str(data.upload_id);
  const { row, ours } = await rowForAsset(admin, str(data.passthrough), uploadId);

  if (!row) {
    if (!ours) return "ignored";
    await needMux(mux).deleteAsset(assetId);
    return "orphan_removed";
  }
  if (!uploadId || row.mux_upload_id !== uploadId) return "ignored";
  if (row.status === "deleting") return removeDeleting(admin, mux, row, assetId);
  if (row.mux_status === "ready") return "ignored";
  await markErrored(admin, row, assetId, "processing_failed");
  return "applied";
}

async function onUploadErrored(admin: Db, data: Record<string, unknown>): Promise<EventOutcome> {
  const uploadId = str(data.id);
  if (!uploadId) return "ignored";
  const row = await findByUpload(admin, uploadId);
  if (!row || row.status === "deleting" || row.mux_status !== "awaiting_upload") return "ignored";
  await markErrored(admin, row, null, "upload_failed");
  return "applied";
}

export async function handleMuxEvent(admin: Db, mux: MuxClient | null, event: MuxEvent): Promise<EventOutcome> {
  switch (event.type) {
    case "video.upload.asset_created":
      return onUploadAssetCreated(admin, mux, event.data);
    case "video.asset.ready":
      return onAssetReady(admin, mux, event.data);
    case "video.asset.errored":
      return onAssetErrored(admin, mux, event.data);
    case "video.upload.errored":
      return onUploadErrored(admin, event.data);
    default:
      // video.upload.cancelled (lo cancelamos nosotros), video.asset.deleted (lo borramos nosotros) y el resto: nada que hacer.
      return "ignored";
  }
}
