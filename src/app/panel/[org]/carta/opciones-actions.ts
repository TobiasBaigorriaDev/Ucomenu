"use server";

import type { Result } from "@/lib/carta/catalog";
import {
  createGroup,
  createOption,
  moveGroup,
  moveOption,
  setGroupActive,
  setOptionActive,
  updateGroup,
  updateOption,
} from "@/lib/carta/options";
import { asUuid } from "@/lib/carta/validation";
import type { FormState } from "@/lib/form-state";
import { NOT_FOUND, outcome, prepare, text } from "./action-helpers";

/**
 * Server actions de variantes y adicionales. Igual que `actions.ts`: cada una exige sesión y membresía del local
 * (Dueño o Staff), escribe con el cliente de la persona (RLS) y, si guarda, refresca el panel y vence la caché de la
 * carta pública (`outcome` → `refresh`).
 */

export async function createGroupAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const productId = asUuid(formData.get("product"));
  if (!productId) return NOT_FOUND;
  const values = { name: text(formData, "name"), min: text(formData, "min"), max: text(formData, "max") };
  return outcome(slug, orgId, await createGroup(db, orgId, productId, values), "Grupo creado.", values);
}

export async function updateGroupAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  if (!id) return NOT_FOUND;
  const values = { name: text(formData, "name"), min: text(formData, "min"), max: text(formData, "max") };
  return outcome(slug, orgId, await updateGroup(db, orgId, id, values), "Grupo guardado.", values);
}

export async function createOptionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const groupId = asUuid(formData.get("group"));
  if (!groupId) return NOT_FOUND;
  const values = { name: text(formData, "name"), delta: text(formData, "delta") };
  return outcome(slug, orgId, await createOption(db, orgId, groupId, values), "Opción creada.", values);
}

export async function updateOptionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  if (!id) return NOT_FOUND;
  const values = { name: text(formData, "name"), delta: text(formData, "delta") };
  return outcome(slug, orgId, await updateOption(db, orgId, id, values), "Opción guardada.", values);
}

const ROW_MESSAGE: Record<string, string> = {
  up: "Subido.",
  down: "Bajado.",
  activate: "Ahora se ve en la carta.",
  deactivate: "Ahora está oculto de la carta.",
};

/** Subir, bajar, activar y desactivar un grupo o una opción. */
export async function optionRowAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  const kind = text(formData, "kind");
  const intent = text(formData, "intent");
  if (!id || (kind !== "group" && kind !== "option") || !Object.hasOwn(ROW_MESSAGE, intent)) return NOT_FOUND;

  let result: Result<unknown>;
  if (intent === "up" || intent === "down") {
    result = kind === "group" ? await moveGroup(db, orgId, id, intent) : await moveOption(db, orgId, id, intent);
  } else {
    const active = intent === "activate";
    result = kind === "group" ? await setGroupActive(db, orgId, id, active) : await setOptionActive(db, orgId, id, active);
  }
  return outcome(slug, orgId, result, ROW_MESSAGE[intent]);
}
