"use server";

import { redirect } from "next/navigation";
import {
  cartaErrorMessage,
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
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
import { NOT_FOUND, outcome, prepare, refresh, text } from "./action-helpers";

/**
 * Server actions de la carta. Cada una vuelve a exigir sesión y membresía del local (Dueño o Staff):
 * el `slug` viaja en un campo oculto, pero la autoridad es la membresía de la persona, no el campo. Las
 * escrituras van con el cliente de la persona (RLS): la base decide si la cuenta puede escribir y si hay cupo.
 */

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
    dietary: JSON.stringify(formData.getAll("dietary")),
    shown: JSON.stringify(formData.getAll("shown_branch")),
  };
  const categoryId = asUuid(values.category);
  if (!categoryId) return { error: cartaErrorMessage("category_invalid", null), values };
  const input = { categoryId, name: values.name, description: values.description, price: values.price, dietaryTags: formData.getAll("dietary") };

  const rawId = formData.get("id");
  if (typeof rawId === "string" && rawId !== "") {
    const id = asUuid(rawId);
    if (!id) return NOT_FOUND;
    return outcome(slug, orgId, await updateProduct(db, orgId, id, input), "Cambios guardados.", values);
  }

  // Sucursales donde NO se muestra: las activas del local que no se marcaron. Se calcula con lo que hay en la base (no con la lista
  // que mandó el navegador); con una sola sucursal activa no hay nada que decidir.
  const activeBranches = (await db.from("branches").select("id").eq("organization_id", orgId).eq("is_active", true)).data ?? [];
  const shown = new Set(formData.getAll("shown_branch").filter((id): id is string => typeof id === "string"));
  const hiddenBranches = activeBranches.length > 1 ? activeBranches.map((b) => b.id).filter((id) => !shown.has(id)) : [];

  const result = await createProduct(db, orgId, { ...input, active: formData.get("active") === "on", hiddenBranches });
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

// --- Borrado ----------------------------------------------------------------------

const pendingFiles = (complete: boolean) => (complete ? "" : "&archivos=pendientes");

/** Borra un plato (con su foto). Desde su pantalla de edición: al terminar vuelve a la carta con el aviso. */
export async function deleteProductAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  if (!id) return NOT_FOUND;
  const result = await deleteProduct(db, orgId, id);
  if (!result.ok) return outcome(slug, orgId, result, "");
  refresh(slug, orgId);
  redirect(`/panel/${slug}/carta?borrado=plato${pendingFiles(result.data.filesComplete)}`);
}

/**
 * Borra una categoría con sus platos. Lo que la persona vio (`expected`) y el nombre escrito viajan en el formulario, pero
 * los comprueba `deleteCategory` contra la base: el navegador no decide qué se borra.
 */
export async function deleteCategoryAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const id = asUuid(formData.get("id"));
  const expected = Number(text(formData, "expected"));
  if (!id) return NOT_FOUND;
  // Una cantidad ilegible no coincide con ninguna real: se trata como «cambió» (no borra).
  const expectedProducts = Number.isSafeInteger(expected) && expected >= 0 ? expected : -1;
  const result = await deleteCategory(db, orgId, id, { expectedProducts, confirmName: text(formData, "confirm") });
  if (!result.ok) return outcome(slug, orgId, result, "");
  refresh(slug, orgId);
  redirect(`/panel/${slug}/carta?borrado=categoria&platos=${result.data.products}${pendingFiles(result.data.filesComplete)}`);
}
