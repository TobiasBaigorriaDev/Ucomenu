"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { dangerButtonClass, inputClass, labelClass } from "@/components/panel/styles";
import { deleteOrphanAccountAction } from "../actions";

/**
 * Borrado de una cuenta sin local: el email escrito (no se confirma con un clic), el motivo y una casilla. La base lo vuelve a
 * exigir todo. Cada fila lleva su propio formulario, así que los ids incluyen el de la cuenta.
 */
export function DeleteOrphanForm({ userId, email }: { userId: string; email: string }) {
  return (
    <ActionForm action={deleteOrphanAccountAction} className="mt-4 grid max-w-md gap-4">
      {(state) => (
        <>
          <input type="hidden" name="userId" value={userId} />
          <div>
            <label htmlFor={`email-${userId}`} className={labelClass}>
              Escribí el email <span className="font-mono [overflow-wrap:anywhere]">{email}</span> para confirmar
            </label>
            <input
              id={`email-${userId}`}
              name="confirmEmail"
              type="text"
              required
              maxLength={254}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              defaultValue={state.values?.confirmEmail ?? ""}
              className={`${inputClass} mt-1 font-mono`}
            />
          </div>
          <div>
            <label htmlFor={`motivo-${userId}`} className={labelClass}>
              Motivo del borrado
            </label>
            <input
              id={`motivo-${userId}`}
              name="reason"
              type="text"
              required
              maxLength={200}
              autoComplete="off"
              aria-describedby={`motivo-hint-${userId}`}
              defaultValue={state.values?.reason ?? ""}
              className={`${inputClass} mt-1`}
            />
            <p id={`motivo-hint-${userId}`} className="mt-1 text-sm text-muted">
              Queda en los movimientos y no se puede borrar. No pongas datos personales.
            </p>
          </div>
          <label className="flex min-h-11 items-start gap-3 text-base">
            <input type="checkbox" name="confirmed" required className="mt-1 size-5 shrink-0" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              Entiendo que se borra la cuenta, que el email queda libre para registrarse de nuevo y que no se puede deshacer.
            </span>
          </label>
          <div>
            <SubmitButton pendingLabel="Borrando…" className={dangerButtonClass}>
              Borrar la cuenta
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
