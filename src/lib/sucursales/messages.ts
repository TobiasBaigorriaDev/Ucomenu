import { writeBlock } from "@/lib/carta/messages";
import type { Entitlements } from "@/lib/entitlements";
import { BRANCH_NAME_MAX } from "./rules";

/** Todo lo que puede salir mal al gestionar sucursales. */
export type SucursalesError =
  | "name_blank"
  | "name_too_long"
  | "slug_blank"
  | "slug_invalid"
  | "slug_duplicate"
  | "limit" // tope de sucursales del plan (53400)
  | "blocked_read_only"
  | "blocked_suspended"
  | "forbidden" // no es el Dueño de este local (RLS o rol)
  | "not_found"
  | "unexpected";

const STATIC_MESSAGE: Record<Exclude<SucursalesError, "limit">, string> = {
  name_blank: "Ingresá un nombre para la sucursal.",
  name_too_long: `El nombre puede tener hasta ${BRANCH_NAME_MAX} caracteres.`,
  slug_blank: "Ingresá un identificador para la dirección de la carta.",
  slug_invalid:
    "El identificador solo puede tener letras minúsculas sin acentos, números y guiones (por ejemplo, centro o palermo-2).",
  slug_duplicate: "Ya hay una sucursal con ese identificador en tu local. Elegí otro.",
  blocked_read_only:
    "Tu cuenta está en solo lectura: no se pueden modificar las sucursales hasta regularizar el pago. No se guardó ningún cambio.",
  blocked_suspended:
    "La cuenta está suspendida: no se pueden modificar las sucursales hasta regularizar el pago. No se guardó ningún cambio.",
  forbidden: "Solo el Dueño del local puede administrar las sucursales.",
  not_found: "No encontramos esa sucursal. Puede que ya no exista: recargá la página.",
  unexpected: "No se pudo completar la acción. Probá de nuevo en unos minutos.",
};

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Mensaje del tope de sucursales. El número sale de `org_entitlements` (los límites viven en la base), nunca del texto del error. */
export function branchLimitMessage(ent: Entitlements | null): string {
  const limit = ent?.limits.branches;
  const incluye =
    typeof limit === "number"
      ? `Tu plan incluye ${plural(limit, "sucursal", "sucursales")} y ya las usás. `
      : "Llegaste al tope de sucursales de tu plan. ";
  return `${incluye}Para sumar otra, contactá a UcoMenu para cambiar de plan.`;
}

export function sucursalesErrorMessage(error: SucursalesError, ent: Entitlements | null): string {
  return error === "limit" ? branchLimitMessage(ent) : STATIC_MESSAGE[error];
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
    return "Tu cuenta está en solo lectura: podés ver las sucursales, pero no crearlas ni renombrarlas hasta regularizar el pago.";
  if (block === "blocked_suspended")
    return "La cuenta está suspendida: podés ver las sucursales, pero no crearlas ni renombrarlas hasta regularizar el pago.";
  return null;
}
