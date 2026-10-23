"use server";

import { headers } from "next/headers";
import { BASE_LANG, isLang, type Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import { verifyVisitTicket } from "@/lib/llamados/visit-ticket";
import { isToken } from "@/lib/mesas/url";
import { createPublicClient } from "@/lib/supabase/public-client";
import { deviceKeyFrom, rateKeyFrom, setVideoLike } from "@/lib/videos/likes";

/**
 * «Me gusta» desde `/t/{token}/videos` (ficha likes-del-feed). Es una escritura PÚBLICA sin sesión: la autoridad es el token de la
 * mesa y la regla está toda en `set_video_like`. Esta acción valida el formato, comprueba el ticket de visita (que la pestaña no
 * sea vieja: sin ticket vigente atado a ESTA mesa no se llega a la base), arma las claves (HMAC del código del navegador y de la IP:
 * nunca los valores crudos) y traduce el resultado a un mensaje. No usa `service_role`.
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
    createPublicClient(),
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
