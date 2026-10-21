import { isAuthApiError, isAuthError } from "@supabase/supabase-js";

/**
 * Qué significa un error de Auth para quien pregunta «¿hay sesión?».
 *
 * Una sesión inválida y un Auth caído no son lo mismo: la primera es un 401 (la persona tiene que ingresar de nuevo); el
 * segundo es infraestructura y el cliente tiene que reintentar sin perder su sesión. Confundirlos saca del panel a todo
 * el personal cada vez que Auth parpadea.
 *
 * Solo se considera «sesión inválida» lo que Auth dice de forma explícita (la falta de sesión, un JWT rechazado, un 4xx de
 * su API). Todo lo demás —error de red, 5xx o gateway (el SDK lo devuelve como `AuthRetryableFetchError`), respuesta que no
 * es JSON (`AuthUnknownError`), 408/429, una excepción que no es de Auth— es recuperable: ante la duda, no se cierra la sesión.
 */
export function isInvalidSessionError(error: unknown): boolean {
  if (!isAuthError(error)) return false;
  if (error.name === "AuthSessionMissingError" || error.name === "AuthInvalidJwtError") return true;
  if (!isAuthApiError(error)) return false;
  return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}

/** Hay un error de Auth y NO prueba que la sesión sea inválida: infraestructura caída o lenta; se reintenta. */
export function isTransientAuthError(error: unknown): boolean {
  return error !== null && error !== undefined && !isInvalidSessionError(error);
}
