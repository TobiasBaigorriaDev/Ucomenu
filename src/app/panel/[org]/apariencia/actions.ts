"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/session";
import { cartaErrorMessage } from "@/lib/carta/messages";
import type { FormState } from "@/lib/form-state";
import { removeLogo, setLogo, setPalette, type Result } from "@/lib/identidad/identity";
import { createSessionClient } from "@/lib/supabase/server";

async function prepare(form: FormData) {
  const slug = form.get("org");
  if (typeof slug !== "string") throw new Error("Falta el local.");
  const { membership } = await requireOwner(slug, `/panel/${slug}/apariencia`);
  return { slug, id: membership.org.id, db: await createSessionClient() };
}

function outcome(slug: string, result: Result, message: string): FormState {
  if (!result.ok) {
    if (result.error === "palette_invalid") return { error: "Elegí una de las paletas disponibles." };
    const logoErrors = {
      image_missing: "Elegí un archivo para el logo.",
      image_big: "El logo supera los 2 MB. Elegí un archivo más liviano.",
      image_type: "Usá un logo PNG, JPEG o WebP. SVG y otros formatos no están admitidos.",
      image_failed: "No pudimos subir el logo. Probá de nuevo en unos minutos.",
    };
    return { error: result.error in logoErrors ? logoErrors[result.error as keyof typeof logoErrors] : cartaErrorMessage(result.error, null) };
  }
  revalidatePath(`/panel/${slug}/apariencia`);
  // La identidad se lee en vivo; no se incluye en la caché de categorías y platos.
  revalidatePath(`/m/${slug}`, "layout");
  return { ok: true, message };
}

export async function paletteAction(_state: FormState, form: FormData): Promise<FormState> {
  const { slug, id, db } = await prepare(form);
  return outcome(slug, await setPalette(db, id, form.get("palette")), "Colores guardados.");
}

export async function uploadLogoAction(_state: FormState, form: FormData): Promise<FormState> {
  const { slug, id, db } = await prepare(form);
  const file = form.get("logo");
  return outcome(slug, await setLogo(db, id, file instanceof File ? file : null), "Logo guardado.");
}

export async function removeLogoAction(_state: FormState, form: FormData): Promise<FormState> {
  const { slug, id, db } = await prepare(form);
  return outcome(slug, await removeLogo(db, id), "Logo quitado.");
}
