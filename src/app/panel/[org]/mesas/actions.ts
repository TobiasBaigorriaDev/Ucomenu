"use server";

import { revalidatePath } from "next/cache";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import type { FormState } from "@/lib/form-state";
import { asUuid } from "@/lib/carta/validation";
import {
  createTable,
  mesasErrorMessage,
  regenerateTableQr,
  renameTable,
  setTableActive,
  type Result,
} from "@/lib/mesas/tables";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Server actions de las mesas. Cada una vuelve a exigir sesión y membresía del local (Dueño o Staff): el `slug`
 * viaja en un campo oculto, pero la autoridad es la membresía de la persona, no el campo. Las escrituras van con
 * el cliente de la persona (RLS): la base decide si la cuenta puede escribir y si hay cupo.
 */

async function prepare(formData: FormData) {
  const slug = formData.get("org");
  if (typeof slug !== "string") throw new Error("Falta el local.");
  const { membership } = await requireMembership(slug, `/panel/${slug}/mesas`);
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
  if (!result.ok) return { error: mesasErrorMessage(result.error, await getEntitlements(orgId)), values };
  revalidatePath(`/panel/${slug}`, "layout");
  return { ok: true, message };
}

const NOT_FOUND = { error: mesasErrorMessage("not_found", null) } satisfies FormState;

export async function createTableAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const branchId = asUuid(formData.get("branch"));
  const label = text(formData, "label");
  if (!branchId) return { error: mesasErrorMessage("branch_invalid", null), values: { label } };
  return outcome(slug, orgId, await createTable(db, orgId, { branchId, label }), "Mesa creada.", { label });
}

export async function renameTableAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  if (!id) return NOT_FOUND;
  const label = text(formData, "label");
  return outcome(slug, orgId, await renameTable(db, orgId, id, label), "Nombre guardado.", { label });
}

const ROW_MESSAGE: Record<string, string> = {
  activate: "La mesa está activa.",
  deactivate: "La mesa está inactiva: su QR sigue mostrando la carta, sin el número de mesa.",
};

export async function tableRowAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  const intent = text(formData, "intent");
  if (!id || !(intent in ROW_MESSAGE)) return NOT_FOUND;
  return outcome(slug, orgId, await setTableActive(db, orgId, id, intent === "activate"), ROW_MESSAGE[intent]);
}

export async function regenerateQrAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  if (!id) return NOT_FOUND;
  return outcome(slug, orgId, await regenerateTableQr(db, orgId, id), "QR regenerado. El anterior ya no funciona: imprimí el nuevo.");
}
