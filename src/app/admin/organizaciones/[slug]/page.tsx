import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CYCLE_LABEL, formatMoney, METHOD_LABEL } from "@/lib/admin/format";
import { AUDIT_LIMIT } from "@/lib/admin/organizations";
import { listAdminBranches } from "@/lib/admin/branches";
import { getOrganizationDetail, PAYMENTS_LIMIT, type PaymentRow } from "@/lib/admin/subscriptions";
import { isBillingCycle, proposeCoversUntil, todayInArgentina } from "@/lib/admin/validation";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { accountState, BILLING_STATE_LABEL, formatDateWithYear, PLAN_NAME, TRIAL_STATUS_LABEL } from "@/lib/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/server";
import { AuditItem } from "../../audit";
import { StatusPill } from "../../status-pill";
import { ChangePlanForm, PaymentForm, SuspensionForm } from "./forms";
import { BranchSlugForm } from "./branch-slug-form";

export const metadata: Metadata = { title: "Organización" };

const dateTime = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Buenos_Aires",
});

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex items-baseline gap-3 border-b border-ink/15 py-3 text-lg">
      <span>{label}</span>
      <span aria-hidden className="leader" />
      <span className="min-w-0 text-right break-words tabular-nums">{children}</span>
    </li>
  );
}

function PaymentItem({ payment }: { payment: PaymentRow }) {
  return (
    <li className="border-b border-ink/15 py-3" data-testid="pago">
      <p className="text-base break-words">
        <span className="font-medium">{formatMoney(payment.amountCents, payment.currency)}</span> ·{" "}
        {METHOD_LABEL[payment.method] ?? payment.method} · {PLAN_NAME[payment.plan] ?? payment.plan},{" "}
        {CYCLE_LABEL[payment.billingCycle] ?? payment.billingCycle}
      </p>
      <p className="mt-1 text-sm break-words text-muted">
        Pagado el {formatDateWithYear(`${payment.paidOn}T12:00:00-03:00`)} · cubre hasta el {formatDateWithYear(payment.coversUntil)} (antes:{" "}
        {formatDateWithYear(payment.previousPeriodEnd)})
        {payment.reference ? ` · ref. ${payment.reference}` : ""}
      </p>
      <p className="mt-1 text-sm text-muted">Registrado el {dateTime.format(new Date(payment.createdAt))}</p>
    </li>
  );
}

export default async function OrganizationAdminPage({ params }: PageProps<"/admin/organizaciones/[slug]">) {
  const { slug } = await params;
  const user = await requirePlatformAdmin(`/admin/organizaciones/${slug}`);

  let result;
  try {
    result = await getOrganizationDetail({ session: await createSessionClient(), admin: createAdminClient(), actorId: user.id }, slug);
  } catch {
    result = null; // sin SUPABASE_SERVICE_ROLE_KEY u otra falla
  }
  if (result?.ok === false && result.error === "org_not_found") notFound();

  if (!result || !result.ok) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
        <p>
          <Link href="/admin" className="underline underline-offset-2">
            Volver a las organizaciones
          </Link>
        </p>
        <p role="alert" className="mt-6 max-w-prose text-danger">
          No pudimos cargar la organización. Probá de nuevo en unos minutos.
        </p>
      </main>
    );
  }

  const org = result.data;
  const branches = await listAdminBranches({ session: await createSessionClient(), admin: createAdminClient(), actorId: user.id }, org.id);
  const now = new Date();
  const suspended = org.suspendedAt !== null;
  const datesState = accountState(org.periodEnd, false, now);
  const cycle = isBillingCycle(org.billingCycle) ? org.billingCycle : "monthly";

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <p>
        <Link href="/admin" className="underline underline-offset-2">
          Volver a las organizaciones
        </Link>
      </p>
      <h1 className="mt-3 font-display text-4xl leading-tight break-words">{org.name}</h1>
      <p className="mt-2 flex flex-wrap items-center gap-2" data-testid="estado-organizacion">
        <StatusPill state={org.state} className="!text-base" />
        <span className="rounded-full bg-sand px-2.5 py-0.5 text-base text-ink ring-1 ring-inset ring-ink/15">
          {PLAN_NAME[org.plan] ?? org.plan}, {(CYCLE_LABEL[org.billingCycle] ?? org.billingCycle).toLowerCase()}
        </span>
        {org.isActive ? null : <span className="rounded-full bg-suspended-bg px-2.5 py-0.5 text-base text-suspended-ink">inactiva</span>}
      </p>
      <p className="mt-2 text-lg break-words text-muted">
        <span className="font-mono text-base">{org.slug}</span> · Dueño: {org.ownerEmails.length ? org.ownerEmails.join(", ") : "sin Dueño"}
      </p>

      <section aria-labelledby="seccion-suscripcion" className="panel-cell mt-8">
        <h2 id="seccion-suscripcion" className="font-display text-2xl">
          Suscripción
        </h2>
        <ul className="mt-3 panel-list" data-testid="suscripcion">
          <Row label="Plan">{PLAN_NAME[org.plan] ?? org.plan}</Row>
          <Row label="Facturación">{CYCLE_LABEL[org.billingCycle] ?? org.billingCycle}</Row>
          <Row label="Estado">{suspended ? "Suspendida a mano" : BILLING_STATE_LABEL[org.state]}</Row>
          {suspended && org.suspendedAt ? <Row label="Suspendida desde">{dateTime.format(new Date(org.suspendedAt))}</Row> : null}
          {suspended ? <Row label="Según sus fechas">{BILLING_STATE_LABEL[datesState]}</Row> : null}
          <Row label="Prueba gratuita">
            {TRIAL_STATUS_LABEL[org.trial]}
            {org.trial === "in_trial" || org.trial === "expired" ? ` · hasta el ${formatDateWithYear(org.trialEndsAt!)}` : ""}
          </Row>
          {org.periodEnd ? <Row label={datesState === "active" ? "Vigente hasta" : "Venció el"}>{formatDateWithYear(org.periodEnd)}</Row> : null}
        </ul>
      </section>

      <section aria-labelledby="seccion-sucursales" className="panel-cell mt-6">
        <h2 id="seccion-sucursales" className="font-display text-2xl">Direcciones de las sucursales</h2>
        <p className="mt-2 max-w-prose leading-relaxed text-muted">
          Corregí un identificador sin perder los enlaces anteriores: redirigen a la dirección vigente.
          Los códigos QR de las mesas no cambian. Usá minúsculas, números y guiones simples.
        </p>
        {!branches.ok ? <p role="alert" className="mt-3 text-danger">No pudimos cargar las sucursales. Recargá para intentar de nuevo.</p>
          : branches.data.length === 0 ? <p className="mt-3 text-muted">Todavía no hay sucursales.</p>
          : <ul className="mt-3 divide-y divide-ink/15">
            {branches.data.map((branch) => <li key={branch.id} data-testid="admin-sucursal" data-branch={branch.id} className="py-5">
              <h3 className="font-display text-xl [overflow-wrap:anywhere]">{branch.name}</h3>
              <Link href={`/m/${org.slug}/${branch.slug}`} className="mt-1 inline-flex min-h-11 items-center text-cobalt underline [overflow-wrap:anywhere]">
                /m/{org.slug}/{branch.slug}
              </Link>
              <BranchSlugForm orgSlug={org.slug} branchId={branch.id} currentSlug={branch.slug} />
            </li>)}
          </ul>}
      </section>

      <section aria-labelledby="seccion-plan" className="panel-cell mt-6">
        <h2 id="seccion-plan" className="font-display text-2xl">
          Cambiar plan
        </h2>
        <p className="mt-2 max-w-prose leading-relaxed text-muted">
          Rige desde ya, sin prorrateo: no cambia las fechas. Bajar de plan no borra nada; solo impide crear más allá del nuevo
          tope. {org.trial === "in_trial" ? "La organización está en prueba: el plan nuevo rige hasta el fin de la prueba sin pago." : ""}
        </p>
        <ChangePlanForm slug={org.slug} plan={org.plan} billingCycle={org.billingCycle} />
      </section>

      <section aria-labelledby="seccion-suspension" className="panel-cell mt-6">
        <h2 id="seccion-suspension" className="font-display text-2xl">
          {suspended ? "Reactivar" : "Suspender"}
        </h2>
        <p className="mt-2 max-w-prose leading-relaxed text-muted">
          {suspended
            ? datesState === "active" || datesState === "grace"
              ? "Al reactivar, la cuenta vuelve a funcionar según sus fechas. No se agrega tiempo."
              : `Por sus fechas, al reactivar la cuenta quedará «${BILLING_STATE_LABEL[datesState]}»: registrá un pago para dejarla al día. No se agrega tiempo.`
            : "La carta deja de mostrarse y el panel pasa a solo lectura, aunque las fechas estén al día. Los datos se conservan. Registrar un pago no levanta la suspensión: se reactiva aparte."}
        </p>
        <SuspensionForm slug={org.slug} suspended={suspended} />
      </section>

      <section aria-labelledby="seccion-pago" className="panel-cell mt-6">
        <h2 id="seccion-pago" className="font-display text-2xl">
          Registrar un pago
        </h2>
        <p className="mt-2 max-w-prose leading-relaxed text-muted">
          El pago queda guardado y no se puede modificar ni borrar. Mueve el vencimiento a la fecha que indiques y restablece la
          cuenta si estaba en mora. Se registra con el plan y el ciclo actuales: si hay que cambiarlos, hacelo antes.
        </p>
        <PaymentForm
          slug={org.slug}
          today={todayInArgentina(now)}
          proposedCoversUntil={proposeCoversUntil(org.periodEnd, cycle, now)}
        />
      </section>

      <section aria-labelledby="seccion-pagos" className="panel-cell mt-6">
        <h2 id="seccion-pagos" className="font-display text-2xl">
          Pagos registrados
        </h2>
        {org.payments.length === 0 ? (
          <p className="mt-3 text-muted">Todavía no hay pagos registrados.</p>
        ) : (
          <>
            <ul className="mt-3 panel-list">
              {org.payments.map((payment) => (
                <PaymentItem key={payment.id} payment={payment} />
              ))}
            </ul>
            {org.payments.length === PAYMENTS_LIMIT ? (
              <p className="mt-3 text-sm text-muted">Se muestran los {PAYMENTS_LIMIT} más recientes.</p>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="seccion-movimientos" className="panel-cell mt-6">
        <h2 id="seccion-movimientos" className="font-display text-2xl">
          Movimientos de esta organización
        </h2>
        {org.audit.length === 0 ? (
          <p className="mt-3 text-muted">Todavía no hay movimientos registrados.</p>
        ) : (
          <>
            <ul className="mt-3 panel-list">
              {org.audit.map((entry) => (
                <AuditItem key={entry.id} entry={entry} />
              ))}
            </ul>
            {org.audit.length === AUDIT_LIMIT ? <p className="mt-3 text-sm text-muted">Se muestran los {AUDIT_LIMIT} más recientes.</p> : null}
          </>
        )}
      </section>
    </main>
  );
}
