"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import { asUuid } from "@/lib/carta/validation";
import type { FormState } from "@/lib/form-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/server";
import { finalizeVideoDeletion } from "@/lib/videos/borrado";
import { uploadCorsOrigin } from "@/lib/videos/cors";
import { videoErrorMessage, type VideoError } from "@/lib/videos/mensajes";
import { getMuxClient } from "@/lib/videos/mux";
import { startVideoUpload } from "@/lib/videos/subida";
import { requestVideoDeletion, setVideoPublished, updateVideo, type VideoResult } from "@/lib/videos/videos";

/**
 * Server actions de los videos del panel (ficha videos-del-panel-base). Cada una exige sesión y membresía del local (Dueño o
 * Staff; la autoridad es la membresía, no el campo oculto `org`), escribe con el cliente de la persona (RLS) y refresca el
 * panel. El segundo paso del borrado es el único que usa la clave de servicio, y solo sobre un video que la persona acaba de
 * dejar en «deleting» en SU local.
 */

async function prepareFor(slug: unknown) {
  if (typeof slug !== "string") throw new Error("Falta el local.");
  const { membership } = await requireMembership(slug, `/panel/${slug}/videos`);
  return { slug, orgId: membership.org.id, db: await createSessionClient() };
}

const prepare = (formData: FormData) => prepareFor(formData.get("org"));

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

const NOT_FOUND = (message: string): FormState => ({ error: message });

async function outcome(slug: string, orgId: string, result: VideoResult<unknown>, message: string, values?: Record<string, string>): Promise<FormState> {
  if (!result.ok) {
    // «No sé si se guardó»: el cambio pudo quedar hecho, así que el panel se refresca igual.
    if (result.error === "uncertain") revalidatePath(`/panel/${slug}`, "layout");
    return { error: videoErrorMessage(result.error, await getEntitlements(orgId)), values };
  }
  revalidatePath(`/panel/${slug}`, "layout");
  return { ok: true, message };
}

/** Nombre y plato enlazado. El plato vacío es «sin enlace»; uno que no es un id válido se rechaza. */
export async function saveVideoAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  if (!id) return NOT_FOUND(videoErrorMessage("not_found", null));
  const rawProduct = text(formData, "product");
  const productId = rawProduct === "" ? null : asUuid(rawProduct);
  const values = { title: text(formData, "title"), product: rawProduct };
  if (rawProduct !== "" && !productId) return { error: videoErrorMessage("product_invalid", null), values };
  return outcome(slug, orgId, await updateVideo(db, orgId, id, { title: values.title, productId }), "Video guardado.", values);
}

/** Publicar o despublicar. La base valida que esté procesado, el plan y el cupo. */
export async function publishVideoAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  const intent = text(formData, "intent");
  if (!id || (intent !== "publish" && intent !== "unpublish")) return NOT_FOUND(videoErrorMessage("not_found", null));
  const publish = intent === "publish";
  return outcome(slug, orgId, await setVideoPublished(db, orgId, id, publish), publish ? "Ahora está publicado." : "Ahora es un borrador.");
}

type DeleteResult = { ok: true } | { ok: false; error: VideoError };

/**
 * Los dos pasos del borrado. Paso 1 con la sesión de la persona: el video pasa a «deleting». Paso 2 con la clave de servicio:
 * borra el asset en Mux (o cancela la subida) y después la fila. Si Mux no responde, el video ya salió de la lista de
 * publicados y queda en «Eliminando» con la opción de reintentar.
 */
async function deleteVideo(slug: string, orgId: string, db: Awaited<ReturnType<typeof createSessionClient>>, id: string): Promise<DeleteResult> {
  const requested = await requestVideoDeletion(db, orgId, id);
  if (!requested.ok) {
    if (requested.error === "uncertain") revalidatePath(`/panel/${slug}`, "layout");
    return requested;
  }

  let finished: Awaited<ReturnType<typeof finalizeVideoDeletion>>;
  try {
    finished = await finalizeVideoDeletion(createAdminClient(), getMuxClient(), orgId, id);
  } catch {
    finished = "unexpected"; // p. ej. falta la clave de servicio en este entorno
  }
  revalidatePath(`/panel/${slug}`, "layout");

  if (finished === "deleted") return { ok: true };
  return { ok: false, error: finished === "pending_mux" ? "mux_pending" : finished === "not_found" ? "not_found" : "unexpected" };
}

/** Borrar, o reintentar un borrado que quedó a medias (es la misma operación y repetirla es segura). */
export async function deleteVideoAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  if (!id) return NOT_FOUND(videoErrorMessage("not_found", null));
  const result = await deleteVideo(slug, orgId, db, id);
  if (result.ok) return { ok: true, message: "Video eliminado." };
  return { error: videoErrorMessage(result.error, await getEntitlements(orgId)) };
}

export type StartUploadResponse = { ok: true; videoId: string; uploadUrl: string } | { ok: false; error: string };

/**
 * Empieza la subida de un video: crea el borrador y le pide a Mux la URL de subida (ver `startVideoUpload`). La llama el
 * formulario de subida desde el navegador, que después sube el archivo directo a Mux.
 */
export async function startVideoUploadAction(input: { org: string; title: string; product: string }): Promise<StartUploadResponse> {
  const { slug, orgId, db } = await prepareFor(input.org);
  const rawProduct = typeof input.product === "string" ? input.product : "";
  const productId = rawProduct === "" ? null : asUuid(rawProduct);
  if (rawProduct !== "" && !productId) return { ok: false, error: videoErrorMessage("product_invalid", null) };

  const requestHeaders = await headers();
  const corsOrigin = uploadCorsOrigin({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("host"),
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  });

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: videoErrorMessage("mux_not_configured", null) };
  }
  const result = await startVideoUpload(db, admin, getMuxClient(), orgId, { title: input.title, productId, corsOrigin });
  if (!result.ok) {
    if (result.error === "uncertain") revalidatePath(`/panel/${slug}`, "layout");
    return { ok: false, error: videoErrorMessage(result.error, await getEntitlements(orgId)) };
  }
  revalidatePath(`/panel/${slug}`, "layout");
  return { ok: true, videoId: result.data.videoId, uploadUrl: result.data.uploadUrl };
}

/** La subida falló en el navegador: se descarta el video (cancela la subida y borra el borrador). */
export async function discardVideoUploadAction(input: { org: string; id: string }): Promise<{ ok: boolean }> {
  const { slug, orgId, db } = await prepareFor(input.org);
  const id = asUuid(input.id);
  if (!id) return { ok: false };
  return { ok: (await deleteVideo(slug, orgId, db, id)).ok };
}
