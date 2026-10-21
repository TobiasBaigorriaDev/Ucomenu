"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { PasswordField } from "@/components/panel/password-field";
import { inputClass, labelClass } from "@/components/panel/styles";
import { createMemberAction } from "./actions";

/**
 * Con `canWrite` en falso (solo lectura, suspendida, o no se pudo comprobar el estado) el servidor rechaza el alta: el
 * formulario no se puede completar ni enviar y el aviso explica por qué. La defensa de fondo sigue siendo la del servidor
 * (`createMember` vuelve a comprobar `canWrite`). Quitar personal y cambiar contraseñas son otros formularios y siguen activos.
 */
export function CreateMemberForm({ orgSlug, canWrite }: { orgSlug: string; canWrite: boolean }) {
  return (
    <ActionForm action={createMemberAction} className="mt-4 grid max-w-md gap-4">
      {(state) => (
        <>
          {!canWrite ? (
            <p id="alta-bloqueada" className="text-base leading-relaxed text-muted">
              Con la cuenta vencida (o si no pudimos comprobar su estado) no se pueden sumar personas. Sí podés quitar personal y
              cambiar contraseñas.
            </p>
          ) : null}
          <fieldset disabled={!canWrite} aria-describedby={canWrite ? undefined : "alta-bloqueada"} className="grid gap-4">
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
            <div>
              <SubmitButton pendingLabel="Creando…">Crear cuenta</SubmitButton>
            </div>
          </fieldset>
        </>
      )}
    </ActionForm>
  );
}
