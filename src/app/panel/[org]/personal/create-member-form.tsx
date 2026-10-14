"use client";

import { ActionForm, SubmitButton, inputClass, labelClass } from "@/components/panel/action-form";
import { PasswordField } from "@/components/panel/password-field";
import { createMemberAction } from "./actions";

export function CreateMemberForm({ orgSlug, canWrite }: { orgSlug: string; canWrite: boolean }) {
  return (
    <ActionForm action={createMemberAction} className="mt-4 grid max-w-md gap-4">
      {(state) => (
        <>
          <input type="hidden" name="org" value={orgSlug} />
          <div>
            <label htmlFor="alta-email" className={labelClass}>
              Email
            </label>
            <input
              id="alta-email"
              name="email"
              type="email"
              required
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              defaultValue={state.values?.email ?? ""}
              className={`${inputClass} mt-1`}
            />
          </div>
          <PasswordField
            name="password"
            label="Contraseña inicial"
            autoComplete="new-password"
            hint="Al menos 10 caracteres. Pasásela a la persona; puede cambiarla desde Mi cuenta."
          />
          <div>
            <label htmlFor="alta-rol" className={labelClass}>
              Rol
            </label>
            <select
              id="alta-rol"
              name="role"
              defaultValue={state.values?.role === "owner" ? "owner" : "staff"}
              className={`${inputClass} mt-1`}
            >
              <option value="staff">Personal: carta y sala</option>
              <option value="owner">Dueño: además suscripción y personal</option>
            </select>
          </div>
          {!canWrite ? (
            <p className="text-sm text-muted">
              Con la cuenta vencida no se pueden sumar personas. Sí podés quitar personal y cambiar contraseñas.
            </p>
          ) : null}
          <div>
            <SubmitButton pendingLabel="Creando…">Crear cuenta</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
