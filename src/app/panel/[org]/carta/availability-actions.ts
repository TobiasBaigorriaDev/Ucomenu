"use server";

import { setProductAvailability, setProductBranchPrice, setProductVisibility } from "@/lib/carta/availability";
import { PRICE_ERROR } from "@/lib/carta/catalog";
import { cartaErrorMessage } from "@/lib/carta/messages";
import { parsePrice } from "@/lib/carta/price";
import { asUuid } from "@/lib/carta/validation";
import type { FormState } from "@/lib/form-state";
import { NOT_FOUND, outcome, prepare, text } from "./action-helpers";

/**
 * Ajustes de UNA sucursal sobre un plato (ADR 0035). Cada acción escribe solo su columna, con el estado deseado en el formulario
 * (nunca «alternar»). Vuelven a exigir sesión y membresía (`prepare`) y escriben con el cliente de la persona: la base exige
 * miembro y cuenta editable.
 */

export async function availabilityAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const product = asUuid(formData.get("product"));
  const branch = asUuid(formData.get("branch"));
  const intent = text(formData, "available");
  if (!product || !branch || (intent !== "true" && intent !== "false")) return NOT_FOUND;
  const available = intent === "true";
  return outcome(slug, orgId, await setProductAvailability(db, orgId, product, branch, available),
    available ? "Plato disponible en esta sucursal." : "Plato marcado como agotado en esta sucursal.");
}

export async function visibilityAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const product = asUuid(formData.get("product"));
  const branch = asUuid(formData.get("branch"));
  const intent = text(formData, "visible");
  if (!product || !branch || (intent !== "true" && intent !== "false")) return NOT_FOUND;
  const visible = intent === "true";
  return outcome(slug, orgId, await setProductVisibility(db, orgId, product, branch, visible),
    visible ? "El plato se muestra en esta sucursal." : "El plato quedó oculto en esta sucursal.");
}

/** «Guardar precio» (con el texto del campo) o «Usar precio general» (`intent=reset`: quita el precio propio). */
export async function branchPriceAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { slug, orgId, db } = await prepare(formData);
  const product = asUuid(formData.get("product"));
  const branch = asUuid(formData.get("branch"));
  if (!product || !branch) return NOT_FOUND;

  if (text(formData, "intent") === "reset") {
    return outcome(slug, orgId, await setProductBranchPrice(db, orgId, product, branch, null), "Esta sucursal usa el precio general.");
  }
  const price = text(formData, "price");
  // Con el campo vacío no se adivina: «usar precio general» es un botón aparte (un precio propio de cero se escribe «0»).
  const parsed = parsePrice(price);
  if (!parsed.ok) return { error: cartaErrorMessage(PRICE_ERROR[parsed.problem], null), values: { price } };
  return outcome(slug, orgId, await setProductBranchPrice(db, orgId, product, branch, parsed.cents), "Precio de la sucursal guardado.");
}
