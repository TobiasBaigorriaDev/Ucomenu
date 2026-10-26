/**
 * Datos compartidos de los textos legales (`/terminos`, `/privacidad`, `/alergenos`).
 *
 * `LEGAL_UPDATED_AT` se actualiza a mano cada vez que cambia el contenido de alguna de las tres páginas.
 * El contacto sale de `NEXT_PUBLIC_CONTACT_EMAIL`: sin definir, las páginas no inventan uno (ver checklist de «Salida a
 * producción» en el tablero).
 */

export const LEGAL_UPDATED_AT = "26 de octubre de 2026";

/**
 * Responsable de UcoMenu (Ley 25.326, art. 6: la política tiene que decir quién es el responsable del archivo). PENDIENTE DE
 * DECISIÓN DEL USUARIO: no se inventa razón social, CUIT ni domicilio. Mientras sea `null`, las páginas muestran que el dato
 * está pendiente y `docs/produccion.md` bloquea la salida a producción. Se completa acá, con los datos reales, al decidirlos.
 */
export type LegalEntity = { name: string; taxId: string; address: string };
export const LEGAL_ENTITY: LegalEntity | null = null;

/** Días que se conserva el identificador de cliente de un llamado (ADR 0014: es el plazo de `purge_waiter_calls`). */
export const WAITER_CALL_RETENTION_DAYS = 14;

export function contactEmail(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}
