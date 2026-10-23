"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth/session";
import { setGuideDismissed } from "@/lib/guia/primeros-pasos";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Oculta o vuelve a mostrar la guía de primeros pasos del Resumen para quien lo pide (ficha guia-descartable). Es una preferencia
 * por persona y local: la autoridad es la membresía de la persona (la base vuelve a exigirla), no el campo del formulario. Sin
 * `useActionState`: es un botón que recarga el Resumen, y si la base falla la guía simplemente sigue como estaba.
 */
export async function setGuideDismissedAction(formData: FormData): Promise<void> {
  const slug = formData.get("org");
  if (typeof slug !== "string") return;
  const { membership } = await requireMembership(slug, `/panel/${slug}`);
  const dismissed = formData.get("dismissed") === "1";
  const saved = await setGuideDismissed(await createSessionClient(), membership.org.id, dismissed);
  if (!saved) console.error("[guia] no se pudo guardar la preferencia de la guía");
  revalidatePath(`/panel/${slug}`);
}
