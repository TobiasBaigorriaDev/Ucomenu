"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { setTipPercentAction } from "./actions";

export function TipForm({ orgSlug, id, name, percent, canWrite }: {
  orgSlug: string; id: string; name: string; percent: number | null; canWrite: boolean;
}) {
  const [enabled, setEnabled] = useState(percent !== null);
  const [draft, setDraft] = useState(String(percent ?? 10));
  return (
    <details className="mt-4 border-t border-ink/15 pt-4" data-testid="propina-config">
      <summary className="min-h-11 cursor-pointer text-base font-medium">
        Propina sugerida · {name} · {percent === null ? "Desactivada" : `${percent} %`}
      </summary>
      <ActionForm action={setTipPercentAction} className="mt-3 max-w-lg">
        {() => (
          <fieldset disabled={!canWrite} className="grid gap-3">
            <input type="hidden" name="org" value={orgSlug} />
            <input type="hidden" name="id" value={id} />
            <label className="flex min-h-11 items-center gap-3 text-base font-medium">
              <input type="checkbox" name="enabled" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="size-5 accent-brand" />
              Mostrar propina sugerida
            </label>
            <label className="grid gap-1 text-base font-medium" htmlFor={`tip-${id}`}>
              Porcentaje de propina (%)
              <input id={`tip-${id}`} name="percent" type="number" min={1} max={100} step={1} required={enabled} disabled={!enabled}
                value={draft} onChange={(event) => setDraft(event.target.value)} aria-describedby={`tip-help-${id}`}
                className="min-h-11 w-28 rounded-lg border border-ink/30 bg-white px-3 py-2 disabled:opacity-50" />
            </label>
            <p id={`tip-help-${id}`} className="text-base text-muted">
              Elegí un porcentaje entero entre 1 y 100. Se calcula sobre el consumo y se muestra como opcional en la cuenta del cliente y en la precuenta, incluida la impresión. No registra un cobro.
            </p>
            <div><SubmitButton pendingLabel="Guardando…">Guardar propina</SubmitButton></div>
          </fieldset>
        )}
      </ActionForm>
    </details>
  );
}
