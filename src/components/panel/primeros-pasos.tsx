import Link from "next/link";
import type { Guide, GuideStepStatus } from "@/lib/guia/primeros-pasos";

const STATUS_LABEL: Record<GuideStepStatus, string> = {
  done: "Listo",
  todo: "Para hacer",
  waiting: "Después",
  paused: "En pausa",
};

const badgeClass = "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium";
const primaryClass =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-cobalt px-5 py-2 text-base font-medium text-white";
const secondaryClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-ink/40 px-4 py-2 text-base font-medium text-ink";

/**
 * Guía de primeros pasos del Resumen. El estado de cada paso va siempre en texto («Listo», «Para hacer»…), no solo en
 * color o marca. Con todo hecho se resume en una línea con atajos.
 */
export function PrimerosPasos({ guide }: { guide: Guide }) {
  if (guide.kind === "ready") {
    return (
      <section aria-labelledby="primeros-pasos" data-testid="guia-lista" className="mt-8 rounded-3xl bg-sand p-5 ring-1 ring-inset ring-ink/15 sm:p-6">
        <h2 id="primeros-pasos" className="font-display text-2xl">
          Primeros pasos: completos
        </h2>
        <p className="mt-2 max-w-prose text-lg">{guide.summary}</p>
        {guide.hints.map((hint) => (
          <p key={hint} className="mt-2 max-w-prose text-base text-muted" data-testid="guia-sugerencia">
            {hint}
          </p>
        ))}
        <div className="mt-4 flex flex-wrap gap-2">
          {guide.links.map((link) => (
            <Link key={link.href} href={link.href} className={secondaryClass}>
              {link.label}
            </Link>
          ))}
        </div>
      </section>
    );
  }

  // El botón principal es el del primer paso pendiente; el resto, secundarios.
  const firstTodo = guide.steps.find((step) => step.status === "todo")?.id;

  return (
    <section aria-labelledby="primeros-pasos" data-testid="guia-pasos" className="mt-8 rounded-3xl bg-blush p-5 sm:p-6">
      <h2 id="primeros-pasos" className="font-display text-2xl">
        Primeros pasos
      </h2>
      <p className="mt-1 max-w-prose text-base text-ink/80">Tres pasos para que tus clientes vean tu carta desde la mesa.</p>
      {guide.blockedNotice ? (
        <p className="mt-3 max-w-prose text-base font-medium" data-testid="guia-bloqueada">
          {guide.blockedNotice}
        </p>
      ) : null}
      <ol className="mt-4 panel-list">
        {guide.steps.map((step, index) => (
          <li key={step.id} className="border-b border-ink/20 py-4 last:border-b-0 last:pb-0" data-testid="guia-paso" data-step={step.id} data-status={step.status}>
            <div className="flex items-baseline gap-3 text-lg">
              <span className="min-w-0 font-medium break-words">
                {index + 1}. {step.title}
              </span>
              <span aria-hidden className="leader" />
              <span className={`${badgeClass} ${step.status === "done" ? "bg-brand text-white" : "bg-white/70 text-ink"}`}>
                {step.status === "done" ? (
                  <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                ) : null}
                {STATUS_LABEL[step.status]}
              </span>
            </div>
            <p className="mt-1 max-w-prose text-base text-ink/80">{step.detail}</p>
            {step.href && step.cta ? (
              <p className="mt-3">
                <Link href={step.href} className={step.id === firstTodo ? primaryClass : secondaryClass}>
                  {step.cta}
                </Link>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
