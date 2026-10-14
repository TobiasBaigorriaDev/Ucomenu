"use client";

import { ActionForm, SubmitButton, inputClass, labelClass } from "@/components/panel/action-form";
import { loginAction } from "@/lib/auth/actions";

export function LoginForm({ next }: { next: string | null }) {
  return (
    <ActionForm action={loginAction} className="grid gap-5">
      {(state) => (
        <>
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <div>
            <label htmlFor="login-email" className={labelClass}>
              Email
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              defaultValue={state.values?.email ?? ""}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label htmlFor="login-password" className={labelClass}>
              Contraseña
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <SubmitButton pendingLabel="Ingresando…">Ingresar</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
