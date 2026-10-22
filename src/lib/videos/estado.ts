/**
 * Estados y reglas puras de los videos del feed (ficha videos-del-panel-base, ADR 0031). Son los mismos valores que
 * `menu_videos` en la base; la base es la autoridad, esto solo arma la pantalla.
 */

export type VideoStatus = "draft" | "published" | "deleting";
export type MuxStatus = "awaiting_upload" | "processing" | "ready" | "errored";

export type VideoRow = {
  id: string;
  product_id: string | null;
  title: string;
  status: VideoStatus;
  mux_status: MuxStatus;
  mux_playback_id: string | null;
  duration_seconds: number | null;
  sort_order: number;
  created_at: string;
};

/** Columnas que Dueño y Staff pueden leer (los identificadores internos de Mux no se les conceden). */
export const VIDEO_COLUMNS = "id, product_id, title, status, mux_status, mux_playback_id, duration_seconds, sort_order, created_at";

/** Mismo largo que el `check` de la base. */
export const MAX_TITLE_LENGTH = 80;

export const MUX_STATUS_LABEL: Record<MuxStatus, string> = {
  awaiting_upload: "Esperando el archivo",
  processing: "Procesando",
  ready: "Listo",
  errored: "Con error",
};

export const STATUS_LABEL: Record<VideoStatus, string> = {
  draft: "Borrador",
  published: "Publicado",
  deleting: "Eliminando",
};

/** ¿Se puede publicar? Un borrador ya procesado. La base vuelve a comprobarlo (y el cupo). */
export const canPublish = (video: Pick<VideoRow, "status" | "mux_status">): boolean =>
  video.status === "draft" && video.mux_status === "ready";

/** ¿Se puede despublicar? Solo uno publicado. */
export const canUnpublish = (video: Pick<VideoRow, "status">): boolean => video.status === "published";

export type TitleProblem = "blank" | "too_long";

/** Nombre del video: de 1 a 80 caracteres sin contar los espacios de los bordes. */
export function parseTitle(raw: unknown): { ok: true; title: string } | { ok: false; problem: TitleProblem } {
  const title = typeof raw === "string" ? raw.trim() : "";
  if (title === "") return { ok: false, problem: "blank" };
  if ([...title].length > MAX_TITLE_LENGTH) return { ok: false, problem: "too_long" };
  return { ok: true, title };
}

/** `0:12` para 12,5 segundos. Sin duración (todavía no procesado), `null`. */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Cupo de videos publicados para mostrar: «3 de 10» o «3 (sin límite)». Sin datos de la cuenta, `null`. */
export function quotaText(used: number | undefined, limit: number | null | undefined): string | null {
  if (typeof used !== "number" || limit === undefined) return null;
  return limit === null ? `${used} (sin límite)` : `${used} de ${limit}`;
}
