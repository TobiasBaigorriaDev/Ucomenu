"use server";

import { headers } from "next/headers";
import { BASE_LANG, isLang, type Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import { verifyVisitTicket } from "@/lib/llamados/visit-ticket";
import { isToken } from "@/lib/mesas/url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public-client";
import { commentRateKeyFrom, loadApprovedComments, parseComment, submitVideoComment, type CommentsPage } from "@/lib/videos/comentarios";
import { deviceKeyFrom, rateKeyFrom, setVideoLike } from "@/lib/videos/likes";

/**
 * «Me gusta» desde `/t/{token}/videos` (ficha likes-del-feed). Es una escritura PÚBLICA sin sesión: la autoridad es el token de la
 * mesa y la regla está toda en `set_video_like`. Esta acción valida el formato, comprueba el ticket de visita (que la pestaña no
 * sea vieja: sin ticket vigente atado a ESTA mesa no se llega a la base), arma las claves (HMAC del código del navegador y de la IP:
 * nunca los valores crudos) y traduce el resultado a un mensaje. Llama a la base con `service_role`: la función solo la ejecuta
 * esa clave (ADR 0038), así que esta acción es la única puerta y nadie puede omitir el ticket ni la clave de conexión.
 */

export type LikeActionResult =
  | { ok: true; liked: boolean; count: number }
  /** `expired`: el ticket venció o la cuenta ya se atendió; la pantalla deja de ofrecer el botón. */
  | { ok: false; message: string; expired?: boolean };

export async function setVideoLikeAction(input: {
  token: unknown;
  video: unknown;
  liked: unknown;
  device: unknown;
  ticket: unknown;
  lang: unknown;
}): Promise<LikeActionResult> {
  const lang: Lang = isLang(input.lang) ? input.lang : BASE_LANG;
  const t = TEXTOS[lang];
  const failure = (message: string): LikeActionResult => ({ ok: false, message });

  if (!isToken(input.token) || typeof input.liked !== "boolean") return failure(t.feed.likeError);

  const ticket = verifyVisitTicket(input.token, input.ticket);
  if (!ticket.ok) return { ok: false, message: t.call.expired, expired: true };

  const result = await setVideoLike(
    createAdminClient(),
    input.token,
    input.video,
    input.liked,
    deviceKeyFrom(input.device),
    rateKeyFrom(await headers()),
    ticket.issuedAt,
  );

  switch (result.status) {
    case "ok":
      return { ok: true, liked: result.liked, count: result.count };
    case "session_closed":
      return { ok: false, message: t.call.expired, expired: true };
    case "rate_limited":
      return failure(t.call.rateLimited(Math.max(1, Math.ceil(result.retryAfterSeconds / 60))));
    default:
      return failure(t.feed.likeError);
  }
}

export type CommentActionResult =
  | { ok: true }
  /** `expired`: el ticket venció o la cuenta ya se atendió; la pantalla deja de ofrecer el formulario. */
  | { ok: false; message: string; expired?: boolean };

/**
 * Deja un comentario desde `/t/{token}/videos` (ficha comentarios-del-feed). Escritura PÚBLICA sin sesión: la autoridad es el token de
 * la mesa y la regla está toda en `submit_video_comment`. Esta acción comprueba el ticket de visita, normaliza el texto (un solo renglón,
 * sin invisibles), arma la clave de conexión (HMAC de la IP: nunca la IP) y traduce el resultado a un mensaje. El comentario NO se
 * publica: queda pendiente hasta que el Dueño o el Staff lo aprueben. Llama a la base con `service_role`: la función solo la ejecuta esa
 * clave (ADR 0038), así que esta acción es la única puerta y nadie puede omitir el ticket ni la clave de conexión.
 */
export async function submitVideoCommentAction(input: {
  token: unknown;
  video: unknown;
  body: unknown;
  alias: unknown;
  ticket: unknown;
  lang: unknown;
}): Promise<CommentActionResult> {
  const lang: Lang = isLang(input.lang) ? input.lang : BASE_LANG;
  const t = TEXTOS[lang];
  const failure = (message: string): CommentActionResult => ({ ok: false, message });

  if (!isToken(input.token)) return failure(t.feed.commentError);

  const ticket = verifyVisitTicket(input.token, input.ticket);
  if (!ticket.ok) return { ok: false, message: t.call.expired, expired: true };

  const comment = parseComment(input.body, input.alias);
  if (!comment.ok) return failure(t.feed.commentInvalid);

  const result = await submitVideoComment(createAdminClient(), input.token, input.video, comment, commentRateKeyFrom(await headers()), ticket.issuedAt);

  switch (result.status) {
    case "ok":
      return { ok: true };
    case "session_closed":
      return { ok: false, message: t.call.expired, expired: true };
    case "rate_limited":
      return failure(t.feed.commentRateLimited(Math.max(1, Math.ceil(result.retryAfterSeconds / 60))));
    case "invalid":
      return failure(t.feed.commentInvalid);
    case "queue_full":
      return failure(t.feed.commentQueueFull);
    default:
      return failure(t.feed.commentError);
  }
}

export type LoadCommentsResult = ({ ok: true } & CommentsPage) | { ok: false; message: string };

/**
 * Los comentarios aprobados de un video, para la hoja de comentarios (desde la mesa y desde el link directo). Es lectura pública:
 * la política de la base decide qué se ve, así que no hace falta ticket.
 */
export async function loadVideoCommentsAction(input: { video: unknown; offset: unknown; lang: unknown }): Promise<LoadCommentsResult> {
  const lang: Lang = isLang(input.lang) ? input.lang : BASE_LANG;
  try {
    return { ok: true, ...(await loadApprovedComments(createPublicClient(), input.video, input.offset)) };
  } catch (error) {
    console.error(`No se pudieron leer los comentarios: ${error instanceof Error ? error.message : "error desconocido"}`);
    return { ok: false, message: TEXTOS[lang].feed.commentsLoadError };
  }
}
