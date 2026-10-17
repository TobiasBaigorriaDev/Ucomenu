"use server";

import { revalidatePath } from "next/cache";
import { ADMIN_ERROR_MESSAGE, createOrganization, type AdminContext } from "@/lib/admin/organizations";
import { changePlan, registerPayment, setSuspension } from "@/lib/admin/subscriptions";
import { parseSlug } from "@/lib/admin/validation";
import { correctBranchSlug } from "@/lib/admin/branches";
import { addExistingOwner, type Affiliation } from "@/lib/admin/owners";
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

// ---------------------------------------------------------------------------
// Plan, suspensión y pagos de una organización (ficha superadmin-planes-pagos)
// ---------------------------------------------------------------------------

/** Prepara el contexto de una acción sobre una organización: SuperAdmin exigido otra vez y organización por slug. */
async function organizationContext(formData: FormData) {
  const rawSlug = text(formData, "slug");
  const slug = parseSlug(rawSlug) ?? "";
  const user = await requirePlatformAdmin(slug ? `/admin/organizaciones/${slug}` : "/admin");
  try {
    const ctx: AdminContext = { session: await createSessionClient(), admin: createAdminClient(), actorId: user.id };
    return { ctx, slug: rawSlug, page: slug ? `/admin/organizaciones/${slug}` : "/admin" };
  } catch {
    return null;
  }
}

const NOT_CONFIGURED = "El SuperAdmin no está configurado en este servidor.";

export async function correctBranchSlugAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const prepared = await organizationContext(formData);
  const values = { newSlug: text(formData, "newSlug") };
  if (!prepared) return { error: NOT_CONFIGURED, values };
  const result = await correctBranchSlug(prepared.ctx, {
    orgSlug: prepared.slug, branchId: text(formData, "branchId"),
    expectedSlug: text(formData, "expectedSlug"), newSlug: values.newSlug,
  });
  if (!result.ok) return {
    error: result.error === "uncertain_change"
      ? "No pudimos confirmar la corrección. Recargá y revisá la dirección actual de la sucursal antes de repetir."
      : ADMIN_ERROR_MESSAGE[result.error],
    values,
  };
  revalidatePath(prepared.page);
  revalidatePath(`/panel/${prepared.slug}`, "layout");
  revalidatePath(`/m/${prepared.slug}/${result.data.previousSlug}`);
  revalidatePath(`/m/${prepared.slug}/${result.data.slug}`);
  return { ok: true, message: "Identificador corregido. Las direcciones anteriores siguen funcionando y los QR no cambian." };
}

export async function changePlanAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const prepared = await organizationContext(formData);
  const values = { plan: text(formData, "plan"), billingCycle: text(formData, "billingCycle"), reason: text(formData, "reason") };
  if (!prepared) return { error: NOT_CONFIGURED, values };

  const result = await changePlan(prepared.ctx, { slug: prepared.slug, ...values });
  if (!result.ok) return { error: ADMIN_ERROR_MESSAGE[result.error], values };

  revalidatePath("/admin");
  revalidatePath(prepared.page);
  return { ok: true, message: "Listo: el plan quedó cambiado y registrado en los movimientos." };
}

export async function setSuspensionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const prepared = await organizationContext(formData);
  const values = { reason: text(formData, "reason") };
  if (!prepared) return { error: NOT_CONFIGURED, values };
  const suspend = text(formData, "suspend") === "true";

  const result = await setSuspension(prepared.ctx, { slug: prepared.slug, suspend, reason: values.reason });
  if (!result.ok) return { error: ADMIN_ERROR_MESSAGE[result.error], values };

  revalidatePath("/admin");
  revalidatePath(prepared.page);
  return {
    ok: true,
    message: suspend
      ? "Listo: la organización quedó suspendida. Su carta ya no se muestra."
      : "Listo: se quitó la suspensión. La cuenta vuelve al estado que indican sus fechas.",
  };
}

export async function registerPaymentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const prepared = await organizationContext(formData);
  const values = {
    amount: text(formData, "amount"),
    currency: text(formData, "currency"),
    method: text(formData, "method"),
    reference: text(formData, "reference"),
    paidOn: text(formData, "paidOn"),
    coversUntil: text(formData, "coversUntil"),
  };
  if (!prepared) return { error: NOT_CONFIGURED, values };

  const result = await registerPayment(prepared.ctx, { slug: prepared.slug, ...values });
  if (!result.ok) return { error: ADMIN_ERROR_MESSAGE[result.error], values };

  revalidatePath("/admin");
  revalidatePath(prepared.page);
  return { ok: true, message: "Listo: el pago quedó registrado y la vigencia se actualizó." };
}

// ---------------------------------------------------------------------------
// Sumar una cuenta existente como Dueño (ficha dueno-existente)
// ---------------------------------------------------------------------------

const ROLE_LABEL = { owner: "Dueño", staff: "Personal" } as const;

function describeAffiliations(others: Affiliation[]): string {
  if (others.length === 0) return "Todavía no trabaja en ningún otro local.";
  return `Hoy trabaja en: ${others.map((a) => `«${a.name}» (${ROLE_LABEL[a.role]})`).join(", ")}.`;
}

/** Dos pasos con la misma acción: sin la casilla solo informa dónde trabaja la cuenta; con la casilla suma el rol de Dueño. */
export async function addExistingOwnerAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const prepared = await organizationContext(formData);
  const values = { email: text(formData, "email") };
  if (!prepared) return { error: NOT_CONFIGURED, values };

  const result = await addExistingOwner(prepared.ctx, { slug: prepared.slug, email: values.email, confirmed: text(formData, "confirmed") === "on" });
  if (!result.ok) return { error: ADMIN_ERROR_MESSAGE[result.error], values };

  if (result.data.status === "needs_confirmation") {
    const here = result.data.currentRole === "staff" ? " Ya es Personal de esta organización: se la asciende a Dueño." : "";
    return {
      message: `Encontramos la cuenta ${values.email}. ${describeAffiliations(result.data.others)}${here}`,
      values: { ...values, step: "confirm" },
    };
  }

  revalidatePath("/admin");
  revalidatePath(prepared.page);
  revalidatePath(`/panel/${prepared.slug}`, "layout");
  return {
    ok: true,
    message: `Listo: ${values.email} ahora es Dueño de esta organización. Conserva su contraseña y sus otros locales; el movimiento quedó registrado.`,
  };
}
