"use server";

import { revalidatePath } from "next/cache";
import { ADMIN_ERROR_MESSAGE, createOrganization, type AdminContext } from "@/lib/admin/organizations";
import { requirePlatformAdmin } from "@/lib/auth/session";
import type { FormState } from "@/lib/form-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Server actions del SuperAdmin. Cada una vuelve a exigir sesión y rol (`requirePlatformAdmin`): el formulario lo puede
 * enviar cualquiera que conozca la acción, así que nada de lo que llega en él se da por bueno. El actor sale de la
 * sesión validada, nunca de un campo.
 */

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

export async function createOrganizationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requirePlatformAdmin("/admin/nueva");

  const values = {
    name: text(formData, "name"),
    slug: text(formData, "slug"),
    branchName: text(formData, "branchName"),
    branchSlug: text(formData, "branchSlug"),
    ownerEmail: text(formData, "ownerEmail"),
    plan: text(formData, "plan"),
    billingCycle: text(formData, "billingCycle"),
    periodEnd: text(formData, "periodEnd"),
  };

  let ctx: AdminContext;
  try {
    ctx = { session: await createSessionClient(), admin: createAdminClient(), actorId: user.id };
  } catch {
    return { error: "El SuperAdmin no está configurado en este servidor.", values };
  }

  const result = await createOrganization(ctx, { ...values, ownerPassword: text(formData, "ownerPassword") });
  if (!result.ok) return { error: ADMIN_ERROR_MESSAGE[result.error], values };

  revalidatePath("/admin");
  return {
    ok: true,
    message: `Listo: «${result.data.slug}» está creada y ${result.data.ownerEmail} ya puede ingresar como Dueño, y su carta queda en /m/${result.data.slug}/${result.data.branchSlug}. Pasale la contraseña temporal.`,
  };
}
