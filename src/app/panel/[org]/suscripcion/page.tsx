import type { Metadata } from "next";
import { getEntitlements, requireOwner } from "@/lib/auth/session";
import { formatDateWithYear, PLAN_NAME, type BillingState } from "@/lib/entitlements";

export const metadata: Metadata = { title: "Suscripción" };

const STATE_LABEL: Record<BillingState, string> = {
  active: "Al día",
  grace: "Vencida, en período de gracia",
  read_only: "Vencida, en solo lectura",
  suspended: "Suspendida",
};

const CYCLE_LABEL: Record<string, string> = { monthly: "Mensual", yearly: "Anual" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-3 border-b border-ink/15 py-3 text-lg">
      <span>{label}</span>
      <span aria-hidden className="leader" />
      <span className="text-right tabular-nums">{children}</span>
    </li>
  );
}

/** Solo Dueño: el Staff no ve el plan ni las fechas (ADR 0006). La comprobación es del servidor. */
export default async function SubscriptionPage({ params }: PageProps<"/panel/[org]/suscripcion">) {
  const { org } = await params;
  const { membership } = await requireOwner(org, `/panel/${org}/suscripcion`);
  const ent = await getEntitlements(membership.org.id);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-4xl leading-tight">Suscripción</h1>

      {ent ? (
        <ul className="mt-6 border-t border-ink/15">
          <Row label="Plan">{ent.plan ? (PLAN_NAME[ent.plan] ?? ent.plan) : "Sin datos"}</Row>
          {ent.billingCycle ? <Row label="Facturación">{CYCLE_LABEL[ent.billingCycle] ?? ent.billingCycle}</Row> : null}
          <Row label="Estado">{STATE_LABEL[ent.state]}</Row>
          {ent.periodEnd ? <Row label="Vence">{formatDateWithYear(ent.periodEnd)}</Row> : null}
          {ent.daysLate ? <Row label="Días de atraso">{ent.daysLate}</Row> : null}
        </ul>
      ) : (
        <p className="mt-6 max-w-prose text-muted">No pudimos leer el estado de tu cuenta. Probá de nuevo en unos minutos.</p>
      )}

      <p className="mt-8 max-w-prose leading-relaxed text-muted">
        Para cambiar de plan o registrar un pago, contactá a UcoMenu.
      </p>
    </main>
  );
}
