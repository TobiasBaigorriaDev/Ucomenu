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

export async function outcome(
  slug: string,
  orgId: string,
  result: Result<unknown>,
  message: string,
  values?: Record<string, string>,
): Promise<FormState> {
  if (!result.ok) return { error: cartaErrorMessage(result.error, await getEntitlements(orgId)), values };
  refresh(slug, orgId);
  return { ok: true, message };
}

export const NOT_FOUND = { error: cartaErrorMessage("not_found", null) } satisfies FormState;
