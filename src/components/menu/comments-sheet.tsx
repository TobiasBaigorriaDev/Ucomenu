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
  "w-full rounded-2xl border-[1.5px] border-ink/35 bg-porcelain px-3.5 py-2.5 text-base text-ink placeholder:text-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink";
/** Botones de la hoja: el mismo lenguaje que las celdas de «Llamar al mozo» (radio grande y colores de la paleta del local). */
const cellBase =
  "inline-flex min-h-12 items-center justify-center rounded-3xl px-5 py-2 text-base font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60";

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
 * mesa con el comentario habilitado, un botón «Escribir un comentario» que recién al tocarlo muestra el nombre (opcional) y el texto.
 * Lo enviado NO aparece: queda pendiente hasta que el local lo apruebe, y la hoja lo dice. Es una tarjeta flotante con la misma superficie
 * y el mismo radio que la barra de llamado y la tarjeta de «Ver plato». Las teclas de adentro no llegan al feed (las flechas mueven el
 * cursor del texto, no el video; Escape cierra el formulario y, sin él, la hoja).
 */
export function CommentsSheet({ videoId, access, lang, hasBar, onClose }: { videoId: string; access: CommentAccess | null; lang: Lang; hasBar: boolean; onClose: () => void }) {
  const t = TEXTOS[lang].feed;
  const sheet = useRef<HTMLDivElement>(null);
  const aliasField = useRef<HTMLInputElement>(null);
  const writeButton = useRef<HTMLButtonElement>(null);
  const [comments, setComments] = useState<PublicComment[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
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

  function startWriting() {
    setSent(false);
    setError(null);
    setComposing(true);
    // El campo recién existe después de este render.
    requestAnimationFrame(() => aliasField.current?.focus());
  }

  function stopWriting() {
    setComposing(false);
    setError(null);
    requestAnimationFrame(() => writeButton.current?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Nada de lo que se teclea acá mueve el feed ni lo cierra.
    event.stopPropagation();
    if (event.key !== "Escape") return;
    if (composing) stopWriting();
    else onClose();
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
        setComposing(false);
        requestAnimationFrame(() => writeButton.current?.focus());
      } else {
        setError(result.message);
        if (result.expired) {
          setExpired(true);
          setComposing(false);
        }
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
      className={`absolute inset-x-3 z-30 flex max-h-[80%] flex-col rounded-[1.75rem] bg-porcelain text-ink shadow-[0_10px_28px_-10px_rgb(0_0_0/0.5)] ring-1 ring-ink/15 outline-none ${hasBar ? "bottom-2" : "bottom-[max(0.75rem,env(safe-area-inset-bottom))]"}`}
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-1">
        <h3 className="font-display text-2xl leading-tight">{t.comments}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.closeComments}
          data-testid="feed-comentarios-cerrar"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-ink/10 text-ink hover:bg-ink/15 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-3" data-testid="feed-comentarios-lista">
        {comments.length > 0 ? (
          <ul className="divide-y divide-ink/10">
            {comments.map((comment) => (
              <li key={comment.id} data-testid="feed-comentario" className="min-w-0 py-3 first:pt-1">
                <p className="text-sm text-muted">
                  <span className="font-semibold text-ink">{comment.alias ?? t.anonymous}</span> · {formatDate(comment.created_at, lang)}
                </p>
                <p className="mt-0.5 text-base leading-snug [overflow-wrap:anywhere]">{comment.body}</p>
              </li>
            ))}
          </ul>
        ) : loading ? null : loadError ? null : (
          <p className="py-2 text-base text-muted" data-testid="feed-comentarios-vacio">
            {t.commentsEmpty}
          </p>
        )}
        {loading ? (
          <p role="status" className="py-2 text-base text-muted">
            {t.commentsLoading}
          </p>
        ) : null}
        {loadError ? (
          <p role="alert" className="py-2 text-base font-medium text-danger" data-testid="feed-comentarios-error-carga">
            {loadError}
          </p>
        ) : null}
        {loadError && !loading ? (
          <button type="button" onClick={() => loadPage(comments.length)} data-testid="feed-comentarios-reintentar" className={`${cellBase} mt-2 min-h-11 border-[1.5px] border-ink/40 text-ink hover:bg-ink/5`}>
            {t.commentsRetry}
          </button>
        ) : hasMore && !loading ? (
          <button type="button" onClick={() => loadPage(comments.length)} data-testid="feed-comentarios-mas" className={`${cellBase} mt-2 min-h-11 border-[1.5px] border-ink/40 text-ink hover:bg-ink/5`}>
            {t.commentsMore}
          </button>
        ) : null}
      </div>

      {canWrite && !composing ? (
        <div className="grid gap-2 border-t border-ink/10 p-2">
          {sent ? (
            <p role="status" className="px-3 pt-1 text-[0.9375rem] leading-snug font-medium" data-testid="feed-comentarios-enviado">
              {t.commentSent}
            </p>
          ) : null}
          <button type="button" ref={writeButton} onClick={startWriting} data-testid="feed-comentarios-escribir" className={`${cellBase} w-full bg-brand text-[var(--on-accent)] hover:opacity-90`}>
            {t.commentWrite}
          </button>
        </div>
      ) : null}

      {canWrite && composing ? (
        <form onSubmit={submit} className="grid gap-3 border-t border-ink/10 px-5 pt-3 pb-4" data-testid="feed-comentarios-form">
          <div>
            <label htmlFor={`alias-${videoId}`} className="text-sm font-semibold">
              {t.commentAliasLabel}
            </label>
            <input
              id={`alias-${videoId}`}
              ref={aliasField}
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
            <p id={`contador-${videoId}`} className={`mt-1 text-right text-sm tabular-nums ${tooLong ? "font-semibold text-danger" : "text-muted"}`} data-testid="feed-comentarios-contador">
              {t.commentCounter(used, MAX_COMMENT_LENGTH)}
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-[0.9375rem] leading-snug font-medium text-danger" data-testid="feed-comentarios-error">
              {error}
            </p>
          ) : null}
          <div className="grid grid-cols-[1fr_1.5fr] gap-2">
            <button type="button" onClick={stopWriting} data-testid="feed-comentarios-cancelar" className={`${cellBase} bg-blush text-ink hover:opacity-90`}>
              {t.commentCancel}
            </button>
            <button type="submit" disabled={sending || used === 0 || tooLong} data-testid="feed-comentarios-enviar" className={`${cellBase} bg-brand text-[var(--on-accent)] hover:opacity-90`}>
              {sending ? t.commentSending : t.commentSend}
            </button>
          </div>
        </form>
      ) : null}

      {!canWrite && error ? (
        <p role="alert" className="border-t border-ink/10 px-5 py-3 text-[0.9375rem] leading-snug font-medium" data-testid="feed-comentarios-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
