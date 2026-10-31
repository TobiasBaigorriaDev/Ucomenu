import type { Entitlements } from "@/lib/entitlements";
import { writeBlock } from "@/lib/carta/messages";
import { COOLDOWN_MAX, COOLDOWN_MIN } from "./config-rules";

/** Todo lo que puede salir mal al configurar el llamado. */
export type ConfigError =
  | "cooldown_blank"
  | "cooldown_invalid"
  | "mute_invalid"
  | "tone_invalid"
  | "blocked_read_only"
  | "blocked_suspended"
  | "forbidden"
  | "not_found"
  | "unexpected";

const MESSAGE: Record<ConfigError, string> = {
  cooldown_blank: "Ingresá cuántos segundos tienen que pasar entre dos llamados.",
  cooldown_invalid: `Ingresá un número entero de segundos entre ${COOLDOWN_MIN} y ${COOLDOWN_MAX}.`,
  mute_invalid: "Elegí cuánto tiempo silenciar la mesa.",
  tone_invalid: "Elegí un tono de la lista para cada aviso.",
  blocked_read_only:
    "Tu cuenta está en solo lectura: no se puede cambiar la configuración del llamado hasta regularizar el pago. No se guardó ningún cambio.",
  blocked_suspended:
    "La cuenta está suspendida: no se puede cambiar la configuración del llamado hasta regularizar el pago. No se guardó ningún cambio.",
  forbidden: "No tenés permiso para cambiar esto. El tiempo entre llamados y los tonos los define el Dueño del local.",
  not_found: "No encontramos esa mesa o sucursal. Puede que ya no exista: recargá la página.",
  unexpected: "No se pudo completar la acción. Probá de nuevo en unos minutos.",
};

export const configErrorMessage = (error: ConfigError): string => MESSAGE[error];

/** Por qué no se puede escribir hoy (o `null`). Reutiliza la lectura del estado de la cuenta de la carta. */
export function configWriteBlock(ent: Entitlements | null): ConfigError | null {
  const block = writeBlock(ent);
  if (block === "blocked_read_only" || block === "blocked_suspended") return block;
  return block ? "unexpected" : null;
}

/** Aviso fijo sobre los formularios deshabilitados. */
export function configBlockNotice(ent: Entitlements | null): string | null {
  const block = configWriteBlock(ent);
  if (block === "blocked_read_only")
    return "Tu cuenta está en solo lectura: podés ver la configuración del llamado, pero no cambiarla hasta regularizar el pago.";
  if (block === "blocked_suspended")
    return "La cuenta está suspendida: podés ver la configuración del llamado, pero no cambiarla hasta regularizar el pago.";
  return null;
}

/** Aviso cuando el plan o la cuenta no permiten el llamado: la configuración se puede dejar lista, pero hoy no tiene efecto. */
export const NOT_ENABLED_NOTICE =
  "El llamado al mozo no está activo en este local (requiere el plan Pro o superior y la cuenta al día). Podés dejar la configuración lista; no tiene efecto hasta que se active.";
