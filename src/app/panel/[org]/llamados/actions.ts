"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth/session";
import { asUuid } from "@/lib/carta/validation";
import type { FormState } from "@/lib/form-state";
import { configErrorMessage, muteTable, setAlertTones, setBranchCooldown, unmuteTable, type Result } from "@/lib/llamados/config";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Server actions de la configuración del llamado. Cada una vuelve a exigir sesión y membresía del local: el `slug`
 * viaja en un campo oculto, pero la autoridad es la membresía de la persona, no el campo. Las escrituras van con el
 * cliente de la persona (RLS): la base decide quién puede escribir (el cooldown, solo el Dueño) y si la cuenta lo permite.
 */

async function prepare(formData: FormData) {
  const slug = formData.get("org");
  if (typeof slug !== "string") throw new Error("Falta el local.");
  const { membership } = await requireMembership(slug, `/panel/${slug}/llamados`);
  return { slug, orgId: membership.org.id, role: membership.role, db: await createSessionClient() };
}

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

function outcome(slug: string, result: Result<unknown>, message: string, values?: Record<string, string>): FormState {
  if (!result.ok) return { error: configErrorMessage(result.error), values };
  revalidatePath(`/panel/${slug}`, "layout");
  return { ok: true, message };
}

const NOT_FOUND = { error: configErrorMessage("not_found") } satisfies FormState;

export async function setCooldownAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, role, db } = await prepare(formData);
  const seconds = text(formData, "seconds");
  // La base ya lo impide (la política de `branches` es del Dueño); se corta antes para dar el motivo sin tocar nada.
  if (role !== "owner") return { error: configErrorMessage("forbidden"), values: { seconds } };
  const branchId = asUuid(formData.get("branch"));
  if (!branchId) return { ...NOT_FOUND, values: { seconds } };
  const result = await setBranchCooldown(db, orgId, branchId, seconds);
  return outcome(slug, result, result.ok ? `Listo: ${result.data.seconds} segundos entre llamados del mismo tipo.` : "", { seconds });
}

export async function muteTableAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  if (!id) return NOT_FOUND;
  // «Quitar silencio» manda `intent=unmute`; cada duración manda `minutes` (se valida contra las que ofrece la pantalla).
  if (text(formData, "intent") === "unmute") return outcome(slug, await unmuteTable(db, orgId, id), "La mesa vuelve a admitir llamados.");
  return outcome(slug, await muteTable(db, orgId, id, formData.get("minutes")), "Mesa silenciada: sus botones de llamado no se muestran.");
}

export async function setAlertTonesAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, role, db } = await prepare(formData);
  const values = { call: text(formData, "call"), ready: text(formData, "ready") };
  // La base ya lo impide (la política de `organizations` es del Dueño); se corta antes para dar el motivo sin tocar nada.
  if (role !== "owner") return { error: configErrorMessage("forbidden"), values };
  const result = await setAlertTones(db, orgId, values.call, values.ready);
  if (!result.ok) return { error: configErrorMessage(result.error), values };
  // Los tonos los fija el layout de cada área: se refrescan los tres para que el cambio rija al volver a ellas.
  for (const area of ["panel", "sala", "cocina"]) revalidatePath(`/${area}/${slug}`, "layout");
  return { ok: true, message: "Tonos guardados. Los demás dispositivos los usan al recargar la pantalla.", values };
}
