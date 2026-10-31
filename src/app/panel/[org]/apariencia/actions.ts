"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/session";
import type { CartaError } from "@/lib/carta/catalog";
import { cartaErrorMessage } from "@/lib/carta/messages";
import type { FormState } from "@/lib/form-state";
import { removeCover, removeLogo, setAmbient, setCover, setFont, setLayout, setLogo, setPalette, setShape, setTheme, setVoice, type Result } from "@/lib/identidad/identity";
import { createSessionClient } from "@/lib/supabase/server";

const VOICE_ERRORS = {
  tagline_invalid: "El lema no puede tener saltos de línea ni caracteres invisibles.",
  tagline_too_long: "El lema admite hasta 80 caracteres.",
  hours_invalid: "Los horarios van en una sola línea y sin caracteres invisibles.",
  hours_too_long: "Los horarios admiten hasta 160 caracteres.",
  instagram_invalid: "Escribí solo tu usuario de Instagram (letras, números, puntos y guiones bajos), por ejemplo @milocal.",
  instagram_too_long: "El usuario de Instagram admite hasta 30 caracteres.",
  whatsapp_invalid: "Escribí el número de WhatsApp con código de país, por ejemplo +54 9 11 1234-5678.",
  whatsapp_too_long: "El número de WhatsApp admite hasta 15 dígitos con el código de país.",
} as const;

async function prepare(form: FormData) {
  const slug = form.get("org");
  if (typeof slug !== "string") throw new Error("Falta el local.");
  const { membership } = await requireOwner(slug, `/panel/${slug}/apariencia`);
  return { slug, id: membership.org.id, db: await createSessionClient() };
}

function outcome(slug: string, result: Result, message: string, noun = "logo"): FormState {
  if (!result.ok && result.error === "uncertain") refresh(slug); // pudo haberse guardado: la carta pública no debe quedar vieja
  if (!result.ok) {
    if (result.error === "palette_invalid") return { error: "Elegí una de las paletas disponibles." };
    if (result.error === "theme_invalid") return { error: "Elegí uno de los temas disponibles." };
    if (result.error === "theme_dates_invalid") return { error: "Revisá las fechas: «Hasta» no puede ser anterior a «Desde»." };
    if (result.error === "layout_invalid") return { error: "Elegí uno de los estilos disponibles." };
    if (result.error === "font_invalid") return { error: "Elegí una de las tipografías disponibles." };
    if (result.error === "shape_invalid" || result.error === "density_invalid") return { error: "Elegí una de las formas y densidades disponibles." };
    if (result.error === "ambient_invalid") return { error: "Elegí una de las ambientaciones disponibles." };
    if (result.error in VOICE_ERRORS) return { error: VOICE_ERRORS[result.error as keyof typeof VOICE_ERRORS] };
    const logoErrors = {
      image_missing: `Elegí un archivo para ${noun === "logo" ? "el logo" : "la portada"}.`,
      image_big: `${noun === "logo" ? "El logo supera" : "La portada supera"} los 2 MB. Elegí un archivo más liviano.`,
      image_type: `Usá ${noun === "logo" ? "un logo" : "una foto"} PNG, JPEG o WebP. SVG y otros formatos no están admitidos.`,
      image_failed: `No pudimos subir ${noun === "logo" ? "el logo" : "la portada"}. Probá de nuevo en unos minutos.`,
    };
    return { error: result.error in logoErrors ? logoErrors[result.error as keyof typeof logoErrors] : cartaErrorMessage(result.error as CartaError, null) };
  }
  refresh(slug);
  return {
    ok: true,
    message: result.filesComplete !== false ? message : `${message} El archivo anterior no se pudo borrar del almacenamiento: no se ve en la carta y quedó registrado para limpiarlo.`,
  };
}

function refresh(slug: string) {
  revalidatePath(`/panel/${slug}/apariencia`);
  // La identidad se lee en vivo; no se incluye en la caché de categorías y platos.
  revalidatePath(`/m/${slug}`, "layout");
}

export async function paletteAction(_state: FormState, form: FormData): Promise<FormState> {
  const { slug, id, db } = await prepare(form);
  return outcome(slug, await setPalette(db, id, form.get("palette")), "Colores guardados.");
}

export async function layoutAction(_state: FormState, form: FormData): Promise<FormState> {
  const { slug, id, db } = await prepare(form);
  return outcome(slug, await setLayout(db, id, form.get("layout")), "Estilo guardado.");
}

export async function fontAction(_state: FormState, form: FormData): Promise<FormState> {
  const { slug, id, db } = await prepare(form);
  return outcome(slug, await setFont(db, id, form.get("font")), "Tipografía guardada.");
}

export async function shapeAction(_state: FormState, form: FormData): Promise<FormState> {
  const { slug, id, db } = await prepare(form);
  return outcome(slug, await setShape(db, id, form.get("shape"), form.get("density")), "Forma guardada.");
}

export async function ambientAction(_state: FormState, form: FormData): Promise<FormState> {
  const { slug, id, db } = await prepare(form);
  return outcome(slug, await setAmbient(db, id, form.get("ambient")), "Ambientación guardada.");
}

export async function voiceAction(_state: FormState, form: FormData): Promise<FormState> {
  const { slug, id, db } = await prepare(form);
  const result = await setVoice(db, id, { tagline: form.get("tagline"), hours: form.get("hours"), instagram: form.get("instagram"), whatsapp: form.get("whatsapp") });
  return outcome(slug, result, "Datos del local guardados.");
}

export async function themeAction(_state: FormState, form: FormData): Promise<FormState> {
  const { slug, id, db } = await prepare(form);
  return outcome(slug, await setTheme(db, id, form.get("theme"), form.get("from"), form.get("until")), "Fecha especial guardada.");
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

export async function uploadCoverAction(_state: FormState, form: FormData): Promise<FormState> {
  const { slug, id, db } = await prepare(form);
  const file = form.get("cover");
  return outcome(slug, await setCover(db, id, file instanceof File ? file : null), "Portada guardada.", "portada");
}

export async function removeCoverAction(_state: FormState, form: FormData): Promise<FormState> {
  const { slug, id, db } = await prepare(form);
  return outcome(slug, await removeCover(db, id), "Portada quitada.", "portada");
}
