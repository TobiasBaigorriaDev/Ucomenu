"use server";

import { setProductAvailability } from "@/lib/carta/availability";
import { asUuid } from "@/lib/carta/validation";
import type { FormState } from "@/lib/form-state";
import { NOT_FOUND, outcome, prepare, text } from "./action-helpers";

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
