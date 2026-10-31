import type { Metadata } from "next";
import Link from "next/link";
import { getEntitlements, requireOwner } from "@/lib/auth/session";
import { loadOwnerAccount, loadPlanPrice, type Page } from "@/lib/cuenta/cargar";
import { describeHistory, describePayment, formatDateTime, formatDay, parseCursor, type HistoryRow, type PaymentRow } from "@/lib/cuenta/lectura";
import { describePrice } from "@/lib/cuenta/precio";
import { branchBreakdown, formatDateWithYear, PLAN_NAME, TRIAL_STATUS_LABEL, type BillingState } from "@/lib/entitlements";
import { createSessionClient } from "@/lib/supabase/server";

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
export default async function SubscriptionPage({ params, searchParams }: PageProps<"/panel/[org]/suscripcion">) {
  const { org } = await params;
  const { membership } = await requireOwner(org, `/panel/${org}/suscripcion`);
  const query = await searchParams;
  const before = { payments: parseCursor(query.pagos_antes), history: parseCursor(query.cambios_antes) };
  const ent = await getEntitlements(membership.org.id);
  const db = await createSessionClient();
  const [account, catalog] = await Promise.all([
    // La base vuelve a comprobar que sea Dueño y entrega solo lo que puede ver (ADR 0021).
    loadOwnerAccount(db, membership.org.id, before),
    // Precio de lista del plan (catálogo en USD, de lectura con sesión): con el ciclo de la cuenta da lo que cuesta por mes o por año.
    ent?.plan ? loadPlanPrice(db, ent.plan) : null,
  ]);
  const price = describePrice(ent, catalog);
  // El último pago vigente (solo en la primera página de la lista: en las siguientes las filas son anteriores).
  const lastPaymentRow = before.payments ? null : (account.payments?.rows.find((row) => !describePayment(row).voided) ?? null);
  const lastPayment = lastPaymentRow ? describePayment(lastPaymentRow) : null;
  const base = `/panel/${membership.org.slug}/suscripcion`;
  // «Ver más» de una lista conserva dónde está la otra.
  const moreHref = (list: "pagos" | "cambios", next: string) => {
    const params = new URLSearchParams();
    // El cursor de la otra lista se conserva tal cual (fecha_id).
    const keep = (cursor: typeof before.payments) => (cursor ? `${cursor.before}_${cursor.beforeId}` : null);
    const other = list === "pagos" ? keep(before.history) : keep(before.payments);
    if (list === "pagos") {
      params.set("pagos_antes", next);
      if (other) params.set("cambios_antes", other);
    } else {
      if (other) params.set("pagos_antes", other);
      params.set("cambios_antes", next);
    }
    return `${base}?${params.toString()}#${list === "pagos" ? "pagos" : "historial"}`;
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Suscripción</h1>

      {price ? (
        <section aria-labelledby="precio-titulo" className="mt-6 rounded-3xl bg-brand p-5 text-white sm:p-6" data-testid="suscripcion-precio">
          <h2 id="precio-titulo" className="font-display text-2xl">
            Lo que pagás
          </h2>
          <p className="mt-2 font-display text-4xl leading-tight tabular-nums sm:text-5xl" data-testid="suscripcion-precio-valor">
            {price.headline}
          </p>
          {price.lines.map((line) => (
            <p key={line} className="mt-2 max-w-prose text-lg" data-testid="suscripcion-precio-linea">
              {line}
            </p>
          ))}
          {lastPayment && lastPaymentRow ? (
            <p className="mt-2 max-w-prose text-base" data-testid="suscripcion-ultimo-pago">
              Último pago: <span className="font-medium tabular-nums">{lastPayment.amount}</span>, recibido el {formatDay(lastPaymentRow.paidOn)}.
            </p>
          ) : null}
          <p className="mt-4 max-w-prose border-t border-white/25 pt-3 text-sm" data-testid="suscripcion-precio-nota">
            Son los precios de lista de tu plan. Lo que se cobró en cada período figura en Pagos, más abajo.
          </p>
        </section>
      ) : null}

      {ent ? (
        <ul className="mt-6 panel-list">
          <Row label="Plan">{ent.plan ? (PLAN_NAME[ent.plan] ?? ent.plan) : "Sin datos"}</Row>
          {ent.billingCycle ? <Row label="Facturación">{CYCLE_LABEL[ent.billingCycle] ?? ent.billingCycle}</Row> : null}
          <Row label="Estado">{ent.suspendedManually ? "Suspendida por UcoMenu" : STATE_LABEL[ent.state]}</Row>
          {ent.trialStatus && ent.trialStatus !== "none" ? (
            <Row label="Prueba gratuita">
              {TRIAL_STATUS_LABEL[ent.trialStatus]}
              {ent.trialStatus !== "converted" && ent.trialEndsAt ? ` · hasta el ${formatDateWithYear(ent.trialEndsAt)}` : ""}
            </Row>
          ) : null}
          {typeof ent.limits.branches === "number" ? (
            <Row label="Sucursales">
              <span data-testid="suscripcion-sucursales">
                {ent.usage.branches ?? 0} de {ent.limits.branches}
                {branchBreakdown(ent) ? ` (${branchBreakdown(ent)})` : ""}
              </span>
            </Row>
          ) : null}
          {ent.periodEnd ? <Row label="Vence">{formatDateWithYear(ent.periodEnd)}</Row> : null}
          {ent.daysLate ? <Row label="Días de atraso">{ent.daysLate}</Row> : null}
        </ul>
      ) : (
        <p className="mt-6 max-w-prose text-muted">No pudimos leer el estado de tu cuenta. Probá de nuevo en unos minutos.</p>
      )}

      <p className="mt-8 max-w-prose leading-relaxed text-muted">
        Para cambiar de plan o registrar un pago, contactá a UcoMenu.
      </p>

      <PaymentsSection page={account.payments} more={account.payments?.next ? moreHref("pagos", account.payments.next) : null} first={!before.payments} />
      <HistorySection page={account.history} more={account.history?.next ? moreHref("cambios", account.history.next) : null} first={!before.history} />
    </main>
  );
}

const moreClass =
  "mt-4 inline-flex min-h-11 items-center justify-center rounded-full border border-ink/50 px-5 py-2 text-base font-medium text-ink hover:bg-ink/5";

function PaymentsSection({ page, more, first }: { page: Page<PaymentRow>; more: string | null; first: boolean }) {
  return (
    <section id="pagos" aria-labelledby="pagos-titulo" className="mt-12" data-testid="pagos">
      <h2 id="pagos-titulo" className="font-display text-3xl leading-tight">
        Pagos
      </h2>
      {page === null ? (
        <p role="status" className="mt-3 max-w-prose text-base text-muted" data-testid="pagos-error">
          No pudimos leer tus pagos. Probá de nuevo en unos minutos.
        </p>
      ) : page.rows.length === 0 ? (
        <p className="mt-3 max-w-prose text-base text-muted" data-testid="pagos-vacio">
          {first ? "Todavía no hay pagos registrados." : "No hay pagos anteriores."}
        </p>
      ) : (
        <ul className="mt-3 panel-list">
          {page.rows.map((row) => {
            const { amount, voided, lines } = describePayment(row);
            return (
              <li key={row.id} className="border-b border-ink/15 py-3" data-testid="pago" data-voided={voided ? "true" : "false"}>
                <p className="flex flex-wrap items-baseline gap-x-3 text-lg">
                  <span className={`font-medium tabular-nums ${voided ? "text-muted line-through" : ""}`}>{amount}</span>
                  <span className="text-base text-muted">Recibido el {formatDay(row.paidOn)}</span>
                </p>
                {lines.map((line) => (
                  <p key={line} className="text-base break-words">
                    {line}
                  </p>
                ))}
              </li>
            );
          })}
        </ul>
      )}
      {more ? (
        <Link href={more} className={moreClass} data-testid="pagos-mas">
          Ver pagos anteriores
        </Link>
      ) : null}
    </section>
  );
}

function HistorySection({ page, more, first }: { page: Page<HistoryRow>; more: string | null; first: boolean }) {
  return (
    <section id="historial" aria-labelledby="historial-titulo" className="mt-12" data-testid="historial">
      <h2 id="historial-titulo" className="font-display text-3xl leading-tight">
        Historial de cambios de la cuenta
      </h2>
      <p className="mt-1 max-w-prose text-base text-muted">Los cambios que hizo el equipo de UcoMenu en tu cuenta.</p>
      {page === null ? (
        <p role="status" className="mt-3 max-w-prose text-base text-muted" data-testid="historial-error">
          No pudimos leer el historial. Probá de nuevo en unos minutos.
        </p>
      ) : page.rows.length === 0 ? (
        <p className="mt-3 max-w-prose text-base text-muted" data-testid="historial-vacio">
          {first ? "Todavía no hay cambios para mostrar." : "No hay cambios anteriores."}
        </p>
      ) : (
        <ul className="mt-3 panel-list">
          {page.rows.map((row) => {
            const { title, lines } = describeHistory(row);
            return (
              <li key={row.id} className="border-b border-ink/15 py-3" data-testid="cambio">
                <p className="text-base break-words">
                  <span className="font-medium">{title}</span>
                  {lines.length ? ` · ${lines.join(" · ")}` : ""}
                </p>
                <p className="mt-1 text-sm text-muted">{formatDateTime(row.createdAt)} · Equipo de UcoMenu</p>
              </li>
            );
          })}
        </ul>
      )}
      {more ? (
        <Link href={more} className={moreClass} data-testid="historial-mas">
          Ver cambios anteriores
        </Link>
      ) : null}
    </section>
  );
}
