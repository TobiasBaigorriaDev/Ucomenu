"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { inputClass, labelClass, secondaryButtonClass } from "@/components/panel/styles";
import type { BranchAvailability } from "@/lib/carta/availability";
import { priceToInput } from "@/lib/carta/price";
import { formatArs } from "@/lib/money";
import { availabilityAction, branchPriceAction, visibilityAction } from "./availability-actions";

/**
 * Ajustes por sucursal de un plato (ADR 0035). Con UNA sola sucursal se conserva la pantalla de siempre (solo «agotado»): ocultar
 * o cambiar el precio de la única sucursal sería lo mismo que desactivar el plato o cambiar su precio. Con varias, cada sucursal
 * tiene tres controles independientes (visibilidad, disponibilidad y precio propio) y cada uno escribe solo lo suyo.
 */
export function AvailabilityForms({ orgSlug, productId, branches, basePriceCents, canWrite }: {
  orgSlug: string; productId: string; branches: BranchAvailability[]; basePriceCents: number; canWrite: boolean;
}) {
  const multi = branches.length > 1;

  const hidden = (branch: BranchAvailability) => (
    <>
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="product" value={productId} />
      <input type="hidden" name="branch" value={branch.id} />
    </>
  );

  return <section aria-labelledby="availability-title" className="panel-cell mt-6">
    <h2 id="availability-title" className="font-display text-2xl">{multi ? "Sucursales" : "Disponibilidad por sucursal"}</h2>
    {multi ? (
      <p className="mt-2 max-w-prose text-base text-muted">
        Todo esto es opcional y afecta solo a la sucursal elegida. Sin ajustes, cada sucursal muestra el plato al precio general ({formatArs(basePriceCents)}).
        Agotado sigue visible en la carta con su aviso; oculto no aparece en esa sucursal.
      </p>
    ) : (
      <p className="mt-2 text-base text-muted">Agotado sigue visible en la carta con su aviso. El cambio solo afecta a la sucursal elegida.</p>
    )}
    {branches.length ? <ul className="mt-4 divide-y divide-ink/15">
      {branches.map((branch) => <li key={branch.id} data-testid="disponibilidad-sucursal" data-branch={branch.id} className="py-4">
        <p className="font-medium [overflow-wrap:anywhere]">{branch.name}</p>
        <p className="mt-1 text-sm text-muted" data-testid="estado-sucursal">
          {multi ? <><span>{branch.is_visible ? "Se muestra" : "Oculto"}</span>{" · "}</> : null}
          <span>{branch.is_available ? "Disponible" : "Agotado"}</span>
          {multi ? <>{" · "}<span>{branch.price_cents === null ? `Precio general (${formatArs(basePriceCents)})` : `Precio propio (${formatArs(branch.price_cents)})`}</span></> : null}
        </p>

        <ActionForm action={availabilityAction} className="mt-2">
          <fieldset disabled={!canWrite}>
            {hidden(branch)}
            <input type="hidden" name="available" value={String(!branch.is_available)} />
            <SubmitButton className={secondaryButtonClass} pendingLabel="Guardando…">
              {branch.is_available ? "Marcar agotado" : "Marcar disponible"}
            </SubmitButton>
          </fieldset>
        </ActionForm>

        {multi ? <>
          <ActionForm action={visibilityAction} className="mt-2">
            <fieldset disabled={!canWrite}>
              {hidden(branch)}
              <input type="hidden" name="visible" value={String(!branch.is_visible)} />
              <SubmitButton className={secondaryButtonClass} pendingLabel="Guardando…">
                {branch.is_visible ? "Ocultar en esta sucursal" : "Mostrar en esta sucursal"}
              </SubmitButton>
            </fieldset>
          </ActionForm>

          <ActionForm action={branchPriceAction} className="mt-3 max-w-sm">
            {(state) => (
              <fieldset disabled={!canWrite} className="grid gap-2">
                {hidden(branch)}
                <label htmlFor={`precio-${branch.id}`} className={labelClass}>Precio propio en pesos</label>
                <input
                  id={`precio-${branch.id}`}
                  key={String(branch.price_cents)}
                  name="price"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="Precio general"
                  defaultValue={state.values?.price ?? (branch.price_cents === null ? "" : priceToInput(branch.price_cents))}
                  className={inputClass}
                />
                <div className="flex flex-wrap gap-2">
                  <SubmitButton className={secondaryButtonClass} pendingLabel="Guardando…">Guardar precio</SubmitButton>
                  {branch.price_cents === null ? null : (
                    <button type="submit" name="intent" value="reset" className={secondaryButtonClass}>Usar precio general</button>
                  )}
                </div>
              </fieldset>
            )}
          </ActionForm>
        </> : null}
      </li>)}
    </ul> : <p className="mt-4 text-muted">Este local todavía no tiene sucursales.</p>}
  </section>;
}
