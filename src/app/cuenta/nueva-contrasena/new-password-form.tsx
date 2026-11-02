"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { inputClass, labelClass } from "@/components/panel/styles";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/validation";
import { setNewPasswordAction } from "@/lib/registro/actions";

export function NewPasswordForm() {
  return (
    <ActionForm action={setNewPasswordAction} className="grid gap-5">
      <div>
        <label htmlFor="nueva-clave" className={labelClass}>
          Contraseña nueva
        </label>
        <input id="nueva-clave" name="password" type="password" required minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password" className={`${inputClass} mt-1`} />
      </div>
      <div>
        <label htmlFor="repetir-clave" className={labelClass}>
          Repetí la contraseña
        </label>
        <input id="repetir-clave" name="repeat" type="password" required minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password" className={`${inputClass} mt-1`} />
      </div>
      <div>
        <SubmitButton pendingLabel="Guardando…">Guardar y entrar</SubmitButton>
      </div>
    </ActionForm>
  );
}
