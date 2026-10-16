import type { Entitlements } from "@/lib/entitlements";
import { MAX_IMAGE_BYTES } from "./images";
import { MAX_CHOICES, MAX_GROUPS_PER_PRODUCT, MAX_OPTIONS_PER_GROUP } from "./options-rules";
import { PRICE_PROBLEM_MESSAGE } from "./price";
import { DESCRIPTION_MESSAGE, NAME_MESSAGE } from "./validation";

/** Todo lo que puede salir mal al editar la carta. Los mensajes dependen del estado de la cuenta cuando hace falta. */
export type CartaError =
  | "name_blank"
  | "name_too_long"
  | "description_too_long"
  | "price_blank"
  | "price_invalid"
  | "price_decimals"
  | "price_big"
  | "category_invalid"
  | "choices_invalid" // mínimo o máximo que no son números enteros
  | "choices_min_over_max" // el mínimo supera al máximo
  | "choices_max_range" // el máximo fuera de 1 a 50
  | "group_cap" // tope técnico de grupos por plato (54000)
  | "option_cap" // tope técnico de opciones por grupo (54000)
  | "limit" // tope de platos activos del plan (53400)
  | "blocked_read_only" // la base no deja escribir: pago vencido hace más de 7 días
  | "blocked_suspended" // idem, cuenta suspendida
  | "forbidden" // no es miembro del local (RLS)
  | "not_found"
  | "image_missing"
  | "image_type"
  | "image_big"
  | "image_failed" // la subida falló (el plato no cambió)
  | "unexpected";

const MB = MAX_IMAGE_BYTES / (1024 * 1024);

const STATIC_MESSAGE: Record<Exclude<CartaError, "limit">, string> = {
  name_blank: NAME_MESSAGE.blank,
  name_too_long: NAME_MESSAGE.too_long,
  description_too_long: DESCRIPTION_MESSAGE,
  price_blank: PRICE_PROBLEM_MESSAGE.blank,
  price_invalid: PRICE_PROBLEM_MESSAGE.invalid,
  price_decimals: PRICE_PROBLEM_MESSAGE.too_many_decimals,
  price_big: PRICE_PROBLEM_MESSAGE.too_big,
  category_invalid: "Elegí una categoría de tu carta.",
  choices_invalid: "El mínimo y el máximo tienen que ser números enteros.",
  choices_min_over_max: "El mínimo no puede ser mayor que el máximo.",
  choices_max_range: `El máximo tiene que estar entre 1 y ${MAX_CHOICES}.`,
  group_cap: `Un plato admite hasta ${MAX_GROUPS_PER_PRODUCT} grupos de opciones (contando los desactivados).`,
  option_cap: `Un grupo admite hasta ${MAX_OPTIONS_PER_GROUP} opciones (contando las desactivadas).`,
  blocked_read_only:
    "Tu cuenta está en solo lectura: no se puede editar la carta hasta regularizar el pago. No se guardó ningún cambio.",
  blocked_suspended:
    "La cuenta está suspendida: no se puede editar la carta hasta regularizar el pago. No se guardó ningún cambio.",
  forbidden: "No tenés permiso para editar la carta de este local.",
  not_found: "No encontramos eso en tu carta. Puede que ya no exista: recargá la página.",
  image_missing: "Elegí una foto.",
  image_type: "La foto tiene que ser JPG, PNG o WebP.",
  image_big: `La foto pesa más de ${MB} MB. Probá con una más liviana.`,
  image_failed: "No se pudo subir la foto. El plato quedó como estaba; probá de nuevo.",
  unexpected: "No se pudo completar la acción. Probá de nuevo en unos minutos.",
};

/** El número sale de `org_entitlements` (los límites viven en la base), nunca del texto del error. */
export function cartaErrorMessage(error: CartaError, ent: Entitlements | null): string {
  if (error !== "limit") return STATIC_MESSAGE[error];
  const limit = ent?.limits.active_products;
  return typeof limit === "number"
    ? `Llegaste al tope de ${limit} platos activos de tu plan. Desactivá un plato para poder activar este.`
    : "Llegaste al tope de platos activos de tu plan. Desactivá un plato para poder activar este.";
}

/** Por qué no se puede escribir hoy (o `null` si se puede). Falla cerrado si no se pudo leer el estado. */
export function writeBlock(ent: Entitlements | null): CartaError | null {
  if (!ent) return "unexpected";
  if (ent.canWrite) return null;
  return ent.state === "suspended" ? "blocked_suspended" : "blocked_read_only";
}

/** Aviso fijo sobre los formularios deshabilitados (la carta se puede ver, no editar). */
export function writeBlockNotice(ent: Entitlements | null): string | null {
  const block = writeBlock(ent);
  if (block === "blocked_read_only") return "Tu cuenta está en solo lectura: podés ver la carta, pero no editarla hasta regularizar el pago.";
  if (block === "blocked_suspended") return "La cuenta está suspendida: podés ver la carta, pero no editarla hasta regularizar el pago.";
  return null;
}
