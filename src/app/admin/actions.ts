"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteOrganization } from "@/lib/admin/delete-organization";
import { ADMIN_ERROR_MESSAGE, createOrganization, type AdminContext } from "@/lib/admin/organizations";
import { changePlan, endAddon, registerPayment, setAddon, setOrganizationActive, setSuspension, voidPayment } from "@/lib/admin/subscriptions";
import { parseSlug } from "@/lib/admin/validation";
import { correctBranchSlug } from "@/lib/admin/branches";
import { addExistingOwner, type Affiliation } from "@/lib/admin/owners";
import { deleteOrphanAccount } from "@/lib/admin/orphan-accounts";
import { asUuid } from "@/lib/carta/validation";
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

export async function voidPaymentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const prepared = await organizationContext(formData);
  const values = { reason: text(formData, "reason") };
  if (!prepared) return { error: NOT_CONFIGURED, values };

  const result = await voidPayment(prepared.ctx, { slug: prepared.slug, paymentId: text(formData, "paymentId"), reason: values.reason });
  if (!result.ok) return { error: ADMIN_ERROR_MESSAGE[result.error], values };

  revalidatePath("/admin");
  revalidatePath(prepared.page);
  return { ok: true, message: "Listo: el pago quedó anulado y el vencimiento volvió al de antes. Si había que cargarlo bien, registrá el pago correcto." };
}

// ---------------------------------------------------------------------------
// Add-ons y baja de la organización (ficha addons-y-baja-de-organizaciones)
// ---------------------------------------------------------------------------

export async function setAddonAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const prepared = await organizationContext(formData);
  const values = { addon: text(formData, "addon"), extraPacks: text(formData, "extraPacks"), endsOn: text(formData, "endsOn"), reason: text(formData, "reason") };
  if (!prepared) return { error: NOT_CONFIGURED, values };

  const result = await setAddon(prepared.ctx, { slug: prepared.slug, ...values });
  if (!result.ok) return { error: ADMIN_ERROR_MESSAGE[result.error], values };

  revalidatePath(prepared.page);
  revalidatePath(`/panel/${prepared.slug}`, "layout");
  return { ok: true, message: "Listo: el add-on quedó registrado con esos packs y esa fecha de fin, y el cambio figura en los movimientos." };
}

export async function endAddonAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const prepared = await organizationContext(formData);
  const values = { reason: text(formData, "reason") };
  if (!prepared) return { error: NOT_CONFIGURED, values };

  const result = await endAddon(prepared.ctx, { slug: prepared.slug, addon: text(formData, "addon"), reason: values.reason });
  if (!result.ok) return { error: ADMIN_ERROR_MESSAGE[result.error], values };

  revalidatePath(prepared.page);
  revalidatePath(`/panel/${prepared.slug}`, "layout");
  return { ok: true, message: "Listo: el add-on quedó finalizado. Se conservan los packs por si se vuelve a activar." };
}

export async function setOrganizationActiveAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const prepared = await organizationContext(formData);
  const values = { reason: text(formData, "reason") };
  if (!prepared) return { error: NOT_CONFIGURED, values };
  const active = text(formData, "active") === "true";

  const result = await setOrganizationActive(prepared.ctx, { slug: prepared.slug, active, reason: values.reason });
  if (!result.ok) return { error: ADMIN_ERROR_MESSAGE[result.error], values };

  revalidatePath("/admin");
  revalidatePath(prepared.page);
  revalidatePath(`/panel/${prepared.slug}`, "layout");
  revalidatePath(`/sala/${prepared.slug}`, "layout");
  return {
    ok: true,
    message: active
      ? "Listo: la organización está activa otra vez. Su carta, sus QR y el acceso del personal vuelven a funcionar según su suscripción."
      : "Listo: la organización quedó dada de baja. Su carta y sus QR dejaron de abrirse y nadie del local puede entrar. No se borró nada.",
  };
}

// ---------------------------------------------------------------------------
// Borrado definitivo (ficha borrado-de-organizaciones, ADR 0028)
// ---------------------------------------------------------------------------

/**
 * Borra la organización. Si sale bien, la página de la organización deja de existir: se redirige a la lista con el aviso en
 * la dirección (`?borrada=` y, si quedaron archivos o videos de Mux sin borrar, `&archivos=pendientes` y `&videos=pendientes`). Si falla, vuelve con el error.
 */
export async function deleteOrganizationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const prepared = await organizationContext(formData);
  const values = { confirmSlug: text(formData, "confirmSlug"), reason: text(formData, "reason") };
  if (!prepared) return { error: NOT_CONFIGURED, values };

  const result = await deleteOrganization(prepared.ctx, { slug: prepared.slug, ...values });
  if (!result.ok) {
    return {
      error:
        result.error === "uncertain_change"
          ? "No pudimos confirmar si la organización se borró. No lo repitas todavía: mirá la lista de organizaciones; si ya no aparece, se borró."
          : ADMIN_ERROR_MESSAGE[result.error],
      values,
    };
  }

  const slug = result.data.slug;
  revalidatePath("/admin");
  revalidatePath(prepared.page);
  revalidatePath(`/panel/${slug}`, "layout");
  revalidatePath(`/sala/${slug}`, "layout");
  revalidatePath(`/m/${slug}`, "layout");
  redirect(
    `/admin?borrada=${encodeURIComponent(slug)}${result.data.files.complete ? "" : "&archivos=pendientes"}${result.data.mux.complete ? "" : "&videos=pendientes"}`,
  );
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

  const result = await addExistingOwner(prepared.ctx, { slug: prepared.slug, email: values.email, confirmed: text(formData, "confirmed") === "on", expectedUserId: asUuid(formData.get("userId")) });
  if (!result.ok) return { error: ADMIN_ERROR_MESSAGE[result.error], values };

  if (result.data.status === "needs_confirmation") {
    const here = result.data.currentRole === "staff" ? " Ya es Personal de esta organización: se la asciende a Dueño." : "";
    return {
      message: `Encontramos la cuenta ${values.email}. ${describeAffiliations(result.data.others)}${here}`,
      // `others` y `here` son para mostrar el hallazgo ordenado ANTES de la casilla; la confirmación sigue atada a `userId`.
      values: {
        ...values,
        step: "confirm",
        userId: result.data.userId,
        others: JSON.stringify(result.data.others.map((a) => ({ name: a.name, role: ROLE_LABEL[a.role] }))),
        here: result.data.currentRole === "staff" ? "staff" : "",
      },
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

// ---------------------------------------------------------------------------
// Cuentas de Auth sin ningún local (ficha cuentas-sin-local)
// ---------------------------------------------------------------------------

/**
 * Borra de Auth una cuenta que quedó sin local. Pide el email escrito y el motivo; la base vuelve a comprobar todo bajo la reserva
 * de la cuenta. Al terminar vuelve a la lista con un aviso (la fila ya no existe y un mensaje en ella se perdería).
 */
export async function deleteOrphanAccountAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requirePlatformAdmin("/admin/cuentas");
  const values = { confirmEmail: text(formData, "confirmEmail"), reason: text(formData, "reason") };

  let ctx: AdminContext;
  try {
    ctx = { session: await createSessionClient(), admin: createAdminClient(), actorId: user.id };
  } catch {
    return { error: NOT_CONFIGURED, values };
  }

  const result = await deleteOrphanAccount(ctx, { userId: text(formData, "userId"), ...values });
  if (!result.ok) {
    return {
      error:
        result.error === "uncertain_change"
          ? "No pudimos confirmar si la cuenta se borró. Repetirlo es seguro: esperá un par de minutos, recargá la lista y, si la cuenta sigue ahí, volvé a borrarla; si dice que no existe, ya se borró (puede que no haya quedado en los movimientos)."
          : ADMIN_ERROR_MESSAGE[result.error],
      values,
    };
  }

  revalidatePath("/admin/cuentas");
  revalidatePath("/admin");
  redirect("/admin/cuentas?borrada=1");
}
