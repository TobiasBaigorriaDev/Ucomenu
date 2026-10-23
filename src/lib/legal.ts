/**
 * Datos compartidos de los textos legales (`/terminos`, `/privacidad`, `/alergenos`).
 *
 * `LEGAL_UPDATED_AT` se actualiza a mano cada vez que cambia el contenido de alguna de las tres páginas.
 * El contacto sale de `NEXT_PUBLIC_CONTACT_EMAIL`: sin definir, las páginas no inventan uno (ver checklist de «Salida a
 * producción» en el tablero).
 */

export const LEGAL_UPDATED_AT = "23 de octubre de 2026";

/** Días que se conserva el identificador de cliente de un llamado (ADR 0014: es el plazo de `purge_waiter_calls`). */
export const WAITER_CALL_RETENTION_DAYS = 14;

export function contactEmail(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}
