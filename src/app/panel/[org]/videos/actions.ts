"use server";

import { revalidatePath } from "next/cache";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import { asUuid } from "@/lib/carta/validation";
import type { FormState } from "@/lib/form-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/server";
import { finalizeVideoDeletion } from "@/lib/videos/borrado";
import { videoErrorMessage, type VideoError } from "@/lib/videos/mensajes";
import { getMuxClient } from "@/lib/videos/mux";
import { requestVideoDeletion, setVideoPublished, updateVideo, type VideoResult } from "@/lib/videos/videos";

/**
 * Server actions de los videos del panel (ficha videos-del-panel-base). Cada una exige sesión y membresía del local (Dueño o
 * Staff; la autoridad es la membresía, no el campo oculto `org`), escribe con el cliente de la persona (RLS) y refresca el
 * panel. El segundo paso del borrado es el único que usa la clave de servicio, y solo sobre un video que la persona acaba de
 * dejar en «deleting» en SU local.
 */

async function prepare(formData: FormData) {
  const slug = formData.get("org");
  if (typeof slug !== "string") throw new Error("Falta el local.");
  const { membership } = await requireMembership(slug, `/panel/${slug}/videos`);
  return { slug, orgId: membership.org.id, db: await createSessionClient() };
}

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

/**
 * Borrar, o reintentar un borrado que quedó a medias (es la misma operación y repetirla es segura). Paso 1 con la sesión de la
 * persona: el video pasa a «deleting». Paso 2 con la clave de servicio: borra el asset en Mux y después la fila. Si Mux no
 * responde, el video ya salió de la lista de publicados y queda en «Eliminando» con la opción de reintentar.
 */
export async function deleteVideoAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  if (!id) return NOT_FOUND(videoErrorMessage("not_found", null));

  const requested = await requestVideoDeletion(db, orgId, id);
  if (!requested.ok) return outcome(slug, orgId, requested, "");

  let finished: Awaited<ReturnType<typeof finalizeVideoDeletion>>;
  try {
    finished = await finalizeVideoDeletion(createAdminClient(), getMuxClient(), orgId, id);
  } catch {
    finished = "unexpected"; // p. ej. falta la clave de servicio en este entorno
  }
  revalidatePath(`/panel/${slug}`, "layout");

  if (finished === "deleted") return { ok: true, message: "Video eliminado." };
  const error: VideoError = finished === "pending_mux" ? "mux_pending" : finished === "not_found" ? "not_found" : "unexpected";
  return { error: videoErrorMessage(error, null) };
}
