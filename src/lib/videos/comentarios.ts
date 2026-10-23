import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/analitica/registrar";
import { clientIpFrom, clientSecret } from "@/lib/llamados/client-key";
import { isToken } from "@/lib/mesas/url";
import type { Database } from "@/lib/supabase/database.types";
import { hmac } from "./likes";
import { MAX_ALIAS_LENGTH, MAX_COMMENT_LENGTH, lengthOf, normalizeText, parseComment, type ParsedComment, type PublicComment } from "./texto-comentario";

export { MAX_ALIAS_LENGTH, MAX_COMMENT_LENGTH, lengthOf, normalizeText, parseComment };
export type { ParsedComment, PublicComment };

/**
 * Comentarios con aprobación previa del feed (ficha comentarios-del-feed, ADR 0031). La autoridad es `submit_video_comment` (la única
 * puerta de alta de `video_comments`) y la política de lectura pública (solo aprobados de videos públicos): este módulo normaliza el
 * texto, arma la clave de conexión que la base espera, llama a la función con el cliente anónimo y lee su respuesta.
 *
 * Nada que identifique al comensal llega a la base: ni el dispositivo ni la IP cruda. Solo el HMAC de la IP (`rate_key`, con su propio
 * prefijo para no cruzarse con los likes), que la base borra a la hora.
 */

type Db = SupabaseClient<Database>;

/** Comentarios aprobados por página en el feed. */
export const COMMENTS_PAGE_SIZE = 20;
/** Hasta dónde se pagina (los comentarios más viejos de un video muy comentado dejan de ofrecerse). */
const MAX_OFFSET = 500;

/** El `rate_key` de la conexión del pedido, o `null` si no hay una IP utilizable (entonces no hay límite por conexión). */
export function commentRateKeyFrom(headers: { get(name: string): string | null }, secret: string = clientSecret()): string | null {
  const ip = clientIpFrom(headers);
  return ip ? hmac(secret, "comment-ip", ip) : null;
}

export type CommentResult =
  /** Quedó pendiente de aprobación (o ya estaba, si fue un reenvío). */
  | { status: "ok" }
  | { status: "invalid" }
  | { status: "queue_full" }
  | { status: "rate_limited"; retryAfterSeconds: number }
  /** La cuenta de la mesa ya se atendió después de este ticket: hay que escanear de nuevo. */
  | { status: "session_closed" }
  | { status: "unavailable" }
  | { status: "not_found" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Lee la respuesta de la función. Cualquier forma inesperada es «no disponible» (falla cerrado). */
export function parseCommentResult(raw: unknown): CommentResult {
  if (!isRecord(raw)) return { status: "unavailable" };
  switch (raw.status) {
    case "ok":
    case "invalid":
    case "queue_full":
    case "session_closed":
    case "unavailable":
    case "not_found":
      return { status: raw.status };
    case "rate_limited": {
      const seconds = raw.retry_after_seconds;
      return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 1 ? { status: "rate_limited", retryAfterSeconds: Math.ceil(seconds) } : { status: "unavailable" };
    }
    default:
      return { status: "unavailable" };
  }
}

/**
 * Deja un comentario pendiente de aprobación. Entra con el cliente `anon`. Un token o un video imposibles no llegan a la base. Cualquier
 * error de red o de la base es «no disponible» para el comensal y se registra SIN IP, token, claves ni texto.
 */
export async function submitVideoComment(
  db: Db,
  token: unknown,
  videoId: unknown,
  comment: { body: string; alias: string | null },
  rateKey: string | null,
  visitStartedAt: Date | null = null,
): Promise<CommentResult> {
  if (!isToken(token) || !isUuid(videoId)) return { status: "not_found" };

  try {
    const { data, error } = await db.rpc("submit_video_comment", {
      p_token: token,
      p_video: videoId,
      p_body: comment.body,
      ...(comment.alias ? { p_alias: comment.alias } : {}),
      ...(rateKey ? { p_rate: rateKey } : {}),
      ...(visitStartedAt ? { p_visit_started_at: visitStartedAt.toISOString() } : {}),
    });
    if (error) {
      console.error(`submit_video_comment falló (${error.code ?? "sin código"}): ${error.message}`);
      return { status: "unavailable" };
    }
    return parseCommentResult(data);
  } catch (error) {
    console.error(`submit_video_comment falló: ${error instanceof Error ? error.message : "error desconocido"}`);
    return { status: "unavailable" };
  }
}


export type CommentsPage = { comments: PublicComment[]; hasMore: boolean };

const isPublicComment = (row: unknown): row is PublicComment =>
  isRecord(row) && typeof row.id === "string" && typeof row.body === "string" && typeof row.created_at === "string" && (row.alias === null || typeof row.alias === "string");

/**
 * Los comentarios aprobados de un video, los más nuevos primero. La política de lectura de la base decide qué se ve (aprobado, de un
 * video público, con el feed vigente): por eso no se filtra por estado acá. Lanza si la base falla.
 */
export async function loadApprovedComments(db: Db, videoId: unknown, offset: unknown = 0): Promise<CommentsPage> {
  if (!isUuid(videoId)) return { comments: [], hasMore: false };
  const from = typeof offset === "number" && Number.isInteger(offset) ? Math.min(Math.max(offset, 0), MAX_OFFSET) : 0;
  const { data, error } = await db
    .from("video_comments")
    .select("id, alias, body, created_at")
    .eq("video_id", videoId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + COMMENTS_PAGE_SIZE);
  if (error) throw new Error(`No se pudieron leer los comentarios: ${error.message}`);
  const rows = (data ?? []).filter(isPublicComment);
  return { comments: rows.slice(0, COMMENTS_PAGE_SIZE), hasMore: rows.length > COMMENTS_PAGE_SIZE && from + COMMENTS_PAGE_SIZE < MAX_OFFSET };
}
