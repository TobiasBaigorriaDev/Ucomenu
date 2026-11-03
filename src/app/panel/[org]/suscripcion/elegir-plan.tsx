"use client";

import { useState } from "react";
import { IconCheck } from "@/components/marketing/icons";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { Mark } from "@/components/panel/mark";
import { formatMoney } from "@/lib/admin/format";
import { optionProblem, type PlanOption } from "@/lib/cobro/cotizacion";
import { PLAN_NAME } from "@/lib/entitlements";
import { PLAN_DESTACADOS, PLAN_LIMITES } from "@/lib/marketing/planes";
import { payAction } from "./actions";

type Cycle = "monthly" | "yearly";
const CYCLE_NAME: Record<Cycle, string> = { monthly: "Por mes", yearly: "Por año" };
const CYCLE_UNIT: Record<Cycle, string> = { monthly: "por mes", yearly: "por año" };

/** El ahorro real del pago anual, según los importes de la base. `null` si no hay con qué compararlo. */
function yearlySaving(options: PlanOption[]): number | null {
  for (const plan of ["pro", "basic"]) {
    const monthly = options.find((o) => o.plan === plan && o.cycle === "monthly");
    const yearly = options.find((o) => o.plan === plan && o.cycle === "yearly");
    if (monthly?.available && yearly?.available) {
      const percent = Math.round((1 - yearly.amountCents / (monthly.amountCents * 12)) * 100);
      return percent > 0 ? percent : null;
    }
  }
  return null;
}

/**
 * Elegir plan y ciclo al pagar (ficha registro-autoservicio, ADR 0053). Los importes son los de la base y el formulario manda solo los
 * nombres: la base vuelve a decidir si se puede y cuánto cuesta. El plan cambia cuando se registra el pago, no antes.
 */
export function PlanChooser({ slug, options, current, extraBranches }: { slug: string; options: PlanOption[]; current: string | null; extraBranches: number }) {
  const available = options.filter((option) => option.available);
  const start = available.find((o) => `${o.plan}:${o.cycle}` === current) ?? available.find((o) => o.plan === "pro") ?? available[0];
  const [plan, setPlan] = useState(start.plan);
  const [cycle, setCycle] = useState<Cycle>(start.cycle === "yearly" ? "yearly" : "monthly");

  const cycles = (["monthly", "yearly"] as const).filter((c) => available.some((o) => o.cycle === c));
  const inCycle = options.filter((o) => o.cycle === cycle);
  const selected = inCycle.find((o) => o.plan === plan && o.available) ?? inCycle.find((o) => o.available);
  const saving = yearlySaving(options);
  // Pro primero: es el plan que abre la pantalla.
  const pro = inCycle.find((o) => o.plan === "pro");
  const others = inCycle.filter((o) => o.plan !== "pro");

  return (
    <ActionForm action={payAction} className="mt-4">
      <input type="hidden" name="org" value={slug} />
      {selected ? <input type="hidden" name="eleccion" value={`${selected.plan}:${selected.cycle}`} /> : null}

      {cycles.length > 1 ? (
        <fieldset>
          <legend className="sr-only">Cada cuánto pagás</legend>
          <div className="inline-flex rounded-full border border-ink/25 p-1" data-testid="elegir-ciclo">
            {cycles.map((value) => (
              <label
                key={value}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-base font-medium transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-cobalt ${cycle === value ? "bg-ink text-porcelain" : "text-ink hover:bg-ink/5"}`}
              >
                <input type="radio" name="ciclo-vista" className="sr-only" checked={cycle === value} onChange={() => setCycle(value)} />
                {CYCLE_NAME[value]}
                {value === "yearly" && saving ? <span className="text-sm font-normal">{saving} % menos</span> : null}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset className="mt-4">
        <legend className="sr-only">Elegí tu plan</legend>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-testid="elegir-plan">
          {pro ? <ProCell option={pro} cycle={cycle} checked={selected?.plan === "pro"} onSelect={() => setPlan("pro")} /> : null}
          {others.map((option) => (
            <QuietCell key={option.plan} option={option} cycle={cycle} checked={selected?.plan === option.plan} onSelect={() => setPlan(option.plan)} />
          ))}
        </div>
      </fieldset>

      {extraBranches > 0 ? <p className="mt-3 text-sm text-muted">El importe incluye tus sucursales adicionales.</p> : null}
      <div className="mt-5">
        <SubmitButton pendingLabel="Abriendo Mercado Pago…">Pagar con Mercado Pago</SubmitButton>
      </div>
      <p className="mt-3 max-w-prose text-sm text-muted">
        Vas a pagar en Mercado Pago, con el medio que prefieras. El plan cambia cuando se aprueba el pago, y el período nuevo suma a los días que te quedan.
      </p>
    </ActionForm>
  );
}

function Price({ option, cycle, large }: { option: Extract<PlanOption, { available: true }>; cycle: Cycle; large?: boolean }) {
  // La moneda va chica al lado del número: así el importe entra en una línea a 390 px.
  const money = formatMoney(option.amountCents, option.currency);
  const amount = money.endsWith(` ${option.currency}`) ? money.slice(0, -option.currency.length - 1) : money;
  return (
    <>
      <span className={`mt-3 block font-display leading-none tabular-nums whitespace-nowrap ${large ? "text-[clamp(2.25rem,0.75rem+8vw,4rem)]" : "text-4xl"}`}>
        {amount}
        {amount !== money ? <span className="ml-2 font-sans text-base font-normal"> {option.currency}</span> : null}
      </span>
      <span className="mt-1 block text-base">
        {CYCLE_UNIT[cycle]}
        {cycle === "yearly" ? ` · equivale a ${formatMoney(Math.round(option.amountCents / 12), option.currency)} por mes` : ""}
      </span>
    </>
  );
}

/** Pro: la celda que abre la pantalla, a pleno color y con lo que suma. Se ve igual de fuerte elegida o no; la elección la marca el anillo. */
function ProCell({ option, cycle, checked, onSelect }: { option: PlanOption; cycle: Cycle; checked: boolean; onSelect: () => void }) {
  const problem = option.available ? null : optionProblem(option);
  return (
    <label
      className={`relative block overflow-hidden rounded-3xl bg-brand-deep p-5 text-white transition-shadow focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-cobalt sm:p-6 ${option.available ? "cursor-pointer" : "opacity-70"} ${checked ? "ring-2 ring-brand-deep ring-offset-2 ring-offset-porcelain" : ""}`}
    >
      <Mark className="pointer-events-none absolute -top-6 -right-8 h-28 w-auto text-white/10" />
      <span className="relative flex items-center gap-3">
        <input type="radio" name="plan-vista" checked={checked} disabled={!option.available} onChange={onSelect} aria-label={`Pro ${cycle === "yearly" ? "anual" : "mensual"}`} className="size-5 shrink-0 accent-white" />
        <span className="font-display text-3xl leading-none">{PLAN_NAME.pro}</span>
        <span className="rounded-full bg-white px-2.5 py-0.5 text-sm font-medium text-brand-deep">Recomendado</span>
      </span>
      <span className="relative block">
        {option.available ? <Price option={option} cycle={cycle} large /> : <span className="mt-3 block text-sm">No disponible{problem ? `: ${problem}` : ""}.</span>}
      </span>
      <span className="relative mt-4 block text-base font-medium">Tu salón entero, en vivo:</span>
      <ul className="relative mt-2 grid gap-2 text-base">
        {PLAN_DESTACADOS.pro.map((item) => (
          <li key={item} className="flex items-start gap-2 [&>svg]:mt-1 [&>svg]:size-4 [&>svg]:shrink-0">
            <IconCheck />
            {item}
          </li>
        ))}
      </ul>
      <span className="relative mt-4 block border-t border-white/25 pt-3 text-sm text-white/85">{PLAN_LIMITES.pro}</span>
    </label>
  );
}

function QuietCell({ option, cycle, checked, onSelect }: { option: PlanOption; cycle: Cycle; checked: boolean; onSelect: () => void }) {
  const problem = option.available ? null : optionProblem(option);
  if (!option.available && !problem) return null;
  const name = PLAN_NAME[option.plan] ?? option.plan;
  return (
    <label
      className={`block rounded-3xl border border-ink/20 p-5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-cobalt sm:p-6 ${option.available ? "cursor-pointer" : "opacity-70"} ${checked ? "ring-2 ring-ink ring-offset-2 ring-offset-porcelain" : ""}`}
    >
      <span className="flex items-center gap-3">
        <input type="radio" name="plan-vista" checked={checked} disabled={!option.available} onChange={onSelect} aria-label={`${name} ${cycle === "yearly" ? "anual" : "mensual"}`} className="size-5 shrink-0" />
        <span className="font-display text-2xl leading-none">{name}</span>
      </span>
      {option.available ? <Price option={option} cycle={cycle} /> : <span className="mt-3 block text-sm text-muted">No disponible: {problem}.</span>}
      {PLAN_LIMITES[option.plan] ? <span className="mt-3 block text-sm text-muted">Carta digital con QR. {PLAN_LIMITES[option.plan]}</span> : null}
    </label>
  );
}
