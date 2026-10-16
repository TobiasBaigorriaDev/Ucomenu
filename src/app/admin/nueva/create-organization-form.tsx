"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { PasswordField } from "@/components/panel/password-field";
import { inputClass, labelClass } from "@/components/panel/styles";
import { createOrganizationAction } from "../actions";

const PLAN_OPTIONS = [
  { value: "basic", label: "Básico" },
  { value: "pro", label: "Pro" },
  { value: "premium", label: "Premium" },
] as const;

export function CreateOrganizationForm({ defaultPeriodEnd }: { defaultPeriodEnd: string }) {
  return (
    <ActionForm action={createOrganizationAction} className="mt-6 grid max-w-md gap-4">
      {(state) => (
        <>
          <div>
            <label htmlFor="org-nombre" className={labelClass}>
              Nombre de la organización
            </label>
            <input
              id="org-nombre"
              name="name"
              type="text"
              required
              maxLength={80}
              autoComplete="off"
              defaultValue={state.values?.name ?? ""}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label htmlFor="org-slug" className={labelClass}>
              Identificador (slug)
            </label>
            <input
              id="org-slug"
              name="slug"
              type="text"
              required
              maxLength={64}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="org-slug-hint"
              defaultValue={state.values?.slug ?? ""}
              className={`${inputClass} mt-1`}
            />
            <p id="org-slug-hint" className="mt-1 text-sm text-muted">
              Minúsculas, números y guiones (por ejemplo, cafe-del-centro). Va en la dirección del panel y no se cambia después.
            </p>
          </div>
          <div>
            <label htmlFor="org-sucursal" className={labelClass}>
              Nombre de la primera sucursal
            </label>
            <input
              id="org-sucursal"
              name="branchName"
              type="text"
              required
              maxLength={80}
              autoComplete="off"
              defaultValue={state.values?.branchName ?? ""}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label htmlFor="org-sucursal-slug" className={labelClass}>
              Identificador de la sucursal (slug)
            </label>
            <input
              id="org-sucursal-slug"
              name="branchSlug"
              type="text"
              required
              maxLength={64}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="org-sucursal-slug-hint"
              defaultValue={state.values?.branchSlug ?? "principal"}
              className={`${inputClass} mt-1`}
            />
            <p id="org-sucursal-slug-hint" className="mt-1 text-sm text-muted">
              Va en la dirección pública de la carta: /m/identificador/<strong className="font-semibold">sucursal</strong>.
            </p>
          </div>
          <div>
            <label htmlFor="org-email" className={labelClass}>
              Email del Dueño
            </label>
            <input
              id="org-email"
              name="ownerEmail"
              type="email"
              required
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              defaultValue={state.values?.ownerEmail ?? ""}
              className={`${inputClass} mt-1`}
            />
          </div>
          <PasswordField
            name="ownerPassword"
            label="Contraseña temporal del Dueño"
            autoComplete="new-password"
            hint="Al menos 10 caracteres. Pasásela al Dueño; la puede cambiar desde Mi cuenta."
          />
          <div>
            <label htmlFor="org-plan" className={labelClass}>
              Plan
            </label>
            <select id="org-plan" name="plan" defaultValue={state.values?.plan || "basic"} className={`${inputClass} mt-1`}>
              {PLAN_OPTIONS.map((plan) => (
                <option key={plan.value} value={plan.value}>
                  {plan.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="org-ciclo" className={labelClass}>
              Facturación
            </label>
            <select
              id="org-ciclo"
              name="billingCycle"
              defaultValue={state.values?.billingCycle || "monthly"}
              className={`${inputClass} mt-1`}
            >
              <option value="monthly">Mensual</option>
              <option value="yearly">Anual</option>
            </select>
          </div>
          <div>
            <label htmlFor="org-vigencia" className={labelClass}>
              Vigente hasta
            </label>
            <input
              id="org-vigencia"
              name="periodEnd"
              type="date"
              required
              aria-describedby="org-vigencia-hint"
              defaultValue={state.values?.periodEnd || defaultPeriodEnd}
              className={`${inputClass} mt-1`}
            />
            <p id="org-vigencia-hint" className="mt-1 text-sm text-muted">
              Hasta el final de ese día. Por defecto, 14 días: lo mismo que la prueba gratuita. Máximo 2 años.
            </p>
          </div>
          <div>
            <SubmitButton pendingLabel="Creando…">Crear organización</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
