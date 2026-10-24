"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getEntitlements, requireOwner } from "@/lib/auth/session";
import { asUuid } from "@/lib/carta/validation";
import type { FormState } from "@/lib/form-state";
import { promocionesErrorMessage } from "@/lib/promociones/mensajes";
import { deletePromotion, duplicatePromotion, savePromotion, setPromotionActive, type Result } from "@/lib/promociones/promociones";
import { parsePromotionForm } from "@/lib/promociones/reglas";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Server actions de las promociones. Cada una vuelve a exigir sesión y rol de DUEÑO del local (`requireOwner`): el `slug` viaja en un
 * campo oculto, pero la autoridad es la membresía de la persona. Las escrituras van con el cliente de la persona (RLS): la base
 * decide quién puede escribir, si la cuenta está al día y si el plan incluye la función.
 */

async function prepare(formData: FormData) {
  const slug = formData.get("org");
  if (typeof slug !== "string") throw new Error("Falta el local.");
  const { membership } = await requireOwner(slug, `/panel/${slug}/promociones`);
  return { slug, orgId: membership.org.id, db: await createSessionClient() };
}

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};
const all = (formData: FormData, key: string) => formData.getAll(key);

async function outcome(slug: string, orgId: string, result: Result<unknown>, message: string): Promise<FormState> {
  if (!result.ok) return { error: promocionesErrorMessage(result.error) };
  void orgId;
  revalidatePath(`/panel/${slug}`, "layout");
  return { ok: true, message };
}

/** Lo que escribió la persona, para volver a mostrarlo si hay un error (las listas viajan juntas en un solo texto JSON). */
function draftOf(formData: FormData): Record<string, string> {
  const draft = {
    name: text(formData, "name"),
    type: text(formData, "type"),
    value: text(formData, "value"),
    days: all(formData, "days"),
    allDay: text(formData, "allDay"),
    from: text(formData, "from"),
    to: text(formData, "to"),
    startsOn: text(formData, "startsOn"),
    endsOn: text(formData, "endsOn"),
    allBranches: text(formData, "allBranches"),
    branches: all(formData, "branches"),
    products: all(formData, "products"),
    categories: all(formData, "categories"),
    active: text(formData, "active"),
  };
  return { draft: JSON.stringify(draft) };
}

/** Crea (sin `id`) o edita una promoción. Al guardar vuelve a la lista con un aviso. */
export async function savePromotionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const rawId = text(formData, "id");
  const id = rawId === "" ? null : asUuid(rawId);
  const values = draftOf(formData);
  if (rawId !== "" && !id) return { error: promocionesErrorMessage("not_found"), values };

  const parsed = parsePromotionForm({
    name: formData.get("name"),
    type: formData.get("type"),
    value: formData.get("value"),
    days: all(formData, "days"),
    allDay: formData.get("allDay"),
    from: formData.get("from"),
    to: formData.get("to"),
    startsOn: formData.get("startsOn"),
    endsOn: formData.get("endsOn"),
    allBranches: formData.get("allBranches"),
    branches: all(formData, "branches"),
    products: all(formData, "products"),
    categories: all(formData, "categories"),
    active: formData.get("active") ?? "false",
  });
  if (!parsed.ok) return { error: promocionesErrorMessage(parsed.problem), values };

  const result = await savePromotion(db, orgId, id, parsed.value, await getEntitlements(orgId));
  if (!result.ok) return { error: promocionesErrorMessage(result.error), values };
  revalidatePath(`/panel/${slug}`, "layout");
  redirect(`/panel/${slug}/promociones?aviso=${id ? "guardada" : "creada"}`);
}

export async function setPromotionActiveAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  const desired = text(formData, "active");
  if (!id || (desired !== "true" && desired !== "false")) return { error: promocionesErrorMessage("not_found") };
  const active = desired === "true";
  return outcome(slug, orgId, await setPromotionActive(db, orgId, id, active, await getEntitlements(orgId)), active ? "Promoción reanudada." : "Promoción pausada.");
}

export async function duplicatePromotionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  if (!id) return { error: promocionesErrorMessage("not_found") };
  return outcome(slug, orgId, await duplicatePromotion(db, orgId, id, await getEntitlements(orgId)), "Copia creada y pausada. Revisala y activala cuando quieras.");
}

export async function deletePromotionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  if (!id) return { error: promocionesErrorMessage("not_found") };
  return outcome(slug, orgId, await deletePromotion(db, orgId, id, await getEntitlements(orgId)), "Promoción borrada. Queda constancia en el historial.");
}
