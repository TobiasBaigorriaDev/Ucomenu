import type { BillingState } from "@/lib/entitlements";

const TONE: Record<BillingState, string> = {
  active: "bg-brand text-white",
  grace: "bg-grace-bg text-grace-ink ring-1 ring-inset ring-grace-edge",
  read_only: "bg-readonly-bg text-readonly-ink ring-1 ring-inset ring-readonly-edge",
  suspended: "bg-suspended-bg text-suspended-ink ring-1 ring-inset ring-suspended-edge",
};

const SHORT: Record<BillingState, string> = {
  active: "Al día",
  grace: "En gracia",
  read_only: "Solo lectura",
  suspended: "Suspendida",
};

/** Estado de pago de una organización, siempre con texto (no solo color), con los colores de gravedad de la cuenta. */
export function StatusPill({ state, className = "" }: { state: BillingState; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-sm font-medium ${TONE[state]} ${className}`}>
      {SHORT[state]}
    </span>
  );
}
