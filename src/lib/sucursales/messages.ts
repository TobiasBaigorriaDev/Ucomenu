import { writeBlock } from "@/lib/carta/messages";
import { formatMonthlyPrice, type Entitlements } from "@/lib/entitlements";
import { BRANCH_NAME_MAX, REVIEW_URL_MAX } from "./rules";

/** Todo lo que puede salir mal al gestionar sucursales. */
export type SucursalesError =
  | "name_blank"
  | "name_too_long"
  | "slug_blank"
  | "slug_invalid"
  | "slug_duplicate"
  | "review_link_invalid" // el enlace de reseñas no es una dirección https de Google
  | "review_link_too_long"
  | "limit" // tope de sucursales activas del plan al crear (53400)
  | "limit_reactivate" // tope de sucursales activas del plan al reactivar (53400)
  | "blocked_read_only"
  | "blocked_suspended"
  | "forbidden" // no es el Dueño de este local (RLS o rol)
  | "not_found"
  | "unexpected";

const STATIC_MESSAGE: Record<Exclude<SucursalesError, "limit" | "limit_reactivate">, string> = {
  name_blank: "Ingresá un nombre para la sucursal.",
  name_too_long: `El nombre puede tener hasta ${BRANCH_NAME_MAX} caracteres.`,
  slug_blank: "Ingresá un identificador para la dirección de la carta.",
  slug_invalid:
    "El identificador solo puede tener letras minúsculas sin acentos, números y guiones (por ejemplo, centro o palermo-2).",
  slug_duplicate: "Ya hay una sucursal con ese identificador en tu local. Elegí otro.",
  review_link_invalid:
    "Ese enlace no sirve: tiene que ser una dirección https de Google (por ejemplo, la que te da Google Maps o tu Perfil de Empresa en «Pedir reseñas»). No se guardó nada.",
  review_link_too_long: `El enlace puede tener hasta ${REVIEW_URL_MAX} caracteres. No se guardó nada.`,
  blocked_read_only:
    "Tu cuenta está en solo lectura: no se pueden modificar las sucursales hasta regularizar el pago. No se guardó ningún cambio.",
  blocked_suspended:
    "La cuenta está suspendida: no se pueden modificar las sucursales hasta regularizar el pago. No se guardó ningún cambio.",
  forbidden: "Solo el Dueño del local puede administrar las sucursales.",
  not_found: "No encontramos esa sucursal. Puede que ya no exista: recargá la página.",
  unexpected: "No se pudo completar la acción. Probá de nuevo en unos minutos.",
};

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Si el plan del Dueño admite sucursales adicionales y todavía puede pedir más, la salida del tope es pedirlas (con su precio:
 * el Staff no ve esta pantalla ni recibe estos datos). Si no, `null` y queda la salida de siempre: desactivar una o cambiar de plan.
 */
function pedirAdicional(ent: Entitlements | null): string | null {
  const extra = ent?.extraBranches;
  const max = ent?.extraBranchMax;
  if (typeof extra !== "number" || typeof max !== "number" || extra >= max) return null;
  const precio =
    typeof ent?.extraBranchPriceCents === "number" && ent.extraBranchCurrency
      ? ` (${formatMonthlyPrice(ent.extraBranchPriceCents, ent.extraBranchCurrency)}/mes cada una)`
      : "";
  return `Pedí una sucursal adicional a UcoMenu${precio}`;
}

/** Mensaje del tope de sucursales. El número sale de `org_entitlements` (los límites viven en la base), nunca del texto del error. */
export function branchLimitMessage(ent: Entitlements | null): string {
  const limit = ent?.limits.branches;
  const incluye =
    typeof limit === "number"
      ? `Tu plan incluye ${plural(limit, "sucursal", "sucursales")} y ya las usás. `
      : "Llegaste al tope de sucursales de tu plan. ";
  const adicional = pedirAdicional(ent);
  if (adicional) return `${incluye}${adicional} o desactivá una.`;
  return `${incluye}Para sumar otra, desactivá una o contactá a UcoMenu para cambiar de plan.`;
}

/** Reactivar también ocupa un cupo del plan: mismo número (de `org_entitlements`), otra salida. */
export function branchReactivateLimitMessage(ent: Entitlements | null): string {
  const limit = ent?.limits.branches;
  const incluye =
    typeof limit === "number"
      ? `Tu plan incluye ${plural(limit, "sucursal activa", "sucursales activas")} y ya las usás. `
      : "Llegaste al tope de sucursales activas de tu plan. ";
  const adicional = pedirAdicional(ent);
  if (adicional) return `${incluye}${adicional} o desactivá otra para reactivar esta. No se reactivó.`;
  return `${incluye}Para reactivar esta, desactivá otra o contactá a UcoMenu para cambiar de plan. No se reactivó.`;
}

export function sucursalesErrorMessage(error: SucursalesError, ent: Entitlements | null): string {
  if (error === "limit") return branchLimitMessage(ent);
  if (error === "limit_reactivate") return branchReactivateLimitMessage(ent);
  return STATIC_MESSAGE[error];
}

/** Por qué no se puede escribir hoy (o `null`). Reutiliza la lectura del estado de la cuenta de la carta. */
export function sucursalesWriteBlock(ent: Entitlements | null): SucursalesError | null {
  const block = writeBlock(ent);
  if (block === "blocked_read_only" || block === "blocked_suspended") return block;
  return block ? "unexpected" : null;
}

/** Aviso fijo sobre los formularios deshabilitados (las sucursales se ven, no se editan). */
export function sucursalesBlockNotice(ent: Entitlements | null): string | null {
  const block = sucursalesWriteBlock(ent);
  if (block === "blocked_read_only")
    return "Tu cuenta está en solo lectura: podés ver las sucursales, pero no crearlas, renombrarlas, desactivarlas ni reactivarlas hasta regularizar el pago.";
  if (block === "blocked_suspended")
    return "La cuenta está suspendida: podés ver las sucursales, pero no crearlas, renombrarlas, desactivarlas ni reactivarlas hasta regularizar el pago.";
  return null;
}
