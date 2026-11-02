/** Reglas puras del registro autoservicio (ficha registro-autoservicio, ADR 0053): se prueban en `registro.test.ts`. */

/** Versión de `/terminos` y `/privacidad` que se acepta al crear un local. Se actualiza cuando cambia el contenido de esos textos. */
export const TERMS_VERSION = "2026-11-01";

/** Sucursal inicial: el Dueño la renombra después desde Sucursales. */
export const FIRST_BRANCH = { slug: "principal", name: "Principal" } as const;

/** Métodos de ingreso de la sesión (`amr` del JWT), tolerando las dos formas que usa Auth. */
export function authMethods(amr: unknown): string[] {
  if (!Array.isArray(amr)) return [];
  return amr.flatMap((item): string[] => {
    if (typeof item === "string") return [item];
    if (typeof item === "object" && item !== null && typeof (item as { method?: unknown }).method === "string") {
      return [(item as { method: string }).method];
    }
    return [];
  });
}

/**
 * ¿Hay que elegir una contraseña antes de crear el local? Sí, salvo que la sesión venga de una contraseña o de Google: quien entró por
 * un enlace probó su correo, pero la cuenta pudo crearse antes por la API con una contraseña ajena (ADR 0053, decisión 1). Ante un
 * método desconocido se pide.
 */
export function mustChoosePassword(methods: string[]): boolean {
  return !methods.includes("password") && !methods.includes("oauth");
}

/** ¿La sesión viene de un enlace por correo? Solo entonces se elige una contraseña sin escribir la actual. */
export function cameFromEmailLink(methods: string[]): boolean {
  return methods.some((method) => method === "otp" || method === "email" || method === "magiclink" || method === "recovery");
}

/** ¿La cuenta tiene contraseña? Una cuenta creada con Google no tiene identidad de email. */
export function hasEmailIdentity(identities: readonly { provider: string }[] | undefined): boolean {
  return !identities || identities.some((identity) => identity.provider === "email");
}

export type LinkType = "email" | "recovery";

/** Los dos tipos de enlace que mandan las plantillas. Cualquier otro valor no llega a Auth. */
export function parseLinkType(raw: unknown): LinkType | null {
  return raw === "email" || raw === "recovery" ? raw : null;
}

const TOKEN_HASH = /^[A-Za-z0-9_-]{20,128}$/;

export function parseTokenHash(raw: unknown): string | null {
  return typeof raw === "string" && TOKEN_HASH.test(raw) ? raw : null;
}

export type SelfRegisterError =
  | "invalid_name"
  | "invalid_slug"
  | "slug_taken"
  | "slug_reserved"
  | "terms_required"
  | "email_not_confirmed"
  | "already_owner"
  | "trial_already_used"
  | "signups_throttled"
  | "unexpected";

export const SELF_REGISTER_MESSAGE: Record<SelfRegisterError, string> = {
  invalid_name: "Ingresá el nombre de tu local (hasta 80 caracteres).",
  invalid_slug: "La dirección solo puede tener minúsculas, números y guiones simples, hasta 64 caracteres.",
  slug_taken: "Esa dirección ya está en uso. Probá con otra.",
  slug_reserved: "Esa dirección está reservada. Probá con otra.",
  terms_required: "Para crear tu local tenés que aceptar los términos y la política de privacidad.",
  email_not_confirmed: "Tu email todavía no está confirmado. Abrí el enlace que te mandamos.",
  already_owner: "Tu cuenta ya tiene un local.",
  trial_already_used: "Este email ya usó su prueba gratis. Escribinos y vemos cómo seguir.",
  signups_throttled: "Estamos recibiendo muchos registros. Probá de nuevo en un rato.",
  unexpected: "No pudimos crear tu local. Probá de nuevo en unos minutos.",
};

/** Traduce el error de `self_register_organization`. Los nombres son los de sus excepciones. */
export function selfRegisterErrorFrom(error: { code?: string; message?: string }): SelfRegisterError {
  const message = error.message ?? "";
  for (const name of ["email_not_confirmed", "already_owner", "trial_already_used", "signups_throttled", "slug_reserved"] as const) {
    if (message.includes(name)) return name;
  }
  if (error.code === "23505") return "slug_taken";
  if (error.code === "23514") return "invalid_slug";
  return "unexpected";
}
