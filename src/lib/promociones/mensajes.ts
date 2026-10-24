import { writeBlock } from "@/lib/carta/messages";
import type { Entitlements } from "@/lib/entitlements";
import { PROMOTION_NAME_MAX, type PromotionProblem } from "./reglas";

/** Todo lo que puede salir mal al gestionar promociones. */
export type PromocionesError =
  | PromotionProblem
  | "plan_missing" // el plan no incluye la función (y no hay vista previa vigente)
  | "values_rejected" // la base rechazó un valor (23514)
  | "foreign_object" // un plato, categoría o sucursal que no es de este local (23503)
  | "blocked_read_only"
  | "blocked_suspended"
  | "forbidden" // no es el Dueño de este local (RLS)
  | "not_found"
  | "unexpected";

const MESSAGE: Record<PromocionesError, string> = {
  name_blank: "Ponele un nombre a la promoción (por ejemplo, «Happy hour»).",
  name_too_long: `El nombre puede tener hasta ${PROMOTION_NAME_MAX} caracteres.`,
  type_invalid: "Elegí el tipo de descuento.",
  value_blank: "Ingresá el valor del descuento.",
  value_invalid: "El valor no es válido. Para un porcentaje usá un número entero (por ejemplo, 25); para un importe, 2800 o 2.800,50.",
  percent_range: "El porcentaje tiene que estar entre 1 y 100.",
  amount_zero: "El descuento en pesos tiene que ser mayor a cero.",
  days_empty: "Elegí al menos un día de la semana.",
  time_invalid: "Las horas no son válidas. Usá el formato 18:00.",
  window_empty:
    "La hora de inicio y la de fin no pueden ser iguales. Para que rija todo el día, tildá «Todo el día».",
  dates_invalid: "Una de las fechas no es válida.",
  dates_order: "La fecha «hasta» no puede ser anterior a la fecha «desde».",
  targets_empty: "Elegí al menos un plato o una categoría a los que aplique.",
  branches_empty: "Elegí al menos una sucursal, o marcá «Todas las sucursales».",
  ids_invalid: "Algo de lo elegido no es válido. Recargá la página y probá de nuevo.",
  plan_missing: "Tu plan no incluye las promociones programadas. No se guardó nada.",
  values_rejected: "Alguno de los valores no cumple las reglas de las promociones. No se guardó nada.",
  foreign_object: "Algún plato, categoría o sucursal elegido no es de tu local. Recargá la página. No se guardó nada.",
  blocked_read_only: "Tu cuenta está en solo lectura: no se pueden modificar las promociones hasta regularizar el pago. No se guardó ningún cambio.",
  blocked_suspended: "La cuenta está suspendida: no se pueden modificar las promociones hasta regularizar el pago. No se guardó ningún cambio.",
  forbidden: "Solo el Dueño del local puede administrar las promociones.",
  not_found: "No encontramos esa promoción. Puede que ya no exista: recargá la página.",
  unexpected: "No se pudo completar la acción. Probá de nuevo en unos minutos.",
};

export const promocionesErrorMessage = (error: PromocionesError): string => MESSAGE[error];

/** Por qué no se puede escribir hoy (o `null`): mora y plan. */
export function promocionesWriteBlock(ent: Entitlements | null): PromocionesError | null {
  const block = writeBlock(ent);
  if (block === "blocked_read_only" || block === "blocked_suspended") return block;
  if (block) return "unexpected";
  return ent?.features.includes("promotions") ? null : "plan_missing";
}

/** Aviso fijo sobre los formularios deshabilitados. */
export function promocionesBlockNotice(ent: Entitlements | null): string | null {
  const block = promocionesWriteBlock(ent);
  if (block === "plan_missing") return "Tu plan no incluye las promociones programadas. Las que ya tengas dejan de aplicarse mientras tanto, pero no se borran.";
  if (block === "blocked_read_only") return "Tu cuenta está en solo lectura: podés ver las promociones (siguen aplicándose), pero no cambiarlas hasta regularizar el pago.";
  if (block === "blocked_suspended") return "La cuenta está suspendida: podés ver las promociones, pero no cambiarlas hasta regularizar el pago.";
  if (block) return "No pudimos comprobar el estado de la cuenta, así que la edición está desactivada.";
  return null;
}
