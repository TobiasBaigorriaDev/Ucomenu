import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { parseTitle } from "./estado";
import { videoErrorFromDb, writeBlock } from "./mensajes";
import type { MuxClient } from "./mux";
import { entitlementsOf, fail, ok, type VideoResult } from "./videos";

type Db = SupabaseClient<Database>;

export type StartedUpload = { videoId: string; uploadUrl: string };

/**
 * Empieza la subida de un video (ficha videos-mux-parte-b): crea el borrador con la sesión de la PERSONA (RLS: miembro, cuenta
 * al día, feed en el plan, tope de 50), pide la subida a Mux con el id del video en `passthrough`, guarda `mux_upload_id` con la
 * clave de servicio (la persona no puede escribirlo) y devuelve la URL firmada. Si algo falla después de crear la fila, se
 * compensa (se cancela la subida y se borra el borrador): no queda nada a medias.
 *
 * La URL de subida es de un solo uso y vence en una hora; solo la recibe quien creó el video.
 */
export async function startVideoUpload(
  db: Db,
  admin: Db,
  mux: MuxClient | null,
  orgId: string,
  input: { title: unknown; productId: string | null; corsOrigin: string | null },
): Promise<VideoResult<StartedUpload>> {
  if (!mux) return fail("mux_not_configured");
  const title = parseTitle(input.title);
  if (!title.ok) return fail(title.problem === "blank" ? "title_blank" : "title_too_long");
  if (!input.corsOrigin) return fail("unexpected");

  const ent = await entitlementsOf(db, orgId);
  const blocked = writeBlock(ent);
  if (blocked) return fail(blocked);
  if (!ent?.features.includes("video_feed")) return fail("feature");

  const inserted = await db
    .from("menu_videos")
    .insert({ organization_id: orgId, title: title.title, product_id: input.productId })
    .select("id")
    .single();
  if (inserted.error) return fail(videoErrorFromDb(inserted.error, "title"));
  const videoId = inserted.data.id;

  const discard = async () => {
    // Mejor esfuerzo: el borrador sin asset ni subida no cuesta nada si quedara.
    await admin.from("menu_videos").delete().eq("id", videoId).eq("organization_id", orgId);
  };

  let upload: { uploadId: string; url: string };
  try {
    upload = await mux.createDirectUpload({ corsOrigin: input.corsOrigin, passthrough: videoId });
  } catch {
    await discard();
    return fail("mux_unavailable");
  }

  const saved = await admin.from("menu_videos").update({ mux_upload_id: upload.uploadId }).eq("id", videoId).eq("organization_id", orgId).select("id");
  if (saved.error || saved.data.length === 0) {
    await mux.cancelUpload(upload.uploadId).catch(() => undefined);
    await discard();
    return fail("unexpected");
  }
  return ok({ videoId, uploadUrl: upload.url });
}
