"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { formatMoney } from "@/lib/admin/format";
import { optionProblem, type PlanOption } from "@/lib/cobro/cotizacion";
import { PLAN_NAME } from "@/lib/entitlements";
import { payAction } from "./actions";

const CYCLE_LABEL: Record<string, string> = { monthly: "por mes", yearly: "por año" };

/**
 * Elegir plan y ciclo al pagar (ficha registro-autoservicio, ADR 0053). Los importes son los de la base y el formulario manda solo los
 * nombres: la base vuelve a decidir si se puede y cuánto cuesta. El plan cambia cuando se registra el pago, no antes.
 */
export function PlanChooser({ slug, options, current, extraBranches }: { slug: string; options: PlanOption[]; current: string | null; extraBranches: number }) {
  const available = options.filter((option) => option.available);
  const initial = current && available.some((o) => `${o.plan}:${o.cycle}` === current) ? current : `${available[0].plan}:${available[0].cycle}`;
  const [selected, setSelected] = useState(initial);

  return (
    <ActionForm action={payAction} className="mt-4">
      <input type="hidden" name="org" value={slug} />
      <fieldset>
        <legend className="text-base font-medium">Elegí tu plan</legend>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="elegir-plan">
          {options.map((option) => {
            const value = `${option.plan}:${option.cycle}`;
            const name = `${PLAN_NAME[option.plan] ?? option.plan} ${option.cycle === "yearly" ? "anual" : "mensual"}`;
            const problem = option.available ? null : optionProblem(option);
            if (!option.available && !problem) return null;
            return (
              <li key={value}>
                <label className={`flex min-h-16 items-start gap-3 rounded-2xl border border-ink/20 p-3 ${option.available ? "" : "opacity-70"}`}>
                  <input
                    type="radio"
                    name="eleccion"
                    value={value}
                    checked={selected === value}
                    disabled={!option.available}
                    onChange={() => setSelected(value)}
                    className="mt-1 size-5 shrink-0"
                  />
                  <span>
                    <span className="block font-medium">{name}</span>
                    {option.available ? (
                      <span className="block text-base tabular-nums text-muted">
                        {formatMoney(option.amountCents, option.currency)} {CYCLE_LABEL[option.cycle]}
                      </span>
                    ) : (
                      <span className="block text-sm text-muted">No disponible: {problem}.</span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      {extraBranches > 0 ? <p className="mt-3 text-sm text-muted">El importe incluye tus sucursales adicionales.</p> : null}
      <div className="mt-4">
        <SubmitButton pendingLabel="Abriendo Mercado Pago…">Pagar con Mercado Pago</SubmitButton>
      </div>
      <p className="mt-3 max-w-prose text-sm text-muted">
        Vas a pagar en Mercado Pago, con el medio que prefieras. El plan cambia cuando se aprueba el pago, y el período nuevo suma a los días que te quedan.
      </p>
    </ActionForm>
  );
}
