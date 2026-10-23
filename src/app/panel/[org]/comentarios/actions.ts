"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth/session";
import { asUuid } from "@/lib/carta/validation";
import type { FormState } from "@/lib/form-state";
import { createSessionClient } from "@/lib/supabase/server";
import { moderateComment, moderationMessage } from "@/lib/videos/moderacion";

/**
 * Moderación de comentarios del feed (ficha comentarios-del-feed). Exige sesión y membresía del local (Dueño o Staff; la autoridad es
 * la membresía, no el campo oculto `org`), escribe con el cliente de la persona (RLS) y refresca el panel. Sin `service_role`.
 */

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

/** Aprobar (publicar, o recuperar uno rechazado) o rechazar (también retira uno publicado). */
export async function moderateCommentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const slug = text(formData, "org");
  const { membership } = await requireMembership(slug, `/panel/${slug}/comentarios`);
  const id = asUuid(formData.get("id"));
  const intent = text(formData, "intent");
  if (!id || (intent !== "approve" && intent !== "reject")) return { error: moderationMessage("not_found") };

  const result = await moderateComment(await createSessionClient(), membership.org.id, id, intent === "approve" ? "approved" : "rejected");
  if (!result.ok) {
    // «No sé si se guardó»: el cambio pudo quedar hecho, así que el panel se refresca igual.
    if (result.error === "uncertain") revalidatePath(`/panel/${slug}`, "layout");
    return { error: moderationMessage(result.error) };
  }
  revalidatePath(`/panel/${slug}`, "layout");
  return { ok: true, message: intent === "approve" ? "Comentario aprobado." : "Comentario rechazado." };
}
