"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import {
  cartaErrorMessage,
  createCategory,
  createProduct,
  moveCategory,
  moveProduct,
  removeProductImage,
  renameCategory,
  setCategoryActive,
  setProductActive,
  setProductImage,
  updateProduct,
  type Result,
} from "@/lib/carta/catalog";
import { asUuid } from "@/lib/carta/validation";
import type { FormState } from "@/lib/form-state";
import { cartaTag } from "@/lib/public-menu";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Server actions de la carta. Cada una vuelve a exigir sesión y membresía del local (Dueño o Staff):
 * el `slug` viaja en un campo oculto, pero la autoridad es la membresía de la persona, no el campo. Las
 * escrituras van con el cliente de la persona (RLS): la base decide si la cuenta puede escribir y si hay cupo.
 */

async function prepare(formData: FormData) {
  const slug = formData.get("org");
  if (typeof slug !== "string") throw new Error("Falta el local.");
  const { membership } = await requireMembership(slug, `/panel/${slug}/carta`);
  return { slug, orgId: membership.org.id, db: await createSessionClient() };
}

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

/**
 * Tras guardar: refresca el panel y vence YA lo cacheado de la carta pública de esta organización (`updateTag`, no
 * `revalidateTag`: no se sirve ni una vez la versión vieja). Toda acción de este archivo que escribe pasa por acá.
 */
function refresh(slug: string, orgId: string) {
  revalidatePath(`/panel/${slug}`, "layout");
  updateTag(cartaTag(orgId));
}

async function outcome(
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

const NOT_FOUND = { error: cartaErrorMessage("not_found", null) } satisfies FormState;

// --- Categorías -------------------------------------------------------------

export async function createCategoryAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const name = text(formData, "name");
  const result = await createCategory(db, orgId, { name });
  // Tras crearla, el campo se limpia: sin `values`, el formulario vuelve a estar vacío.
  return outcome(slug, orgId, result, "Categoría creada.", { name });
}

export async function renameCategoryAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  if (!id) return NOT_FOUND;
  const name = text(formData, "name");
  return outcome(slug, orgId, await renameCategory(db, orgId, id, { name }), "Nombre guardado.", { name });
}

// --- Subir, bajar, activar y desactivar (categorías y platos) ----------------

const ROW_MESSAGE: Record<string, string> = {
  up: "Subido.",
  down: "Bajado.",
  activate: "Ahora se ve en la carta.",
  deactivate: "Ahora está oculto de la carta.",
};

export async function rowAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  const kind = text(formData, "kind");
  const intent = text(formData, "intent");
  if (!id || (kind !== "category" && kind !== "product") || !(intent in ROW_MESSAGE)) return NOT_FOUND;

  let result: Result<unknown>;
  if (intent === "up" || intent === "down") {
    result = kind === "category" ? await moveCategory(db, orgId, id, intent) : await moveProduct(db, orgId, id, intent);
  } else {
    const active = intent === "activate";
    result = kind === "category" ? await setCategoryActive(db, orgId, id, active) : await setProductActive(db, orgId, id, active);
  }
  return outcome(slug, orgId, result, ROW_MESSAGE[intent]);
}

// --- Platos ---------------------------------------------------------------------

/** Crea (sin `id`) o edita (con `id`) un plato. Al crear, sigue en la pantalla del plato para sumarle la foto. */
export async function saveProductAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);

  const values = {
    name: text(formData, "name"),
    description: text(formData, "description"),
    price: text(formData, "price"),
    category: text(formData, "category"),
  };
  const categoryId = asUuid(values.category);
  if (!categoryId) return { error: cartaErrorMessage("category_invalid", null), values };
  const input = { categoryId, name: values.name, description: values.description, price: values.price };

  const rawId = formData.get("id");
  if (typeof rawId === "string" && rawId !== "") {
    const id = asUuid(rawId);
    if (!id) return NOT_FOUND;
    return outcome(slug, orgId, await updateProduct(db, orgId, id, input), "Cambios guardados.", values);
  }

  const result = await createProduct(db, orgId, { ...input, active: formData.get("active") === "on" });
  if (!result.ok) return outcome(slug, orgId, result, "", { ...values, active: formData.get("active") === "on" ? "on" : "" });
  refresh(slug, orgId);
  redirect(`/panel/${slug}/carta/platos/${result.data.id}?nuevo=1`);
}

export async function uploadPhotoAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  if (!id) return NOT_FOUND;
  const photo = formData.get("photo");
  const result = await setProductImage(db, orgId, id, photo instanceof File ? photo : null);
  return outcome(slug, orgId, result, "Foto guardada.");
}

export async function removePhotoAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  if (!id) return NOT_FOUND;
  return outcome(slug, orgId, await removeProductImage(db, orgId, id), "Foto quitada.");
}
