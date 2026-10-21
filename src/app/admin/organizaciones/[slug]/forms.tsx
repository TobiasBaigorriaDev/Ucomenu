"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { dangerButtonClass, inputClass, labelClass } from "@/components/panel/styles";
import {
  addExistingOwnerAction,
  changePlanAction,
  deleteOrganizationAction,
  endAddonAction,
  registerPaymentAction,
  setAddonAction,
  setOrganizationActiveAction,
  setSuspensionAction,
  voidPaymentAction,
} from "../../actions";

const PLAN_OPTIONS = [
  { value: "basic", label: "Básico" },
  { value: "pro", label: "Pro" },
  { value: "premium", label: "Premium" },
] as const;

const REASON_HINT = "Queda en los movimientos y no se puede borrar. No pongas datos personales.";

/*
 * Los <select> llevan `key` según lo devuelto por la acción: React 19 reinicia el formulario al terminar la acción y un
 * <select> no vuelve al valor que se le devolvió en `defaultValue` (quedaría en «Elegí…» y el envío siguiente se bloquearía
 * en silencio). Con otra `key` se vuelve a montar con el valor correcto. En el cambio de plan la `key` incluye también el plan y
 * el ciclo guardados (props): tras un éxito `state.values` no cambia y, sin eso, el reinicio devolvería el valor anterior.
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
            <select key={`plan-${plan}-${state.values?.plan ?? ""}`} id="plan-plan" name="plan" defaultValue={state.values?.plan || plan} className={`${inputClass} mt-1`}>
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
              key={`ciclo-${billingCycle}-${state.values?.billingCycle ?? ""}`}
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

/**
 * Anular un pago (ficha anular-pagos). Va dentro del pago, plegado: no es una acción de todos los días. El aviso de qué
 * pasa con el vencimiento lo arma la página (`consequence`) y la persona lo confirma con una casilla.
 */
export function VoidPaymentForm({ slug, paymentId, consequence }: { slug: string; paymentId: string; consequence: string }) {
  return (
    <details className="mt-2">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-base text-danger underline underline-offset-2">Anular este pago</summary>
      <ActionForm action={voidPaymentAction} className="mt-2 grid max-w-md gap-4">
        {(state) => (
          <>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="paymentId" value={paymentId} />
            <p className="max-w-prose text-base leading-relaxed" data-testid="aviso-anular-pago">
              {consequence}
            </p>
            <div>
              <label htmlFor={`anular-motivo-${paymentId}`} className={labelClass}>
                Motivo de la anulación
              </label>
              <input
                id={`anular-motivo-${paymentId}`}
                name="reason"
                type="text"
                required
                maxLength={200}
                autoComplete="off"
                aria-describedby={`anular-motivo-hint-${paymentId}`}
                defaultValue={state.values?.reason ?? ""}
                className={`${inputClass} mt-1`}
              />
              <p id={`anular-motivo-hint-${paymentId}`} className="mt-1 text-sm text-muted">
                {REASON_HINT}
              </p>
            </div>
            <label className="flex min-h-11 items-start gap-3 text-base">
              <input type="checkbox" name="confirmed" required className="mt-1 size-5 shrink-0" />
              <span>Entiendo que el vencimiento cambia en el acto.</span>
            </label>
            <div>
              <SubmitButton pendingLabel="Anulando…" className={dangerButtonClass}>
                Anular pago
              </SubmitButton>
            </div>
          </>
        )}
      </ActionForm>
    </details>
  );
}

/**
 * Activar un add-on o cambiar sus packs y su fecha de fin (ficha addons-y-baja-de-organizaciones). Los valores iniciales
 * son los vigentes; en el aviso se ve qué cupo queda. La base valida de nuevo (plan que lo admite, tope de packs, fecha).
 */
export function AddonForm({
  slug,
  addon,
  active,
  extraPacks,
  endsOn,
  maxPacks,
}: {
  slug: string;
  addon: string;
  active: boolean;
  extraPacks: number;
  endsOn: string;
  maxPacks: number;
}) {
  return (
    <ActionForm action={setAddonAction} className="mt-4 grid max-w-md gap-4">
      {(state) => (
        <>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="addon" value={addon} />
          <div>
            <label htmlFor={`addon-packs-${addon}`} className={labelClass}>
              Packs extra
            </label>
            <input
              id={`addon-packs-${addon}`}
              name="extraPacks"
              type="number"
              inputMode="numeric"
              min={0}
              max={maxPacks}
              step={1}
              required
              aria-describedby={`addon-packs-hint-${addon}`}
              defaultValue={state.values?.extraPacks ?? String(extraPacks)}
              className={`${inputClass} mt-1`}
            />
            <p id={`addon-packs-hint-${addon}`} className="mt-1 text-sm text-muted">
              Cada pack suma platos al cupo base. De 0 a {maxPacks}.
            </p>
          </div>
          <div>
            <label htmlFor={`addon-fin-${addon}`} className={labelClass}>
              Termina el (opcional)
            </label>
            <input
              id={`addon-fin-${addon}`}
              name="endsOn"
              type="date"
              aria-describedby={`addon-fin-hint-${addon}`}
              defaultValue={state.values?.endsOn ?? endsOn}
              className={`${inputClass} mt-1`}
            />
            <p id={`addon-fin-hint-${addon}`} className="mt-1 text-sm text-muted">
              Vale hasta el final de ese día. Vacío = sin fecha de fin.
            </p>
          </div>
          <div>
            <label htmlFor={`addon-motivo-${addon}`} className={labelClass}>
              {active ? "Motivo del cambio" : "Motivo de la activación"}
            </label>
            <input
              id={`addon-motivo-${addon}`}
              name="reason"
              type="text"
              required
              maxLength={200}
              autoComplete="off"
              aria-describedby={`addon-motivo-hint-${addon}`}
              defaultValue={state.values?.reason ?? ""}
              className={`${inputClass} mt-1`}
            />
            <p id={`addon-motivo-hint-${addon}`} className="mt-1 text-sm text-muted">
              {REASON_HINT}
            </p>
          </div>
          <div>
            <SubmitButton pendingLabel="Guardando…">{active ? "Guardar cambios" : "Activar add-on"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Finalizar un add-on vigente. Plegado: no es de todos los días. */
export function EndAddonForm({ slug, addon, name }: { slug: string; addon: string; name: string }) {
  return (
    <details className="mt-4">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-base text-danger underline underline-offset-2">Finalizar {name}</summary>
      <ActionForm action={endAddonAction} className="mt-2 grid max-w-md gap-4">
        {(state) => (
          <>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="addon" value={addon} />
            <p className="max-w-prose text-base leading-relaxed">
              El add-on deja de estar vigente en el acto. Se conservan los packs extra y los datos; se puede volver a activar después.
            </p>
            <div>
              <label htmlFor={`addon-fin-motivo-${addon}`} className={labelClass}>
                Motivo
              </label>
              <input
                id={`addon-fin-motivo-${addon}`}
                name="reason"
                type="text"
                required
                maxLength={200}
                autoComplete="off"
                aria-describedby={`addon-fin-motivo-hint-${addon}`}
                defaultValue={state.values?.reason ?? ""}
                className={`${inputClass} mt-1`}
              />
              <p id={`addon-fin-motivo-hint-${addon}`} className="mt-1 text-sm text-muted">
                {REASON_HINT}
              </p>
            </div>
            <div>
              <SubmitButton pendingLabel="Finalizando…" className={dangerButtonClass}>
                Finalizar add-on
              </SubmitButton>
            </div>
          </>
        )}
      </ActionForm>
    </details>
  );
}

/**
 * Dar de baja o reactivar la organización (ficha addons-y-baja-de-organizaciones). La baja corta el acceso del personal y
 * oculta la carta: pide una casilla de confirmación. Reactivar no la pide (devuelve el acceso, no lo quita).
 */
export function OrganizationActiveForm({ slug, active, name }: { slug: string; active: boolean; name: string }) {
  return (
    <ActionForm action={setOrganizationActiveAction} className="mt-4 grid max-w-md gap-4">
      {(state) => (
        <>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="active" value={active ? "false" : "true"} />
          <div>
            <label htmlFor="baja-motivo" className={labelClass}>
              {active ? "Motivo de la baja" : "Motivo de la reactivación"}
            </label>
            <input
              id="baja-motivo"
              name="reason"
              type="text"
              required
              maxLength={200}
              autoComplete="off"
              aria-describedby="baja-motivo-hint"
              defaultValue={state.values?.reason ?? ""}
              className={`${inputClass} mt-1`}
            />
            <p id="baja-motivo-hint" className="mt-1 text-sm text-muted">
              {REASON_HINT}
            </p>
          </div>
          {active ? (
            <label className="flex min-h-11 items-start gap-3 text-base">
              <input type="checkbox" name="confirmed" required className="mt-1 size-5 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">Entiendo que «{name}» deja de mostrar su carta y que su personal no podrá entrar hasta reactivarla.</span>
            </label>
          ) : null}
          <div>
            {active ? (
              <SubmitButton pendingLabel="Dando de baja…" className={dangerButtonClass}>
                Dar de baja la organización
              </SubmitButton>
            ) : (
              <SubmitButton pendingLabel="Reactivando…">Reactivar la organización</SubmitButton>
            )}
          </div>
        </>
      )}
    </ActionForm>
  );
}

/**
 * Borrado definitivo (ficha borrado-de-organizaciones, ADR 0028). Solo se muestra cuando la baja cumplió los 30 días. Pide el
 * identificador escrito (no se puede pegar por error con un clic), el motivo y una casilla. La base lo vuelve a exigir todo.
 */
export function DeleteOrganizationForm({ slug, name }: { slug: string; name: string }) {
  return (
    <ActionForm action={deleteOrganizationAction} className="mt-4 grid max-w-md gap-4">
      {(state) => (
        <>
          <input type="hidden" name="slug" value={slug} />
          <div>
            <label htmlFor="borrado-slug" className={labelClass}>
              Escribí el identificador <span className="font-mono [overflow-wrap:anywhere]">{slug}</span> para confirmar
            </label>
            <input
              id="borrado-slug"
              name="confirmSlug"
              type="text"
              required
              maxLength={64}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              defaultValue={state.values?.confirmSlug ?? ""}
              className={`${inputClass} mt-1 font-mono`}
            />
          </div>
          <div>
            <label htmlFor="borrado-motivo" className={labelClass}>
              Motivo del borrado
            </label>
            <input
              id="borrado-motivo"
              name="reason"
              type="text"
              required
              maxLength={200}
              autoComplete="off"
              aria-describedby="borrado-motivo-hint"
              defaultValue={state.values?.reason ?? ""}
              className={`${inputClass} mt-1`}
            />
            <p id="borrado-motivo-hint" className="mt-1 text-sm text-muted">
              {REASON_HINT}
            </p>
          </div>
          <label className="flex min-h-11 items-start gap-3 text-base">
            <input type="checkbox" name="confirmed" required className="mt-1 size-5 shrink-0" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              Entiendo que se borra «{name}» con su carta, sus sucursales, sus mesas y QR, su suscripción y su personal, que no se puede
              deshacer y que corrí el respaldo antes.
            </span>
          </label>
          <div>
            <SubmitButton pendingLabel="Borrando…" className={dangerButtonClass}>
              Borrar definitivamente
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/**
 * Sumar un Dueño que ya tiene cuenta. Dos envíos: el primero busca la cuenta y muestra dónde trabaja; el segundo, con la
 * casilla marcada, la suma. El email queda fijo entre los dos pasos para que la confirmación sea sobre la cuenta que se vio.
 */
export function AddOwnerForm({ slug }: { slug: string }) {
  return (
    <ActionForm action={addExistingOwnerAction} className="mt-4 grid max-w-md gap-4">
      {(state) => {
        const confirming = state.values?.step === "confirm";
        return (
          <>
            <input type="hidden" name="slug" value={slug} />
            <div>
              <label htmlFor="dueno-email" className={labelClass}>
                Email de la cuenta
              </label>
              <input
                id="dueno-email"
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="off"
                readOnly={confirming}
                defaultValue={state.values?.email ?? ""}
                className={`${inputClass} mt-1`}
              />
            </div>
            {confirming ? (
              <div className="grid gap-3">
                <p className="max-w-prose text-base leading-relaxed" data-testid="aviso-dueno-existente">
                  Sumar un Dueño le da control total sobre este local. Confirmá solo si es la misma persona: si la cuenta era de Personal
                  de otro local, el Dueño de ese local pudo haber elegido su contraseña.
                </p>
                <input type="hidden" name="userId" value={state.values?.userId ?? ""} />
                <label className="flex min-h-11 items-start gap-3 text-base">
                  <input type="checkbox" name="confirmed" required className="mt-1 size-5 shrink-0" />
                  <span>Confirmo que {state.values?.email} es la persona que va a ser Dueño de esta organización.</span>
                </label>
              </div>
            ) : null}
            <div>
              <SubmitButton pendingLabel={confirming ? "Sumando…" : "Buscando…"}>{confirming ? "Sumar como Dueño" : "Buscar cuenta"}</SubmitButton>
            </div>
          </>
        );
      }}
    </ActionForm>
  );
}
