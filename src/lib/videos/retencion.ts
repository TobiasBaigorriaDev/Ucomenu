/**
 * Plazos de retención de los comentarios del feed (ficha comentarios-del-feed, ADR 0031). Módulo PURO: lo usan la pantalla de
 * moderación y la política de privacidad, y tienen que coincidir con los valores por defecto de `purge_video_comments` (base) y con la
 * tarea programada de `docs/produccion.md` (paso 4.b).
 */

/** Días que se conserva un comentario rechazado antes de que la purga lo borre. */
export const REJECTED_RETENTION_DAYS = 7;
/** Días que espera un comentario sin moderar antes de que la purga lo borre. */
export const PENDING_RETENTION_DAYS = 30;
