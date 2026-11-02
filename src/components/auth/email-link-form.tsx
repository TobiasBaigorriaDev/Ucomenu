"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { inputClass, labelClass } from "@/components/panel/styles";
import type { FormState } from "@/lib/form-state";
import { TurnstileWidget } from "./turnstile-widget";

/** Formulario de un solo campo de `/registro` y `/recuperar`: pide el email y manda un enlace. Al enviarlo se reemplaza por el aviso. */
export function EmailLinkForm({
  action,
  siteKey,
  submitLabel,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  siteKey: string | null;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} className="grid gap-5">
      {(state) =>
        state.ok ? null : (
          <>
            <div>
              <label htmlFor="enlace-email" className={labelClass}>
                Email
              </label>
              <input
                id="enlace-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                defaultValue={state.values?.email ?? ""}
                className={`${inputClass} mt-1`}
              />
            </div>
            <TurnstileWidget siteKey={siteKey} resetKey={state} />
            <div>
              <SubmitButton pendingLabel="Enviando…">{submitLabel}</SubmitButton>
            </div>
          </>
        )
      }
    </ActionForm>
  );
}
