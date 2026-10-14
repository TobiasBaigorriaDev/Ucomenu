"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/form-state";

export const inputClass =
  "block min-h-11 w-full rounded-md border border-ink/40 bg-white px-3 py-2 text-base text-ink placeholder:text-muted/70";
export const labelClass = "block text-sm font-medium text-ink";
export const primaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-cobalt px-5 py-2 text-base font-medium text-white disabled:opacity-60";
export const secondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-ink/40 bg-transparent px-4 py-2 text-base font-medium text-ink disabled:opacity-60";
export const dangerButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-danger px-4 py-2 text-base font-medium text-danger disabled:opacity-60";

export function SubmitButton({
  children,
  pendingLabel = "Un momento…",
  className = primaryButtonClass,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}

/**
 * Formulario con server action y mensajes de resultado. Los errores usan `role="alert"` y los
 * avisos de éxito `role="status"`, para que los lectores de pantalla los anuncien.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode | ((state: FormState) => ReactNode);
  className?: string;
}) {
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction} className={className}>
      {typeof children === "function" ? children(state) : children}
      {state.error ? (
        <p role="alert" className="mt-3 text-base font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p role="status" className="mt-3 text-base font-medium text-ink">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
