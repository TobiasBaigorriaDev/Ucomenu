"use client";

import { useState, useSyncExternalStore } from "react";
import { setVideoLikeAction } from "@/app/t/[token]/videos/actions";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import { deviceCode, getLikes, getServerLikes, rememberLike, subscribeLikes } from "@/lib/videos/likes-local";

/** Desde la mesa: el token y el ticket de visita emitido al abrir la pantalla. Sin esto (link directo) el corazón es solo el conteo. */
export type LikeAccess = { token: string; ticket: string };

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20.5s-7.5-4.6-7.5-10.3A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.6c0 5.7-7.5 10.3-7.5 10.3Z" />
    </svg>
  );
}

const circle = "grid size-11 shrink-0 place-items-center rounded-full bg-black/55 backdrop-blur-sm";
const countClass = "text-sm leading-none font-semibold tabular-nums text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.8)]";

/**
 * El corazón de un video (ficha likes-del-feed). Con acceso desde la mesa es un botón: responde de inmediato, la base decide y,
 * si falla, vuelve atrás y avisa. Sin acceso es solo el conteo (y no aparece con 0). Lo que recuerda el dispositivo vive en
 * `likes-local` y se crea recién al primer toque.
 */
export function LikeControl({ videoId, initialCount, access, lang }: { videoId: string; initialCount: number; access: LikeAccess | null; lang: Lang }) {
  const t = TEXTOS[lang].feed;
  const stored = useSyncExternalStore(subscribeLikes, getLikes, getServerLikes);
  const liked = stored.liked.includes(videoId);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  if (!access || expired) {
    if (count <= 0 && !message) return null;
    return (
      <div className="relative flex flex-col items-center gap-1" data-testid="feed-likes">
        {count > 0 ? (
          <>
            <span className={`${circle} ${liked ? "text-[#ff5a6e]" : "text-white"}`} aria-hidden="true">
              <Heart filled={liked} />
            </span>
            <span className={countClass} data-testid="feed-likes-cantidad">
              <span aria-hidden="true">{count}</span>
              <span className="sr-only">{t.likeCount(count)}</span>
            </span>
          </>
        ) : null}
        {message ? <Notice message={message} /> : null}
      </div>
    );
  }

  async function toggle() {
    if (busy || !access) return;
    const next = !liked;
    const before = count;
    const device = deviceCode();
    setBusy(true);
    setMessage(null);
    rememberLike(videoId, next);
    setCount(Math.max(0, before + (next ? 1 : -1)));
    try {
      const result = await setVideoLikeAction({ token: access.token, video: videoId, liked: next, device, ticket: access.ticket, lang });
      if (result.ok) {
        rememberLike(videoId, result.liked);
        setCount(result.count);
      } else {
        rememberLike(videoId, !next);
        setCount(before);
        setMessage(result.message);
        if (result.expired) setExpired(true);
      }
    } catch {
      rememberLike(videoId, !next);
      setCount(before);
      setMessage(t.likeError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex flex-col items-center gap-1" data-testid="feed-likes">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={liked}
        aria-label={liked ? t.unlike : t.like}
        disabled={busy}
        data-testid="feed-like"
        className={`${circle} cursor-pointer hover:bg-black/70 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait ${liked ? "text-[#ff5a6e]" : "text-white"}`}
      >
        <Heart filled={liked} />
      </button>
      <span className={countClass} data-testid="feed-likes-cantidad">
        <span aria-hidden="true">{count}</span>
        <span className="sr-only">{t.likeCount(count)}</span>
      </span>
      {message ? <Notice message={message} /> : null}
    </div>
  );
}

function Notice({ message }: { message: string }) {
  return (
    <p role="status" data-testid="feed-likes-aviso" className="absolute top-full right-0 z-30 mt-2 w-56 rounded-2xl bg-black/80 px-3 py-2 text-sm leading-snug text-white">
      {message}
    </p>
  );
}
