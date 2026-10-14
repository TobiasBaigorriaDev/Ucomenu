import type { Entitlements } from "@/lib/entitlements";
import { writeBlock } from "@/lib/carta/messages";
import { LABEL_MAX } from "./labels";

/** Todo lo que puede salir mal al gestionar mesas. */
export type MesasError =
  | "label_blank"
  | "label_too_long"
  | "label_duplicate"
  | "branch_invalid"
  | "limit" // tope de mesas activas por sucursal (53400)
  | "blocked_read_only"
  | "blocked_suspended"
  | "forbidden"
  | "not_found"
  | "unexpected";

const STATIC_MESSAGE: Record<Exclude<MesasError, "limit">, string> = {
  label_blank: "Ingresá un nombre para la mesa.",
  label_too_long: `El nombre puede tener hasta ${LABEL_MAX} caracteres.`,
  label_duplicate: "Ya hay una mesa con ese nombre en esta sucursal.",
  branch_invalid: "Elegí una sucursal de tu local.",
  blocked_read_only:
    "Tu cuenta está en solo lectura: no se pueden modificar las mesas hasta regularizar el pago. No se guardó ningún cambio.",
  blocked_suspended:
    "La cuenta está suspendida: no se pueden modificar las mesas hasta regularizar el pago. No se guardó ningún cambio.",
  forbidden: "No tenés permiso para gestionar las mesas de este local.",
  not_found: "No encontramos esa mesa. Puede que ya no exista: recargá la página.",
  unexpected: "No se pudo completar la acción. Probá de nuevo en unos minutos.",
};

/** El número sale de `org_entitlements` (los límites viven en la base), nunca del texto del error. */
export function mesasErrorMessage(error: MesasError, ent: Entitlements | null): string {
  if (error !== "limit") return STATIC_MESSAGE[error];
  const limit = ent?.limits.tables_per_branch;
  return typeof limit === "number"
    ? `Llegaste al tope de ${limit} mesas activas en esta sucursal. Desactivá una mesa para poder activar o crear otra.`
    : "Llegaste al tope de mesas activas en esta sucursal. Desactivá una mesa para poder activar o crear otra.";
}

/** Por qué no se puede escribir hoy (o `null`). Reutiliza la lectura del estado de la cuenta de la carta. */
export function mesasWriteBlock(ent: Entitlements | null): MesasError | null {
  const block = writeBlock(ent);
  if (block === "blocked_read_only" || block === "blocked_suspended") return block;
  return block ? "unexpected" : null;
}

/** Aviso fijo sobre los formularios deshabilitados (las mesas se ven y se imprimen; no se editan). */
export function mesasBlockNotice(ent: Entitlements | null): string | null {
  const block = mesasWriteBlock(ent);
  if (block === "blocked_read_only")
    return "Tu cuenta está en solo lectura: podés ver las mesas e imprimir los QR, pero no modificarlas hasta regularizar el pago.";
  if (block === "blocked_suspended")
    return "La cuenta está suspendida: podés ver las mesas e imprimir los QR, pero no modificarlas hasta regularizar el pago.";
  return null;
}
