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
  mux_error: MuxError | null;
  duration_seconds: number | null;
  sort_order: number;
  created_at: string;
};

/** Columnas que Dueño y Staff pueden leer (los identificadores internos de Mux no se les conceden). */
export const VIDEO_COLUMNS =
  "id, product_id, title, status, mux_status, mux_playback_id, mux_error, duration_seconds, sort_order, created_at";

/** Mismo largo que el `check` de la base. */
export const MAX_TITLE_LENGTH = 80;

/** 30 s de la regla de producto + 0,5 s de tolerancia por el redondeo con que Mux informa la duración (mismo tope que la base). */
export const MAX_VIDEO_SECONDS = 30.5;
/** 50 MB por archivo (regla de producto). Solo se valida en el navegador: Mux no informa ni limita el peso. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** La URL de subida de Mux vence a la hora; pasado ese tiempo una subida sin completar se da por vencida. */
export const UPLOAD_EXPIRY_MS = 60 * 60 * 1000;

export type MuxError = "too_long" | "no_playback" | "processing_failed" | "upload_failed";

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

/** ¿Una subida que nunca se completó? (la URL de Mux vence a la hora). */
export function isUploadExpired(video: Pick<VideoRow, "mux_status" | "status" | "created_at">, now: Date): boolean {
  return (
    video.status !== "deleting" &&
    video.mux_status === "awaiting_upload" &&
    now.getTime() - new Date(video.created_at).getTime() > UPLOAD_EXPIRY_MS
  );
}

/** ¿Hay algo que todavía va a cambiar solo (subiendo o procesando)? La pantalla se actualiza mientras tanto. */
export function hasPendingVideos(videos: Pick<VideoRow, "mux_status" | "status" | "created_at">[], now: Date): boolean {
  return videos.some(
    (video) => video.status !== "deleting" && (video.mux_status === "processing" || (video.mux_status === "awaiting_upload" && !isUploadExpired(video, now))),
  );
}

export const MUX_ERROR_LABEL: Record<MuxError, string> = {
  too_long: "Dura más de 30 segundos.",
  no_playback: "El servicio de video no lo dejó listo para reproducir.",
  processing_failed: "No se pudo procesar el archivo. Probá con otro video.",
  upload_failed: "La subida falló.",
};
