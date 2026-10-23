"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import { CommentsButton, CommentsSheet, type CommentAccess } from "@/components/menu/comments-sheet";
import { LikeControl, type LikeAccess } from "@/components/menu/like-button";
import { formatArs } from "@/lib/money";
import { hlsUrl, neighbor, posterUrl, slidesToPrepare } from "@/lib/videos/feed";

/** El plato de un video, solo si sigue visible en esta sucursal (lo resuelve el servidor). */
export type FeedDish = { name: string; price_cents: number; description: string | null };
export type FeedVideo = { id: string; title: string; playbackId: string; likeCount: number; commentCount: number; dish: FeedDish | null };

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const subscribeReducedMotion = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const reducedMotionNow = () => window.matchMedia(REDUCED_MOTION).matches;

const iconClass = "size-6";
const roundButton =
  "grid size-11 shrink-0 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/70 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white";

function Icon({ name }: { name: "sound" | "mute" | "play" | "pause" | "up" | "down" | "back" | "close" }) {
  const paths = {
    sound: <><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" /></>,
    mute: <><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" /><path d="m16 9.5 5 5M21 9.5l-5 5" /></>,
    play: <path d="M8 5.5v13l11-6.5-11-6.5Z" />,
    pause: <path d="M8 5.5v13M16 5.5v13" />,
    up: <path d="m6 14 6-6 6 6" />,
    down: <path d="m6 10 6 6 6-6" />,
    back: <path d="m14 6-6 6 6 6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={iconClass} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

type SlideProps = {
  video: FeedVideo;
  index: number;
  total: number;
  prepared: boolean;
  active: boolean;
  muted: boolean;
  reduced: boolean;
  lang: Lang;
  /** Hay una barra de llamado debajo del feed (en la mesa): ella ya cubre la zona segura del borde inferior. */
  hasBar: boolean;
  /** Desde la mesa, con el ticket de visita: el corazón es un botón. Sin esto es solo el conteo. */
  likes: LikeAccess | null;
  /** Desde la mesa con el comentario habilitado: la hoja de comentarios trae el formulario. Sin esto solo se leen los aprobados. */
  comments: CommentAccess | null;
  onToggleMute: () => void;
};

/**
 * Un video del feed. Muestra el póster de Mux y, solo si está «preparado» (es el visible o el siguiente), le asocia su stream:
 * Safari y iOS reproducen HLS nativo; si el navegador no puede (o lo rechaza), lo hace `hls.js`, que se baja recién acá y no antes.
 */
function Slide({ video, index, total, prepared, active, muted, reduced, lang, hasBar, likes, comments, onToggleMute }: SlideProps) {
  const t = TEXTOS[lang].feed;
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);
  const [paused, setPaused] = useState(false);
  // Con «reducir movimiento» nada arranca solo: hace falta un toque en reproducir.
  const [started, setStarted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [showDish, setShowDish] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const commentsButton = useRef<HTMLButtonElement>(null);
  // Solo «el navegador no deja arrancar solo» (NotAllowedError) deja el póster con el botón de reproducir. Otros rechazos (p. ej.
  // «sin fuente todavía», porque `hls.js` aún no conectó el video, o una carga interrumpida) no son un bloqueo.
  const onPlayRejected = (reason: unknown) => {
    if (reason instanceof DOMException && reason.name === "NotAllowedError") setBlocked(true);
  };
  // Si hay que reproducir ahora; lo lee el aviso de «manifiesto listo» de hls.js (que llega después de montar).
  const wantPlay = useRef(false);

  // El stream se asocia solo mientras el video está preparado y se suelta al dejar de estarlo.
  useEffect(() => {
    const element = ref.current;
    if (!element || !prepared) return;
    let cancelled = false;
    let hls: { destroy: () => void } | null = null;

    // `hls.js` (variante liviana) por importación dinámica: se baja recién acá y solo si hace falta.
    const attachHlsJs = () => {
      import("hls.js/light")
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) return setError(true);
          const player = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 8 });
          hls = player;
          player.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              player.destroy();
              hls = null;
              setError(true);
            }
          });
          // `hls.js` conecta el video recién acá: un `play()` anterior no tenía fuente. Se pide de nuevo al estar listo el manifiesto.
          player.on(Hls.Events.MANIFEST_PARSED, () => {
            if (wantPlay.current) element.play().catch(onPlayRejected);
          });
          player.loadSource(hlsUrl(video.playbackId));
          player.attachMedia(element);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    };

    if (element.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari e iOS reproducen HLS nativo. Pero `canPlayType` no es una garantía (Chrome 155 dice «maybe» y rechaza el stream con
      // MEDIA_ERR_SRC_NOT_SUPPORTED): si el video da error, se suelta la fuente y se reintenta con `hls.js`.
      const onNativeError = () => {
        if (cancelled) return;
        element.removeAttribute("src");
        element.load();
        attachHlsJs();
      };
      element.addEventListener("error", onNativeError, { once: true });
      element.src = hlsUrl(video.playbackId);
      return () => {
        cancelled = true;
        element.removeEventListener("error", onNativeError);
        hls?.destroy();
        element.removeAttribute("src");
        element.load();
      };
    }
    attachHlsJs();
    return () => {
      cancelled = true;
      hls?.destroy();
      element.removeAttribute("src");
      element.load();
    };
  }, [prepared, video.playbackId]);

  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
  }, [muted, prepared]);

  const shouldPlay = prepared && active && !paused && !error && (!reduced || started);
  useEffect(() => {
    wantPlay.current = shouldPlay;
    const element = ref.current;
    if (!element || !prepared) return;
    if (shouldPlay) {
      element.play().then(() => setBlocked(false), onPlayRejected);
    } else {
      element.pause();
    }
  }, [shouldPlay, prepared]);

  const playing = shouldPlay && !blocked;
  const showPlay = active && !error && !playing;
  function togglePlay() {
    if (playing) {
      setPaused(true);
      return;
    }
    setPaused(false);
    setStarted(true);
    // `play()` se pide acá, dentro del gesto del toque: Safari e iOS no lo aceptan fuera de él, y si el navegador había bloqueado el
    // arranque solo, ningún cambio de estado vuelve a disparar el efecto de arriba. Sigue «bloqueado» hasta que el navegador acepte.
    const element = ref.current;
    if (element && prepared) element.play().then(() => setBlocked(false), onPlayRejected);
    else setBlocked(false);
  }

  return (
    <section
      aria-label={`${t.position(index + 1, total)}: ${video.title}`}
      data-slide=""
      data-index={index}
      data-prepared={prepared ? "true" : "false"}
      data-testid="feed-video"
      className="relative h-full snap-start snap-always overflow-hidden bg-black"
    >
      <video
        ref={ref}
        poster={posterUrl(video.playbackId)}
        playsInline
        loop
        muted
        // Preparado = visible o siguiente: con HLS nativo (Safari, iOS y Chrome reciente) `metadata` trae el manifiesto y deja al siguiente listo.
        preload={prepared ? "metadata" : "none"}
        aria-label={video.title}
        className="absolute inset-0 size-full object-cover"
      />
      {/* Toda la pantalla es el botón de reproducir/pausar (también por teclado). */}
      <button type="button" onClick={togglePlay} aria-label={playing ? t.pause : t.play} className="absolute inset-0 size-full cursor-pointer focus-visible:outline-3 focus-visible:-outline-offset-4 focus-visible:outline-white">
        {showPlay ? (
          <span className="absolute top-1/2 left-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white" data-testid="feed-play">
            <Icon name="play" />
          </span>
        ) : null}
      </button>
      {error ? (
        <p role="status" data-testid="feed-error" className="absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-2xl bg-black/70 px-4 py-3 text-center text-base text-white">
          {t.videoError}
        </p>
      ) : null}

      <div className="absolute top-16 right-3 z-10 flex flex-col items-center gap-3">
        <button type="button" onClick={onToggleMute} aria-pressed={!muted} aria-label={muted ? t.unmute : t.mute} className={roundButton} data-testid="feed-sonido">
          <Icon name={muted ? "mute" : "sound"} />
        </button>
        <LikeControl videoId={video.id} initialCount={video.likeCount} access={likes} lang={lang} />
        <CommentsButton count={video.commentCount} canWrite={comments !== null} open={showComments} onClick={() => setShowComments((value) => !value)} lang={lang} buttonRef={commentsButton} />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pt-16 pb-6">
        <h2 className="font-display text-2xl leading-tight text-white [overflow-wrap:anywhere]" data-testid="feed-titulo">
          {video.title}
        </h2>
        {video.dish ? (
          <button
            type="button"
            onClick={() => setShowDish(true)}
            aria-expanded={showDish}
            className="pointer-events-auto mt-3 inline-flex min-h-11 items-center rounded-full bg-white px-5 text-base font-semibold text-black focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white"
            data-testid="feed-ver-plato"
          >
            {t.viewDish}
          </button>
        ) : null}
      </div>

      {showComments ? (
        <CommentsSheet
          videoId={video.id}
          access={comments}
          lang={lang}
          hasBar={hasBar}
          onClose={() => {
            setShowComments(false);
            commentsButton.current?.focus();
          }}
        />
      ) : null}

      {video.dish && showDish ? (
        <div
          role="region"
          aria-label={video.dish.name}
          data-testid="feed-plato"
          className={`absolute inset-x-3 z-30 rounded-3xl bg-white p-5 text-black shadow-2xl ${hasBar ? "bottom-2" : "bottom-[max(0.75rem,env(safe-area-inset-bottom))]"}`}
        >
          <div className="flex items-start justify-between gap-4">
            <h3 className="min-w-0 font-display text-2xl leading-tight [overflow-wrap:anywhere]">{video.dish.name}</h3>
            <button type="button" onClick={() => setShowDish(false)} aria-label={t.hideDish} className="grid size-11 shrink-0 place-items-center rounded-full bg-black/10 text-black hover:bg-black/15 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-black">
              <Icon name="close" />
            </button>
          </div>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatArs(video.dish.price_cents)}</p>
          {video.dish.description ? <p className="mt-2 text-base leading-relaxed text-black/75 [overflow-wrap:anywhere]">{video.dish.description}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Feed vertical de videos (ficha feed-de-videos): un video a la vez con `scroll-snap`, mudo y en bucle. Solo el visible y el
 * siguiente piden su stream. Flechas, botones de siguiente/anterior y Escape (vuelve a la carta) para teclado y escritorio.
 */
export function VideoFeed({ videos, lang, backHref, callBar, likes = null, comments = null }: { videos: FeedVideo[]; lang: Lang; backHref: string; callBar?: ReactNode; likes?: LikeAccess | null; comments?: CommentAccess | null }) {
  const t = TEXTOS[lang].feed;
  const router = useRouter();
  const scroller = useRef<HTMLDivElement>(null);
  // La barra de llamado crece al mostrar su respuesta: el feed termina donde ella empieza, medida de verdad (no un alto fijo).
  const barSlot = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const reduced = useSyncExternalStore(subscribeReducedMotion, reducedMotionNow, () => false);
  const prepared = new Set(slidesToPrepare(active, videos.length));

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.index));
        }
      },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll("[data-slide]").forEach((slide) => observer.observe(slide));
    return () => observer.disconnect();
  }, [videos.length]);

  useEffect(() => {
    const bar = barSlot.current?.firstElementChild;
    if (!bar) return;
    const measure = () => setBarHeight(Math.ceil(bar.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [callBar]);

  function go(direction: 1 | -1) {
    const target = neighbor(active, videos.length, direction);
    scroller.current?.querySelector(`[data-index="${target}"]`)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "PageDown") {
      event.preventDefault();
      go(1);
    } else if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      go(-1);
    } else if (event.key === "Escape") {
      router.push(backHref);
    }
  }

  return (
    <div className="fixed inset-0 bg-black text-white" data-testid="feed">
      {/* Con la barra de llamado de la mesa, el feed termina donde ella empieza (no la tapa). Antes de medirla, un alto estimado. */}
      <div
        className="relative mx-auto w-full max-w-md"
        style={{ height: !callBar ? "100%" : barHeight > 0 ? `calc(100% - ${barHeight}px)` : "calc(100% - 5.75rem - env(safe-area-inset-bottom))" }}
        onKeyDown={onKeyDown}
      >
        <header className="absolute inset-x-0 top-0 z-20 mx-auto flex max-w-md items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-3 pt-3 pb-6">
          <Link
            href={backHref}
            prefetch={false}
            className="inline-flex min-h-11 items-center gap-1 rounded-full bg-black/55 pr-4 pl-2 text-base font-semibold text-white backdrop-blur-sm hover:bg-black/70 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white"
            data-testid="feed-volver"
          >
            <Icon name="back" />
            {t.back}
          </Link>
          <p className="rounded-full bg-black/55 px-3 py-1 text-sm tabular-nums" data-testid="feed-posicion">
            {active + 1} / {videos.length}
          </p>
        </header>
        <div ref={scroller} tabIndex={0} aria-label={t.heading} className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain scroll-smooth [scrollbar-width:none] motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden focus-visible:outline-none">
          {videos.map((video, index) => (
            <Slide
              key={video.id}
              video={video}
              index={index}
              total={videos.length}
              prepared={prepared.has(index)}
              active={index === active}
              muted={muted}
              reduced={reduced}
              lang={lang}
              hasBar={Boolean(callBar)}
              likes={likes}
              comments={comments}
              onToggleMute={() => setMuted((value) => !value)}
            />
          ))}
        </div>
        {videos.length > 1 ? (
          <div className="absolute right-3 bottom-28 z-20 flex flex-col gap-2">
            <button type="button" onClick={() => go(-1)} disabled={active === 0} aria-label={t.previousVideo} className={`${roundButton} disabled:opacity-40`} data-testid="feed-anterior">
              <Icon name="up" />
            </button>
            <button type="button" onClick={() => go(1)} disabled={active === videos.length - 1} aria-label={t.nextVideo} className={`${roundButton} disabled:opacity-40`} data-testid="feed-siguiente">
              <Icon name="down" />
            </button>
          </div>
        ) : null}
        <p aria-live="polite" className="sr-only">
          {t.position(active + 1, videos.length)}: {videos[active]?.title}
        </p>
      </div>
      {callBar ? (
        <div ref={barSlot} className="contents">
          {callBar}
        </div>
      ) : null}
    </div>
  );
}
