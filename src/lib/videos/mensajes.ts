import type { Entitlements } from "@/lib/entitlements";
import { MAX_TITLE_LENGTH } from "./estado";

/** Todo lo que puede salir mal al gestionar videos. Los mensajes dependen del estado de la cuenta cuando hace falta. */
export type VideoError =
  | "title_blank"
  | "title_too_long"
  | "limit" // cupo de videos publicados del plan (53400)
  | "feature" // el plan no incluye el feed (42501 feature_unavailable)
  | "cap" // tope técnico de videos por organización (54000)
  | "not_ready" // se quiso publicar uno que no terminó de procesarse (23514)
  | "product_invalid" // el plato elegido no es de este local (23503)
  | "deleting_final" // un video que se está borrando ya no cambia (55000)
  | "blocked_read_only"
  | "blocked_suspended"
  | "forbidden"
  | "not_found"
  | "mux_pending" // salió de la lista pero falta borrar el asset en el servicio de video
  | "uncertain"
  | "unexpected";

export const MAX_VIDEOS_PER_ORGANIZATION = 50;

const STATIC_MESSAGE: Record<Exclude<VideoError, "limit">, string> = {
  title_blank: "Escribí un nombre para el video.",
  title_too_long: `El nombre puede tener hasta ${MAX_TITLE_LENGTH} caracteres.`,
  feature: "Tu plan no incluye el feed de videos. Tus videos se conservan.",
  cap: `Llegaste al máximo de ${MAX_VIDEOS_PER_ORGANIZATION} videos (contando borradores y los que se están borrando). Borrá alguno para seguir.`,
  not_ready: "Este video todavía no terminó de procesarse: no se puede publicar hasta que esté listo.",
  product_invalid: "Elegí un plato de tu carta.",
  deleting_final: "Este video se está borrando: ya no se puede cambiar.",
  blocked_read_only: "Tu cuenta está en solo lectura: no se pueden cambiar los videos hasta regularizar el pago. No se guardó ningún cambio.",
  blocked_suspended: "La cuenta está suspendida: no se pueden cambiar los videos hasta regularizar el pago. No se guardó ningún cambio.",
  forbidden: "No tenés permiso para cambiar los videos de este local.",
  not_found: "No encontramos ese video. Puede que ya no exista: recargá la página.",
  mux_pending:
    "El video ya no aparece, pero todavía falta borrarlo del servicio de video. Quedó en «Eliminando»: podés reintentar el borrado desde la lista.",
  uncertain: "No pudimos confirmar si el cambio se guardó. Recargá la página y mirá cómo quedó antes de repetirlo.",
  unexpected: "No se pudo completar la acción. Probá de nuevo en unos minutos.",
};

/** El número del cupo sale de `org_entitlements` (vive en la base), nunca del texto del error. */
export function videoErrorMessage(error: VideoError, ent: Entitlements | null): string {
  if (error !== "limit") return STATIC_MESSAGE[error];
  const limit = ent?.limits.videos_published;
  return typeof limit === "number"
    ? `Llegaste al máximo de ${limit} videos publicados de tu plan. Despublicá uno para poder publicar este.`
    : "Llegaste al máximo de videos publicados de tu plan. Despublicá uno para poder publicar este.";
}

/** Por qué no se puede escribir hoy (o `null`). Falla cerrado si no se pudo leer el estado. */
export function writeBlock(ent: Entitlements | null): VideoError | null {
  if (!ent) return "unexpected";
  if (ent.canWrite) return null;
  return ent.state === "suspended" ? "blocked_suspended" : "blocked_read_only";
}

type PgError = { code?: string; message?: string };

/**
 * Traduce un error de la base. `context` distingue qué significa un `CHECK` (23514): publicar algo sin procesar o un título
 * inválido. Sin código es la red: el resultado es incierto, el cambio pudo quedar hecho.
 */
export function videoErrorFromDb(error: PgError, context: "publish" | "title" | "other" = "other"): VideoError {
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (code === "") return "uncertain";
  if (code === "53400") return "limit";
  if (code === "54000") return "cap";
  if (code === "42501") return message.includes("feature_unavailable") ? "feature" : "forbidden";
  if (code === "55000" && message.includes("video_deleting_is_final")) return "deleting_final";
  if (code === "23503") return "product_invalid";
  if (code === "23514") return context === "publish" ? "not_ready" : context === "title" ? "title_blank" : "unexpected";
  return "unexpected";
}
