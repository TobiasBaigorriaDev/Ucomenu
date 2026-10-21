import { revalidatePath, updateTag } from "next/cache";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import { cartaErrorMessage, type Result } from "@/lib/carta/catalog";
import type { FormState } from "@/lib/form-state";
import { cartaTag } from "@/lib/public-menu";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Apoyo común de las server actions de la carta (`actions.ts` y `opciones-actions.ts`). No es un archivo «use server»:
 * son funciones internas, no acciones. Que TODA escritura de la carta pase por el mismo `refresh` es lo que mantiene
 * invalidada la caché de la carta pública.
 */

/** Exige sesión y membresía del local (Dueño o Staff): la autoridad es la membresía, no el campo oculto `org`. */
export async function prepare(formData: FormData) {
  const slug = formData.get("org");
  if (typeof slug !== "string") throw new Error("Falta el local.");
  const { membership } = await requireMembership(slug, `/panel/${slug}/carta`);
  return { slug, orgId: membership.org.id, db: await createSessionClient() };
}

export const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

/**
 * Tras guardar: refresca el panel y vence YA lo cacheado de la carta pública de esta organización (`updateTag`, no
 * `revalidateTag`: no se sirve ni una vez la versión vieja).
 */
export function refresh(slug: string, orgId: string) {
  revalidatePath(`/panel/${slug}`, "layout");
  updateTag(cartaTag(orgId));
}

/** Aviso cuando el cambio quedó hecho pero Storage no pudo borrar el archivo saliente (queda registrado para limpiarlo). */
const FILE_LEFT_NOTICE = "El archivo anterior no se pudo borrar del almacenamiento: no se ve en la carta y quedó registrado para limpiarlo.";

export async function outcome(
  slug: string,
  orgId: string,
  result: Result<unknown>,
  message: string,
  values?: Record<string, string>,
): Promise<FormState> {
  if (!result.ok) {
    // «No sé si se guardó» (se perdió la respuesta de la base): el cambio pudo haber quedado hecho, así que la caché de la
    // carta pública se vence igual. Un fallo con respuesta de la base revirtió todo: no hay nada que invalidar.
    if (result.error === "uncertain") refresh(slug, orgId);
    return { error: cartaErrorMessage(result.error, await getEntitlements(orgId)), values };
  }
  refresh(slug, orgId);
  const leftFile = typeof result.data === "object" && result.data !== null && "filesComplete" in result.data && result.data.filesComplete === false;
  return { ok: true, message: leftFile ? `${message} ${FILE_LEFT_NOTICE}` : message };
}

export const NOT_FOUND = { error: cartaErrorMessage("not_found", null) } satisfies FormState;
