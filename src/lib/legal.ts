/**
 * Datos compartidos de los textos legales (`/terminos`, `/privacidad`, `/alergenos`).
 *
 * `LEGAL_VERSION` se actualiza a mano al cambiar los textos; de ella salen la fecha pública y la versión aceptada en el alta.
 * El contacto publicado es el aprobado por el responsable; `NEXT_PUBLIC_CONTACT_EMAIL` permite cambiarlo por entorno.
 */

export const LEGAL_VERSION = "2026-11-04";
export const LEGAL_UPDATED_AT = new Intl.DateTimeFormat("es-AR", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
}).format(new Date(`${LEGAL_VERSION}T00:00:00Z`));

/**
 * Responsable de UcoMenú (Ley 25.326, art. 6). Datos autorizados para su publicación por el titular el 2026-11-04.
 */
export type LegalEntity = { name: string; taxId: string; address: string };
export const LEGAL_ENTITY: LegalEntity | null = {
  name: "Tobias Ezequiel Baigorria Bruna",
  taxId: "20465498545",
  address: "9 de Julio, casa 263, centro, Tupungato, Mendoza, Argentina",
};
export const LEGAL_CONTACT_EMAIL = "uconext.digital@gmail.com";

/** Días que se conserva el identificador de cliente de un llamado (ADR 0014: es el plazo de `purge_waiter_calls`). */
export const WAITER_CALL_RETENTION_DAYS = 14;

/**
 * Días que se conservan los datos de una reserva (nombre, teléfono, email y nota) después de terminada: es el plazo con que se
 * programa `purge_expired_reservations` (`docs/produccion.md`, paso 4.d) y el que dice la política de privacidad.
 */
export const RESERVATION_RETENTION_DAYS = 30;

/**
 * Cuánto se conservan las copias de seguridad propias: 7 diarias, 4 semanales y 3 mensuales (`docs/operacion.md`, sección 2), es decir,
 * hasta 3 meses. Lo dice la política de privacidad: un dato borrado puede seguir en una copia hasta ese plazo.
 */
export const BACKUP_RETENTION_MONTHS = 3;
export const AUDIT_RETENTION_YEARS = 10;

export function contactEmail(env: Record<string, string | undefined> = process.env): string | null {
  // La forma literal se incrusta al construir: en el contenedor las NEXT_PUBLIC_* no existen como variables de ejecución.
  const value = (env.NEXT_PUBLIC_CONTACT_EMAIL ??
    (env === process.env ? process.env.NEXT_PUBLIC_CONTACT_EMAIL : undefined) ?? LEGAL_CONTACT_EMAIL).trim();
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}
