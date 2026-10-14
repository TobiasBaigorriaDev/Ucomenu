"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/form-state";
import { primaryButtonClass } from "./styles";

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
