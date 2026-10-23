"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from "react";
import { loadVideoCommentsAction, submitVideoCommentAction } from "@/app/t/[token]/videos/actions";
import type { LikeAccess } from "@/components/menu/like-button";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import { lengthOf, MAX_ALIAS_LENGTH, MAX_COMMENT_LENGTH, normalizeText, type PublicComment } from "@/lib/videos/texto-comentario";

/** Desde la mesa: el token y el ticket de visita emitido al abrir la pantalla. Sin esto (link directo) solo se leen los comentarios. */
export type CommentAccess = LikeAccess;

const circle = "grid size-11 shrink-0 place-items-center rounded-full bg-black/55 backdrop-blur-sm";
const countClass = "text-sm leading-none font-semibold tabular-nums text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.8)]";
const fieldClass =
  "w-full rounded-xl border-[1.5px] border-black/30 bg-white px-3 py-2 text-base text-black placeholder:text-black/55 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-black";

function BubbleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-7.5L7 20v-3.5H5A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5Z" />
    </svg>
  );
}

/**
 * El botón de comentarios de un video, en la columna de botones del feed. Desde la mesa aparece siempre (hay algo que escribir); sin mesa,
 * solo si ya hay comentarios aprobados que leer.
 */
export function CommentsButton({ count, canWrite, open, onClick, lang, buttonRef }: { count: number; canWrite: boolean; open: boolean; onClick: () => void; lang: Lang; buttonRef?: Ref<HTMLButtonElement> }) {
  const t = TEXTOS[lang].feed;
  if (!canWrite && count <= 0) return null;
  return (
    <div className="flex flex-col items-center gap-1" data-testid="feed-comentarios">
      <button
        type="button"
        ref={buttonRef}
        onClick={onClick}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t.comments}
        data-testid="feed-comentarios-boton"
        className={`${circle} cursor-pointer text-white hover:bg-black/70 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white`}
      >
        <BubbleIcon />
      </button>
      {count > 0 ? (
        <span className={countClass} data-testid="feed-comentarios-cantidad">
          <span aria-hidden="true">{count}</span>
          <span className="sr-only">{t.commentsCount(count)}</span>
        </span>
      ) : null}
    </div>
  );
}

function formatDate(iso: string, lang: Lang): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(lang === "pt" ? "pt-BR" : lang, { day: "numeric", month: "short" });
}

/**
 * La hoja de comentarios de un video (ficha comentarios-del-feed): los aprobados, más nuevos primero y por páginas, y, solo desde la
 * mesa con el comentario habilitado, el formulario. Lo enviado NO aparece: queda pendiente hasta que el local lo apruebe, y la hoja lo
 * dice. Las teclas de adentro no llegan al feed (las flechas mueven el cursor del texto, no el video; Escape cierra la hoja).
 */
export function CommentsSheet({ videoId, access, lang, hasBar, onClose }: { videoId: string; access: CommentAccess | null; lang: Lang; hasBar: boolean; onClose: () => void }) {
  const t = TEXTOS[lang].feed;
  const sheet = useRef<HTMLDivElement>(null);
  const [comments, setComments] = useState<PublicComment[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [alias, setAlias] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const canWrite = access !== null && !expired;

  async function loadPage(offset: number) {
    setLoading(true);
    setLoadError(null);
    try {
      const page = await loadVideoCommentsAction({ video: videoId, offset, lang });
      if (page.ok) {
        // Si entró un comentario nuevo mientras tanto, la página siguiente puede repetir uno: se descartan los ya vistos.
        setComments((current) => {
          const seen = new Set(current.map((comment) => comment.id));
          return [...current, ...page.comments.filter((comment) => !seen.has(comment.id))];
        });
        setHasMore(page.hasMore);
      } else {
        setLoadError(page.message);
      }
    } catch {
      setLoadError(t.commentsLoadError);
    } finally {
      setLoading(false);
    }
  }

  // La primera página se pide al abrir la hoja (el estado inicial ya es «cargando»).
  useEffect(() => {
    sheet.current?.focus();
    let cancelled = false;
    loadVideoCommentsAction({ video: videoId, offset: 0, lang })
      .then((page) => {
        if (cancelled) return;
        if (page.ok) {
          setComments(page.comments);
          setHasMore(page.hasMore);
        } else {
          setLoadError(page.message);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(t.commentsLoadError);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [videoId, lang, t.commentsLoadError]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Nada de lo que se teclea acá mueve el feed ni lo cierra.
    event.stopPropagation();
    if (event.key === "Escape") onClose();
  }

  const used = lengthOf(normalizeText(body));
  const tooLong = used > MAX_COMMENT_LENGTH;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!access || sending || used === 0 || tooLong) return;
    setSending(true);
    setError(null);
    setSent(false);
    try {
      const result = await submitVideoCommentAction({ token: access.token, video: videoId, body, alias, ticket: access.ticket, lang });
      if (result.ok) {
        setBody("");
        setSent(true);
      } else {
        setError(result.message);
        if (result.expired) setExpired(true);
      }
    } catch {
      setError(t.commentError);
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      ref={sheet}
      role="dialog"
      aria-modal="false"
      aria-label={t.comments}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-testid="feed-comentarios-hoja"
      className={`absolute inset-x-0 bottom-0 z-30 flex max-h-[78%] flex-col rounded-t-3xl bg-white text-black shadow-2xl outline-none ${hasBar ? "pb-2" : "pb-[max(0.75rem,env(safe-area-inset-bottom))]"}`}
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
        <h3 className="font-display text-2xl leading-tight">{t.comments}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.closeComments}
          data-testid="feed-comentarios-cerrar"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-black/10 text-black hover:bg-black/15 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-3" data-testid="feed-comentarios-lista">
        {comments.length > 0 ? (
          <ul className="grid gap-3">
            {comments.map((comment) => (
              <li key={comment.id} data-testid="feed-comentario" className="min-w-0">
                <p className="text-sm text-black/65">
                  <span className="font-semibold text-black">{comment.alias ?? t.anonymous}</span> · {formatDate(comment.created_at, lang)}
                </p>
                <p className="mt-0.5 text-base leading-snug [overflow-wrap:anywhere]">{comment.body}</p>
              </li>
            ))}
          </ul>
        ) : loading ? null : loadError ? null : (
          <p className="text-base text-black/70" data-testid="feed-comentarios-vacio">
            {t.commentsEmpty}
          </p>
        )}
        {loading ? (
          <p role="status" className="py-2 text-base text-black/70">
            {t.commentsLoading}
          </p>
        ) : null}
        {loadError ? (
          <p role="alert" className="py-2 text-base text-black/80" data-testid="feed-comentarios-error-carga">
            {loadError}
          </p>
        ) : null}
        {hasMore && !loading ? (
          <button
            type="button"
            onClick={() => loadPage(comments.length)}
            data-testid="feed-comentarios-mas"
            className="mt-3 inline-flex min-h-11 items-center rounded-full border-[1.5px] border-black px-5 text-base font-semibold hover:bg-black/5 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            {t.commentsMore}
          </button>
        ) : null}
      </div>

      {canWrite ? (
        <form onSubmit={submit} className="grid gap-3 border-t border-black/15 px-5 pt-3" data-testid="feed-comentarios-form">
          <div>
            <label htmlFor={`alias-${videoId}`} className="text-sm font-semibold">
              {t.commentAliasLabel}
            </label>
            <input
              id={`alias-${videoId}`}
              type="text"
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              maxLength={MAX_ALIAS_LENGTH}
              autoComplete="off"
              enterKeyHint="next"
              data-testid="feed-comentarios-alias"
              className={`${fieldClass} mt-1`}
            />
          </div>
          <div>
            <label htmlFor={`comentario-${videoId}`} className="text-sm font-semibold">
              {t.commentBodyLabel}
            </label>
            <textarea
              id={`comentario-${videoId}`}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={3}
              placeholder={t.commentPlaceholder}
              aria-describedby={`contador-${videoId}`}
              aria-invalid={tooLong}
              data-testid="feed-comentarios-texto"
              className={`${fieldClass} mt-1 resize-none`}
            />
            <p id={`contador-${videoId}`} className={`mt-1 text-right text-sm tabular-nums ${tooLong ? "font-semibold text-[#b3261e]" : "text-black/65"}`} data-testid="feed-comentarios-contador">
              {t.commentCounter(used, MAX_COMMENT_LENGTH)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={sending || used === 0 || tooLong}
              data-testid="feed-comentarios-enviar"
              className="inline-flex min-h-11 items-center rounded-full bg-black px-6 text-base font-semibold text-white hover:bg-black/85 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? t.commentSending : t.commentSend}
            </button>
          </div>
          {sent ? (
            <p role="status" className="text-base font-medium" data-testid="feed-comentarios-enviado">
              {t.commentSent}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-base font-medium text-[#b3261e]" data-testid="feed-comentarios-error">
              {error}
            </p>
          ) : null}
        </form>
      ) : error ? (
        <p role="alert" className="border-t border-black/15 px-5 pt-3 text-base font-medium" data-testid="feed-comentarios-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
