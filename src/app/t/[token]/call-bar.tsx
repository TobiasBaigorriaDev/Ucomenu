"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { followVisualViewport } from "@/components/menu/zoom-dock";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import { AccountSheet } from "./account-sheet";
import { createWaiterCallAction, type CallState } from "./actions";

/** Celdas del dock: mismo lenguaje que el bento de categorías (radio grande y colores de la paleta del local). */
const cellBase =
  "carta-dock-cell inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-3xl px-3 py-2 text-base font-semibold disabled:opacity-60";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

/**
 * ¿Toca ofrecer la invitación a reseñar? Una vez al día (día del dispositivo) por sucursal: la primera vez que se pide la cuenta se
 * marca y las siguientes no la repiten, la haya cerrado o no. Sin almacenamiento (modo privado, bloqueado) se ofrece sin recordar.
 */
function claimReviewInvite(branchId: string): boolean {
  try {
    const now = new Date();
    const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    const key = `ucomenu:resenas:${branchId}`;
    if (window.localStorage.getItem(key) === day) return false;
    window.localStorage.setItem(key, day);
  } catch {
    // Sin almacenamiento no se puede recordar: se ofrece igual (el cierre sigue valiendo en esta pantalla).
  }
  return true;
}

/** Con tres celdas el ancho no alcanza para icono y texto en una línea: se apilan, y el texto puede ocupar dos. */
const cellStacked = "min-h-16 flex-col gap-1 px-2 text-[0.9375rem] leading-tight text-center";

/**
 * Celda terciaria del dock, entre las dos acciones: el acceso a Menufeed, el feed de videos del local. Es navegación, no un llamado: un enlace fuera del envío, que no
 * se deshabilita mientras se envía y no depende del ticket de visita. Contorno en tinta y ▶ terracota, el lenguaje del
 * antiguo botón suelto de la carta; el color sólido queda para las acciones que avisan al personal.
 */
function VideosCell({ href, lang, stacked }: { href: string; lang: Lang; stacked: boolean }) {
  const t = TEXTOS[lang].feed;
  return (
    <Link
      href={href}
      prefetch={false}
      data-testid="ver-videos"
      aria-label={t.link}
      className={`${cellBase} border-[1.5px] border-ink text-ink hover:bg-ink/5 ${stacked ? cellStacked : ""}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0 text-[var(--carta-terra)]" fill="currentColor">
        <path d="M7 4.5v15L19.5 12 7 4.5Z" />
      </svg>
      {t.dockLink}
    </Link>
  );
}

function Buttons({ lang, videosHref }: { lang: Lang; videosHref?: string }) {
  const { pending } = useFormStatus();
  const t = TEXTOS[lang].call;
  const stacked = Boolean(videosHref);
  return (
    <div className={`grid gap-2 ${stacked ? "grid-cols-3" : "grid-cols-2"}`}>
      <button type="submit" name="kind" value="waiter" disabled={pending} className={`${cellBase} bg-[var(--carta-green)] text-[var(--on-accent)] ${stacked ? cellStacked : ""}`}>
        <Icon>
          <path d="M6 17V11a6 6 0 0 1 12 0v6" />
          <path d="M4 17h16" />
          <path d="M10 20.5h4" />
        </Icon>
        {pending ? t.sending : t.waiter}
      </button>
      {videosHref ? <VideosCell href={videosHref} lang={lang} stacked /> : null}
      <button type="submit" name="kind" value="bill" disabled={pending} className={`${cellBase} bg-[var(--carta-blush)] text-ink ${stacked ? cellStacked : ""}`}>
        <Icon>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
          <path d="M9 8h6M9 12h6" />
        </Icon>
        {pending ? t.sending : t.bill}
      </button>
    </div>
  );
}

/**
 * ¿Se cumplió el plazo del ticket de visita? Cuenta desde que se montó la barra con el reloj del dispositivo (solo
 * transcurre tiempo: no depende de que el reloj esté en hora) y se vuelve a mirar al volver a la pestaña, porque los
 * celulares congelan los temporizadores con la pantalla apagada. El servidor valida igual: esto es cortesía.
 */
function useSessionExpired(ttlMs: number): boolean {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const start = Date.now();
    const check = () => {
      if (Date.now() - start >= ttlMs) setExpired(true);
    };
    const timer = window.setTimeout(check, ttlMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", check);
    window.addEventListener("focus", check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("focus", check);
    };
  }, [ttlMs]);

  return expired;
}

/**
 * Dock fijo inferior de `/t/{token}`: dos celdas de acción y el resultado, siempre al alcance del pulgar. Solo se monta si la base informó que se puede
 * llamar desde esta mesa. La confirmación es la respuesta del envío (sin tiempo real para el comensal). Lleva el
 * ticket de visita emitido al abrir la página; vencido el plazo, en vez de los botones pide escanear el QR de nuevo.
 * `videosHref` suma la tercera celda, el acceso al feed (solo en la carta y si el local tiene videos; en el feed no hace falta,
 * ya tiene su propio «volver»). Es navegación: sigue disponible con el ticket vencido.
 */
export function CallBar({
  token,
  ticket,
  ttlMs,
  lang,
  videosHref,
  reviewUrl,
  reviewKey,
  expired = false,
}: {
  token: string;
  ticket: string;
  ttlMs: number;
  /** La visita de la URL ya terminó (el turno de la mesa empezó después, o el ticket venció): arranca en «escaneá de nuevo», sin botones. */
  expired?: boolean;
  lang: Lang;
  videosHref?: string;
  /** Enlace de reseñas de Google de la sucursal; sin él no hay invitación. `reviewKey` (la sucursal) acota «una vez al día» por dispositivo. */
  reviewUrl?: string | null;
  reviewKey?: string;
}) {
  const bar = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const element = bar.current;
    const carta = element?.closest<HTMLElement>(".carta");
    if (!element || !carta) return;
    // `offsetHeight` (no `getBoundingClientRect`): no cambia si el dock se contra-escala por el zoom (estilo «hoja»).
    const measure = () => carta.style.setProperty("--call-bar-height", `${Math.ceil(element.offsetHeight)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // La hoja se amplía con los dedos y un dock `fixed` no sigue ese zoom: en ese estilo acompaña al viewport visible.
    const stopFollowing = carta.dataset.layout === "hoja" ? followVisualViewport(element) : undefined;
    return () => {
      observer.disconnect();
      stopFollowing?.();
      carta.style.removeProperty("--call-bar-height");
    };
  }, []);
  // «Ver mi cuenta» (ADR 0044) sigue ofrecido aunque después se toque «Llamar al mozo» (cada envío reemplaza el estado del anterior).
  const [accountReady, setAccountReady] = useState(false);
  const [state, formAction] = useActionState<CallState & { invite?: boolean }, FormData>(async (previous, formData) => {
    let next: CallState & { invite?: boolean };
    try {
      next = await createWaiterCallAction(previous, formData);
    } catch {
      // Un corte de conexión no debe desmontar la carta ni afirmar que se avisó.
      // El reintento es manual: el servidor sigue decidiendo si ya hay un llamado.
      return { tone: "error", message: TEXTOS[lang].call.unavailable };
    }
    if (next.account) setAccountReady(true);
    // La invitación se ofrece solo tras pedir la cuenta, cuando el pedido se registró de verdad, y una vez al día por dispositivo.
    return reviewUrl && reviewKey && next.kind === "bill" && next.tone === "ok" && claimReviewInvite(reviewKey) ? { ...next, invite: true } : next;
  }, {});
  const [closed, setClosed] = useState<unknown>(null);
  // «Ver mi cuenta» (ADR 0044): la hoja vive fuera del formulario; si la base dice que el turno ya no es este, la barra pasa a «vencida».
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountExpired, setAccountExpired] = useState(false);
  const markAccountExpired = useCallback(() => setAccountExpired(true), []);
  const sessionExpired = useSessionExpired(ttlMs) || expired || state.expired === true || accountExpired;

  return (
    <>
    <form
      ref={bar}
      action={formAction}
      aria-label={TEXTOS[lang].call.form}
      data-testid="barra-llamado"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="lang" value={lang} />
      <div className="carta-dock pointer-events-auto mx-auto max-w-xl rounded-[1.75rem] bg-porcelain/95 p-2 shadow-[0_10px_28px_-10px_rgb(0_0_0/0.4)] ring-1 ring-ink/15 backdrop-blur">
        {sessionExpired ? (
          <p role="status" data-testid="sesion-vencida" className="px-2 py-1 text-[0.9375rem] leading-snug font-medium text-ink">
            {TEXTOS[lang].call.expired}
          </p>
        ) : null}
        {!sessionExpired && state.message ? (
          <p
            role={state.tone === "error" ? "alert" : "status"}
            data-testid="mensaje-llamado"
            data-tone={state.tone}
            className={`mb-2 px-2 pt-1 text-[0.9375rem] leading-snug ${state.tone === "error" ? "font-medium text-danger" : "text-ink"}`}
          >
            {state.message}
          </p>
        ) : null}
        {!sessionExpired && state.invite && reviewUrl && closed !== state ? (
          <div data-testid="invitacion-resenas" className="mb-2 flex items-start gap-2 rounded-2xl bg-ink/5 px-3 py-2">
            <p className="flex-1 text-[0.9375rem] leading-snug text-ink">
              {TEXTOS[lang].review.invite}{" "}
              <a href={reviewUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-4">
                {TEXTOS[lang].review.action}
              </a>
            </p>
            <button type="button" onClick={() => setClosed(state)} aria-label={TEXTOS[lang].review.close} className="-my-1 -mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-ink/10">
              <Icon>
                <path d="M6 6l12 12M18 6 6 18" />
              </Icon>
            </button>
          </div>
        ) : null}
        {!sessionExpired && accountReady ? (
          <button
            type="button"
            data-testid="ver-cuenta"
            onClick={() => setAccountOpen(true)}
            className={`${cellBase} mb-2 border-[1.5px] border-ink text-ink hover:bg-ink/5`}
          >
            {TEXTOS[lang].account.view}
          </button>
        ) : null}
        {sessionExpired ? videosHref ? <VideosCell href={videosHref} lang={lang} stacked={false} /> : null : <Buttons lang={lang} videosHref={videosHref} />}
      </div>
    </form>
    {accountOpen ? <AccountSheet token={token} ticket={ticket} lang={lang} onClose={() => setAccountOpen(false)} onExpired={markAccountExpired} /> : null}
    </>
  );
}
