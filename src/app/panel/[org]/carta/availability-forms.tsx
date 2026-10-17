"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { secondaryButtonClass } from "@/components/panel/styles";
import type { BranchAvailability } from "@/lib/carta/availability";
import { availabilityAction } from "./availability-actions";

export function AvailabilityForms({ orgSlug, productId, branches, canWrite }: {
  orgSlug: string; productId: string; branches: BranchAvailability[]; canWrite: boolean;
}) {
  return <section aria-labelledby="availability-title" className="mt-12">
    <h2 id="availability-title" className="font-display text-2xl">Disponibilidad por sucursal</h2>
    <p className="mt-2 text-base text-muted">Agotado sigue visible en la carta con su aviso. El cambio solo afecta a la sucursal elegida.</p>
    {branches.length ? <ul className="mt-4 divide-y divide-ink/15">
      {branches.map((branch) => <li key={branch.id} data-testid="disponibilidad-sucursal" data-branch={branch.id} className="py-4">
        <p className="font-medium [overflow-wrap:anywhere]">{branch.name}</p>
        <p className="mt-1 text-sm text-muted">{branch.is_available ? "Disponible" : "Agotado"}</p>
        <ActionForm action={availabilityAction} className="mt-2">
          <fieldset disabled={!canWrite}>
            <input type="hidden" name="org" value={orgSlug} />
            <input type="hidden" name="product" value={productId} />
            <input type="hidden" name="branch" value={branch.id} />
            <input type="hidden" name="available" value={String(!branch.is_available)} />
            <SubmitButton className={secondaryButtonClass} pendingLabel="Guardando…">
              {branch.is_available ? "Marcar agotado" : "Marcar disponible"}
            </SubmitButton>
          </fieldset>
        </ActionForm>
      </li>)}
    </ul> : <p className="mt-4 text-muted">Este local todavía no tiene sucursales.</p>}
  </section>;
}
