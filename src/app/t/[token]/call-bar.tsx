"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/llamados/result";
import { createWaiterCallAction, type CallState } from "./actions";

const buttonBase =
  "inline-flex min-h-12 w-full items-center justify-center rounded-full px-3 py-2 text-base font-semibold disabled:opacity-60";

function Buttons() {
  const { pending } = useFormStatus();
  return (
    <div className="grid grid-cols-2 gap-3">
      <button type="submit" name="kind" value="waiter" disabled={pending} className={`${buttonBase} bg-[var(--carta-green)] text-white`}>
        {pending ? "Enviando…" : "Llamar al mozo"}
      </button>
      <button type="submit" name="kind" value="bill" disabled={pending} className={`${buttonBase} border-2 border-[var(--carta-green)] text-[var(--carta-green-deep)]`}>
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
 * Barra fija inferior de `/t/{token}`: dos botones y el resultado. Solo se monta si la base informó que se puede
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
      className="fixed inset-x-0 bottom-0 z-20 border-t border-ink/15 bg-porcelain/95 backdrop-blur"
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="ticket" value={ticket} />
      <div className="mx-auto max-w-xl px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {sessionExpired ? (
          <p role="status" data-testid="sesion-vencida" className="py-1 text-[0.9375rem] leading-snug font-medium text-ink">
            {SESSION_EXPIRED_MESSAGE}
          </p>
        ) : null}
        {!sessionExpired && state.message ? (
          <p
            role={state.tone === "error" ? "alert" : "status"}
            data-testid="mensaje-llamado"
            data-tone={state.tone}
            className={`mb-2 text-[0.9375rem] leading-snug ${state.tone === "error" ? "font-medium text-danger" : "text-ink"}`}
          >
            {state.message}
          </p>
        ) : null}
        {sessionExpired ? null : <Buttons />}
      </div>
    </form>
  );
}
