"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { dangerButtonClass, inputClass, labelClass } from "@/components/panel/styles";
import { changePlanAction, registerPaymentAction, setSuspensionAction } from "../../actions";

const PLAN_OPTIONS = [
  { value: "basic", label: "Básico" },
  { value: "pro", label: "Pro" },
  { value: "premium", label: "Premium" },
] as const;

const REASON_HINT = "Queda en los movimientos y no se puede borrar. No pongas datos personales.";

/*
 * Los <select> llevan `key` según lo devuelto por la acción: React 19 reinicia el formulario al terminar la acción y un
 * <select> no vuelve al valor que se le devolvió en `defaultValue` (quedaría en «Elegí…» y el envío siguiente se bloquearía
 * en silencio). Con otra `key` se vuelve a montar con el valor correcto.
 */
export function ChangePlanForm({ slug, plan, billingCycle }: { slug: string; plan: string; billingCycle: string }) {
  return (
    <ActionForm action={changePlanAction} className="mt-4 grid max-w-md gap-4">
      {(state) => (
        <>
          <input type="hidden" name="slug" value={slug} />
          <div>
            <label htmlFor="plan-plan" className={labelClass}>
              Plan
            </label>
            <select key={`plan-${state.values?.plan ?? ""}`} id="plan-plan" name="plan" defaultValue={state.values?.plan || plan} className={`${inputClass} mt-1`}>
              {PLAN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="plan-ciclo" className={labelClass}>
              Facturación
            </label>
            <select
              key={`ciclo-${state.values?.billingCycle ?? ""}`}
              id="plan-ciclo"
              name="billingCycle"
              defaultValue={state.values?.billingCycle || billingCycle}
              className={`${inputClass} mt-1`}
            >
              <option value="monthly">Mensual</option>
              <option value="yearly">Anual</option>
            </select>
          </div>
          <div>
            <label htmlFor="plan-motivo" className={labelClass}>
              Motivo del cambio
            </label>
            <input
              id="plan-motivo"
              name="reason"
              type="text"
              required
              maxLength={200}
              autoComplete="off"
              aria-describedby="plan-motivo-hint"
              defaultValue={state.values?.reason ?? ""}
              className={`${inputClass} mt-1`}
            />
            <p id="plan-motivo-hint" className="mt-1 text-sm text-muted">
              {REASON_HINT}
            </p>
          </div>
          <div>
            <SubmitButton pendingLabel="Cambiando…">Cambiar plan</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function SuspensionForm({ slug, suspended }: { slug: string; suspended: boolean }) {
  return (
    <ActionForm action={setSuspensionAction} className="mt-4 grid max-w-md gap-4">
      {(state) => (
        <>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="suspend" value={suspended ? "false" : "true"} />
          <div>
            <label htmlFor="suspension-motivo" className={labelClass}>
              {suspended ? "Motivo de la reactivación" : "Motivo de la suspensión"}
            </label>
            <input
              id="suspension-motivo"
              name="reason"
              type="text"
              required
              maxLength={200}
              autoComplete="off"
              aria-describedby="suspension-motivo-hint"
              defaultValue={state.values?.reason ?? ""}
              className={`${inputClass} mt-1`}
            />
            <p id="suspension-motivo-hint" className="mt-1 text-sm text-muted">
              {REASON_HINT}
            </p>
          </div>
          <div>
            {suspended ? (
              <SubmitButton pendingLabel="Reactivando…">Reactivar organización</SubmitButton>
            ) : (
              <SubmitButton pendingLabel="Suspendiendo…" className={dangerButtonClass}>
                Suspender organización
              </SubmitButton>
            )}
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function PaymentForm({ slug, today, proposedCoversUntil }: { slug: string; today: string; proposedCoversUntil: string }) {
  return (
    <ActionForm action={registerPaymentAction} className="mt-4 grid max-w-md gap-4">
      {(state) => (
        <>
          <input type="hidden" name="slug" value={slug} />
          <div>
            <label htmlFor="pago-importe" className={labelClass}>
              Importe
            </label>
            <input
              id="pago-importe"
              name="amount"
              type="text"
              inputMode="decimal"
              required
              autoComplete="off"
              aria-describedby="pago-importe-hint"
              defaultValue={state.values?.amount ?? ""}
              className={`${inputClass} mt-1`}
            />
            <p id="pago-importe-hint" className="mt-1 text-sm text-muted">
              Lo que se recibió, con hasta dos decimales (por ejemplo, 20000 o 20.000,50).
            </p>
          </div>
          <div>
            <label htmlFor="pago-moneda" className={labelClass}>
              Moneda
            </label>
            <select key={`moneda-${state.values?.currency ?? ""}`} id="pago-moneda" name="currency" required defaultValue={state.values?.currency ?? ""} className={`${inputClass} mt-1`}>
              <option value="" disabled>
                Elegí la moneda
              </option>
              <option value="ARS">Pesos (ARS)</option>
              <option value="USD">Dólares (USD)</option>
            </select>
          </div>
          <div>
            <label htmlFor="pago-medio" className={labelClass}>
              Cómo se pagó
            </label>
            <select key={`medio-${state.values?.method ?? ""}`} id="pago-medio" name="method" required defaultValue={state.values?.method ?? ""} className={`${inputClass} mt-1`}>
              <option value="" disabled>
                Elegí el medio
              </option>
              <option value="transfer">Transferencia</option>
              <option value="payment_link">Link de pago</option>
              <option value="cash">Efectivo</option>
              <option value="other">Otro medio</option>
            </select>
          </div>
          <div>
            <label htmlFor="pago-referencia" className={labelClass}>
              Referencia (opcional)
            </label>
            <input
              id="pago-referencia"
              name="reference"
              type="text"
              maxLength={120}
              autoComplete="off"
              aria-describedby="pago-referencia-hint"
              defaultValue={state.values?.reference ?? ""}
              className={`${inputClass} mt-1`}
            />
            <p id="pago-referencia-hint" className="mt-1 text-sm text-muted">
              Número de operación o similar. No se puede corregir después y no se muestra al Dueño: sin datos personales.
            </p>
          </div>
          <div>
            <label htmlFor="pago-fecha" className={labelClass}>
              Fecha del pago
            </label>
            <input
              id="pago-fecha"
              name="paidOn"
              type="date"
              required
              defaultValue={state.values?.paidOn || today}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label htmlFor="pago-cubre" className={labelClass}>
              Cubre hasta
            </label>
            <input
              id="pago-cubre"
              name="coversUntil"
              type="date"
              required
              aria-describedby="pago-cubre-hint"
              defaultValue={state.values?.coversUntil || proposedCoversUntil}
              className={`${inputClass} mt-1`}
            />
            <p id="pago-cubre-hint" className="mt-1 text-sm text-muted">
              La cuenta queda vigente hasta el final de ese día. Propuesta: un ciclo después del vencimiento actual (o de hoy, si ya
              venció). Tiene que ser posterior al vencimiento actual; nunca lo acorta. No levanta una suspensión a mano.
            </p>
          </div>
          <div>
            <SubmitButton pendingLabel="Registrando…">Registrar pago</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
