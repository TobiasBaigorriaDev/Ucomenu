"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { PasswordField } from "@/components/panel/password-field";
import { changePasswordAction } from "@/lib/auth/actions";

export function ChangePasswordForm() {
  return (
    <ActionForm action={changePasswordAction} className="mt-4 grid max-w-md gap-4">
      <PasswordField name="current" label="Contraseña actual" autoComplete="current-password" />
      <PasswordField name="next" label="Contraseña nueva" autoComplete="new-password" hint="Al menos 10 caracteres." />
      <PasswordField name="repeat" label="Repetí la contraseña nueva" autoComplete="new-password" />
      <div>
        <SubmitButton pendingLabel="Guardando…">Cambiar contraseña</SubmitButton>
      </div>
    </ActionForm>
  );
}
