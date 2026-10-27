import { formatArs } from "@/lib/money";
import type { SuggestedTip } from "@/lib/propina";

export type TipLabels = { tipSuggested: string; tipTotal: string; tipOptional: string };

export const TIP_LABELS_ES: TipLabels = {
  tipSuggested: "Propina sugerida",
  tipTotal: "Total con propina sugerida",
  tipOptional: "La propina es opcional",
};

/** Mismo desglose en la cuenta del cliente, la precuenta y su impresión. */
export function PropinaSugerida({ tip, labels = TIP_LABELS_ES }: { tip: SuggestedTip | null; labels?: TipLabels }) {
  if (!tip) return null;
  return (
    <div className="mt-4 border-t border-ink/20 pt-3" data-testid="propina-sugerida">
      <p className="flex items-baseline justify-between gap-3 text-base" data-testid="propina-importe" data-centavos={tip.cents}>
        <span>{labels.tipSuggested} ({tip.percent} %)</span>
        <span className="shrink-0 tabular-nums">{formatArs(tip.cents)}</span>
      </p>
      <p className="mt-2 flex items-baseline justify-between gap-3 text-lg font-semibold" data-testid="propina-total" data-centavos={tip.totalCents}>
        <span>{labels.tipTotal}</span>
        <span className="shrink-0 tabular-nums">{formatArs(tip.totalCents)}</span>
      </p>
      <p className="mt-2 text-sm text-muted">{labels.tipOptional}</p>
    </div>
  );
}
