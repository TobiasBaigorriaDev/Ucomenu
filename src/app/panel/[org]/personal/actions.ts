"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/session";
import type { FormState } from "@/lib/form-state";
import {
  createMember,
  PERSONNEL_ERROR_MESSAGE,
  removeMember,
  resetMemberPassword,
  setMemberRole,
  type PersonnelContext,
  type Result,
} from "@/lib/personnel";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Server actions del personal. Cada una vuelve a exigir sesión y rol de Dueño del local (`requireOwner`):
 * el formulario es público para quien lo pueda abrir, así que nada de lo que llega en él se da por bueno.
 * El `slug` viaja en un campo oculto, pero la autoridad es la membresía de la persona, no el campo.
 */

const MISSING_CONFIG = "La gestión de personal no está configurada en este servidor.";

async function prepare(formData: FormData) {
  const slug = formData.get("org");
  if (typeof slug !== "string") throw new Error("Falta el local.");

  const { user, membership } = await requireOwner(slug, `/panel/${slug}/personal`);
  const session = await createSessionClient();

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { slug, orgId: membership.org.id, ctx: null };
  }

  const ctx: PersonnelContext = { session, admin, actorId: user.id };
  return { slug, orgId: membership.org.id, ctx };
}

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

function outcome(slug: string, result: Result<unknown>, message: string, values?: Record<string, string>): FormState {
  if (!result.ok) return { error: PERSONNEL_ERROR_MESSAGE[result.error], values };
  revalidatePath(`/panel/${slug}/personal`);
  return { ok: true, message };
}

export async function createMemberAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, ctx } = await prepare(formData);
  const email = text(formData, "email");
  const role = text(formData, "role");
  if (!ctx) return { error: MISSING_CONFIG, values: { email, role } };

  const result = await createMember(ctx, orgId, { email, password: text(formData, "password"), role });
  return outcome(slug, result, `Listo, ${email.trim().toLowerCase()} ya puede ingresar.`, { email, role });
}

export async function setRoleAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, ctx } = await prepare(formData);
  if (!ctx) return { error: MISSING_CONFIG };

  const role = text(formData, "role");
  const result = await setMemberRole(ctx, orgId, text(formData, "membership"), role);
  return outcome(slug, result, role === "owner" ? "Ahora es Dueño." : role === "cook" ? "Ahora es de cocina." : "Ahora es parte del personal.");
}

export async function resetPasswordAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, ctx } = await prepare(formData);
  if (!ctx) return { error: MISSING_CONFIG };

  const result = await resetMemberPassword(ctx, orgId, text(formData, "membership"), text(formData, "password"));
  return outcome(slug, result, "Contraseña cambiada. Pasale la nueva a la persona.");
}

export async function removeMemberAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, ctx } = await prepare(formData);
  if (!ctx) return { error: MISSING_CONFIG };

  const result = await removeMember(ctx, orgId, text(formData, "membership"));
  return outcome(slug, result, "Listo, ya no tiene acceso.");
}
