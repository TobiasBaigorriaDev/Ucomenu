"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createWaiterCallAction, type CallState } from "./actions";

const buttonBase =
  "inline-flex min-h-12 w-full items-center justify-center rounded-md px-3 py-2 text-base font-semibold disabled:opacity-60";

function Buttons() {
  const { pending } = useFormStatus();
  return (
    <div className="grid grid-cols-2 gap-3">
      <button type="submit" name="kind" value="waiter" disabled={pending} className={`${buttonBase} bg-cobalt text-white`}>
        {pending ? "Enviando…" : "Llamar al mozo"}
      </button>
      <button type="submit" name="kind" value="bill" disabled={pending} className={`${buttonBase} border border-ink/50 text-ink`}>
        {pending ? "Enviando…" : "Pedir la cuenta"}
      </button>
    </div>
  );
}

/**
 * Barra fija inferior de `/t/{token}`: dos botones y el resultado. Solo se monta si la base informó que se puede
 * llamar desde esta mesa. La confirmación es la respuesta del envío (sin tiempo real para el comensal).
 */
export function CallBar({ token }: { token: string }) {
  const [state, formAction] = useActionState<CallState, FormData>(createWaiterCallAction, {});

  return (
    <form
      action={formAction}
      aria-label="Avisar al personal"
      data-testid="barra-llamado"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-ink/15 bg-porcelain/95 backdrop-blur"
    >
      <input type="hidden" name="token" value={token} />
      <div className="mx-auto max-w-xl px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {state.message ? (
          <p
            role={state.tone === "error" ? "alert" : "status"}
            data-testid="mensaje-llamado"
            data-tone={state.tone}
            className={`mb-2 text-[0.9375rem] leading-snug ${state.tone === "error" ? "font-medium text-danger" : "text-ink"}`}
          >
            {state.message}
          </p>
        ) : null}
        <Buttons />
      </div>
    </form>
  );
}
