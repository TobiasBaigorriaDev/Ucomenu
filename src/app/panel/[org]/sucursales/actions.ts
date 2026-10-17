"use server";

import { revalidatePath } from "next/cache";
import { getEntitlements, requireOwner } from "@/lib/auth/session";
import { asUuid } from "@/lib/carta/validation";
import type { FormState } from "@/lib/form-state";
import { createBranch, renameBranch, setBranchActive, sucursalesErrorMessage, type Result } from "@/lib/sucursales/branches";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Server actions de las sucursales. Cada una vuelve a exigir sesión y rol de DUEÑO del local (`requireOwner`): el `slug`
 * viaja en un campo oculto, pero la autoridad es la membresía de la persona, no el campo. Las escrituras van con el
 * cliente de la persona (RLS): la base decide quién puede escribir, si la cuenta está al día y si hay cupo en el plan.
 */

async function prepare(formData: FormData) {
  const slug = formData.get("org");
  if (typeof slug !== "string") throw new Error("Falta el local.");
  const { membership } = await requireOwner(slug, `/panel/${slug}/sucursales`);
  return { slug, orgId: membership.org.id, db: await createSessionClient() };
}

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

async function outcome(
  slug: string,
  orgId: string,
  result: Result<unknown>,
  message: string,
  values?: Record<string, string>,
): Promise<FormState> {
  if (!result.ok) return { error: sucursalesErrorMessage(result.error, await getEntitlements(orgId)), values };
  revalidatePath(`/panel/${slug}`, "layout");
  return { ok: true, message };
}

export async function createBranchAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const name = text(formData, "name");
  const branchSlug = text(formData, "slug");
  return outcome(slug, orgId, await createBranch(db, orgId, { name, slug: branchSlug }), "Sucursal creada.", {
    name,
    slug: branchSlug,
  });
}

export async function renameBranchAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  const name = text(formData, "name");
  if (!id) return { error: sucursalesErrorMessage("not_found", null), values: { name } };
  return outcome(slug, orgId, await renameBranch(db, orgId, id, name), "Nombre guardado.", { name });
}

export async function setBranchActiveAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  // Estado deseado explícito: dos pestañas o un reintento nunca alternan a ciegas.
  const desired = formData.get("active");
  if (!id || (desired !== "true" && desired !== "false")) return { error: sucursalesErrorMessage("not_found", null) };
  const active = desired === "true";
  return outcome(slug, orgId, await setBranchActive(db, orgId, id, active), active ? "Sucursal reactivada." : "Sucursal desactivada.");
}
