"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/llamados/result";
import { createWaiterCallAction, type CallState } from "./actions";

/** Celdas del dock: mismo lenguaje que el bento de categorías (radio grande y colores de la paleta del local). */
const cellBase =
  "inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-3xl px-3 py-2 text-base font-semibold disabled:opacity-60";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function Buttons() {
  const { pending } = useFormStatus();
  return (
    <div className="grid grid-cols-2 gap-2">
      <button type="submit" name="kind" value="waiter" disabled={pending} className={`${cellBase} bg-[var(--carta-green)] text-white`}>
        <Icon>
          <path d="M6 17V11a6 6 0 0 1 12 0v6" />
          <path d="M4 17h16" />
          <path d="M10 20.5h4" />
        </Icon>
        {pending ? "Enviando…" : "Llamar al mozo"}
      </button>
      <button type="submit" name="kind" value="bill" disabled={pending} className={`${cellBase} bg-[var(--carta-blush)] text-ink`}>
        <Icon>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
          <path d="M9 8h6M9 12h6" />
        </Icon>
        {pending ? "Enviando…" : "Pedir la cuenta"}
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
 */
export function CallBar({ token, ticket, ttlMs }: { token: string; ticket: string; ttlMs: number }) {
  const [state, formAction] = useActionState<CallState, FormData>(createWaiterCallAction, {});
  const sessionExpired = useSessionExpired(ttlMs) || state.expired === true;

  return (
    <form
      action={formAction}
      aria-label="Avisar al personal"
      data-testid="barra-llamado"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="ticket" value={ticket} />
      <div className="pointer-events-auto mx-auto max-w-xl rounded-[1.75rem] bg-porcelain/95 p-2 shadow-[0_10px_28px_-10px_rgb(0_0_0/0.4)] ring-1 ring-ink/15 backdrop-blur">
        {sessionExpired ? (
          <p role="status" data-testid="sesion-vencida" className="px-2 py-1 text-[0.9375rem] leading-snug font-medium text-ink">
            {SESSION_EXPIRED_MESSAGE}
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
        {sessionExpired ? null : <Buttons />}
      </div>
    </form>
  );
}
