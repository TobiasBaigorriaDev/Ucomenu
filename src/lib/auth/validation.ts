/** Validaciones puras del acceso (sin base ni red): se prueban en `validation.test.ts`. */

export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt, que usa Supabase Auth, ignora lo que pasa de 72 bytes: se rechaza en vez de truncar en silencio. */
export const PASSWORD_MAX_BYTES = 72;

export type PasswordProblem = "too_short" | "too_long" | "blank";

export function validatePassword(password: string): PasswordProblem | null {
  if (password.trim().length === 0) return "blank";
  if ([...password].length < PASSWORD_MIN_LENGTH) return "too_short";
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return "too_long";
  return null;
}

export const PASSWORD_PROBLEM_MESSAGE: Record<PasswordProblem, string> = {
  blank: "Ingresá una contraseña.",
  too_short: `La contraseña tiene que tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  too_long: "La contraseña es demasiado larga (máximo 72 bytes).",
};

const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** Minúsculas y sin espacios en los bordes. Devuelve `null` si no parece un email. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) return null;
  return EMAIL_PATTERN.test(email) ? email : null;
}

/**
 * Destino permitido después del login. Solo rutas internas de las áreas con sesión;
 * cualquier otra cosa (URL externa, `//host`, esquema, barra invertida, otras rutas) se ignora.
 */
const NEXT_PATTERN = /^\/(panel|sala|cocina|cuenta|admin)(\/[A-Za-z0-9_-]+)*\/?$/;

export function safeNext(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  return NEXT_PATTERN.test(raw) ? raw : null;
}

/**
 * A dónde va la persona después de autenticarse. Un `next` válido (ya pasado por `safeNext`) manda siempre, también
 * para un SuperAdmin; sin él, el SuperAdmin entra a `/admin` y el resto a `/panel`.
 */
export function landingPath(next: string | null, platformAdmin: boolean): string {
  return next ?? (platformAdmin ? "/admin" : "/panel");
}
