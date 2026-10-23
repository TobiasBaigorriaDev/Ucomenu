import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { canDeleteNow, DELETION_WAIT_DAYS, deletionAvailableAt } from "@/lib/admin/delete-organization";
import { CYCLE_LABEL, formatMoney, METHOD_LABEL } from "@/lib/admin/format";
import { AUDIT_LIMIT } from "@/lib/admin/organizations";
import { listAdminBranches } from "@/lib/admin/branches";
import { getOrganizationDetail, isVoidable, PAYMENTS_LIMIT, previewableFeatures, type PaymentRow } from "@/lib/admin/subscriptions";
import { isBillingCycle, MAX_EXTRA_PACKS, MAX_PREVIEW_DAYS, PREVIEW_FEATURE_LABEL, proposeCoversUntil, todayInArgentina } from "@/lib/admin/validation";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { accountState, BILLING_STATE_LABEL, formatDateWithYear, PLAN_NAME, TRIAL_STATUS_LABEL } from "@/lib/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/server";
import { AuditItem } from "../../audit";
import { StatusPill } from "../../status-pill";
import { AddOwnerForm, AddonForm, ChangePlanForm, DeleteOrganizationForm, EndAddonForm, EndFeaturePreviewForm, ExtraBranchesForm, FeaturePreviewForm, OrganizationActiveForm, PaymentForm, SuspensionForm, VoidPaymentForm } from "./forms";
import { BranchSlugForm } from "./branch-slug-form";

export const metadata: Metadata = { title: "Organización" };

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** Qué pasa al anular un pago: el vencimiento vuelve al de antes y la cuenta queda en el estado que digan las fechas. */
function voidConsequence(payment: PaymentRow, suspendedByHand: boolean, now: Date): string {
  const back = accountState(payment.previousPeriodEnd, false, now);
  const lands =
    back === "active"
      ? "La cuenta sigue al día."
      : `La cuenta quedará «${BILLING_STATE_LABEL[back]}» por sus fechas: la carta y el panel cambian en el acto.`;
  const hand = suspendedByHand ? " Sigue suspendida a mano hasta que se la reactive." : "";
  return `El vencimiento vuelve al ${formatDateWithYear(payment.previousPeriodEnd)}. ${lands}${hand} El pago queda en el historial como anulado; para corregirlo, después registrá el pago correcto.`;
}

function PaymentItem({ payment, slug, voidable, suspendedByHand, now }: { payment: PaymentRow; slug: string; voidable: boolean; suspendedByHand: boolean; now: Date }) {
  const voided = payment.voided;
  return (
    <li className="border-b border-ink/15 py-3" data-testid="pago" data-voided={voided ? "true" : "false"}>
      <p className={`text-base break-words ${voided ? "text-muted line-through" : ""}`}>
        <span className="font-medium">{formatMoney(payment.amountCents, payment.currency)}</span> ·{" "}
        {METHOD_LABEL[payment.method] ?? payment.method} · {PLAN_NAME[payment.plan] ?? payment.plan},{" "}
        {CYCLE_LABEL[payment.billingCycle] ?? payment.billingCycle}
      </p>
      {voided ? (
        <p className="mt-1 text-base break-words" data-testid="pago-anulado">
          <span className="rounded-full bg-suspended-bg px-2.5 py-0.5 text-suspended-ink">Anulado</span> el {dateTime.format(new Date(voided.at))} · motivo: {voided.reason}
        </p>
      ) : null}
      <p className="mt-1 text-sm break-words text-muted">
        Pagado el {formatDateWithYear(`${payment.paidOn}T12:00:00-03:00`)} · cubre hasta el {formatDateWithYear(payment.coversUntil)} (antes:{" "}
        {formatDateWithYear(payment.previousPeriodEnd)})
        {payment.reference ? ` · ref. ${payment.reference}` : ""}
      </p>
      <p className="mt-1 text-sm text-muted">Registrado el {dateTime.format(new Date(payment.createdAt))}</p>
      {voidable ? <VoidPaymentForm slug={slug} paymentId={payment.id} consequence={voidConsequence(payment, suspendedByHand, now)} /> : null}
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
  // Lo que el plan ya incluye no se ofrece: una vista previa no agrega nada (y la base la rechazaría).
  const previewable = previewableFeatures(org.featurePreviews);
  const suspended = org.suspendedAt !== null;
  const datesState = accountState(org.periodEnd, false, now);
  const cycle = isBillingCycle(org.billingCycle) ? org.billingCycle : "monthly";
  const deletionAt = deletionAvailableAt(org.deactivatedAt);
  const deletable = canDeleteNow(org.deactivatedAt, now);

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

      <section aria-labelledby="seccion-dueno" className="panel-cell mt-6">
        <h2 id="seccion-dueno" className="font-display text-2xl">
          Sumar un Dueño
        </h2>
        <p className="mt-2 max-w-prose leading-relaxed text-muted">
          Para una persona que ya tiene cuenta (por ejemplo, un dueño con otro local). No se crea ni se toca la cuenta: conserva su
          contraseña y sus otros locales. Si todavía no tiene cuenta, se crea al dar de alta una organización con su email.
        </p>
        <AddOwnerForm slug={org.slug} />
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

      {org.extraBranches ? (
        <section aria-labelledby="seccion-sucursales-extra" className="panel-cell mt-6" data-testid="sucursales-extra">
          <h2 id="seccion-sucursales-extra" className="font-display text-2xl">
            Sucursales adicionales
          </h2>
          <p className="mt-2 max-w-prose leading-relaxed text-muted">
            Solo para el plan Pro: hasta {org.extraBranches.max} sucursales más, a {formatMoney(org.extraBranches.priceCents, org.extraBranches.currency)} por
            mes cada una. Se cobran junto con la suscripción (un solo pago por plan y adicionales). Al quitarlas, las sucursales que sobren se desactivan: las
            elegís vos.
          </p>
          {org.extraBranches.allowedByPlan ? (
            <>
              <p className="mt-3 text-base break-words" data-testid="sucursales-extra-estado">
                {org.extraBranches.quantity === 0
                  ? "Sin sucursales adicionales."
                  : `${org.extraBranches.quantity} ${org.extraBranches.quantity === 1 ? "sucursal adicional vigente" : "sucursales adicionales vigentes"} · ${formatMoney(
                      org.extraBranches.priceCents * org.extraBranches.quantity,
                      org.extraBranches.currency,
                    )} por mes`}{" "}
                · {org.extraBranches.activeBranches.length} {org.extraBranches.activeBranches.length === 1 ? "activa" : "activas"} de un tope de{" "}
                {(org.extraBranches.planBranches ?? 0) + org.extraBranches.quantity}.
              </p>
              <ExtraBranchesForm
                slug={org.slug}
                quantity={org.extraBranches.quantity}
                max={org.extraBranches.max}
                planBranches={org.extraBranches.planBranches}
                activeBranches={org.extraBranches.activeBranches}
              />
            </>
          ) : (
            <p className="mt-3 max-w-prose text-base text-muted" data-testid="sucursales-extra-plan">
              Hace falta el plan Pro. {org.plan === "premium" ? "Premium no tiene tope de sucursales." : "Cambiá el plan primero."}
            </p>
          )}
        </section>
      ) : null}

      <section aria-labelledby="seccion-addons" className="panel-cell mt-6">
        <h2 id="seccion-addons" className="font-display text-2xl">
          Add-ons
        </h2>
        <p className="mt-2 max-w-prose leading-relaxed text-muted">
          Se activan a mano, sobre un plan que los admite, y quedan en los movimientos con su motivo. El Dueño ve el cambio en su
          historial, sin el motivo.
        </p>
        {org.addons.length === 0 ? (
          <p className="mt-3 max-w-prose text-base text-muted" data-testid="addons-vacio">
            Hoy no hay otros add-ons a la venta. Las sucursales adicionales se gestionan en su bloque de arriba; el feed de videos cortos viene incluido en el plan Premium (no se activa acá).
          </p>
        ) : null}
        <ul className="mt-3 divide-y divide-ink/15">
          {org.addons.map((addon) => (
            <li key={addon.code} data-testid="addon" data-addon={addon.code} data-active={addon.contract?.active ? "true" : "false"} className="py-5">
              <h3 className="font-display text-xl">{addon.name}</h3>
              <p className="mt-1 text-base break-words" data-testid="addon-estado">
                {addon.contract === null
                  ? "Nunca contratado."
                  : addon.contract.active
                    ? `Vigente · cupo de ${addon.contract.quota} (${addon.baseQuota} base${addon.contract.extraPacks ? ` + ${addon.contract.extraPacks} × ${addon.packSize}` : ""}) · ${
                        addon.contract.endsAt ? `termina el ${formatDateWithYear(addon.contract.endsAt)}` : "sin fecha de fin"
                      }`
                    : `Finalizado el ${formatDateWithYear(addon.contract.endsAt ?? "")} · tenía ${addon.contract.extraPacks} packs extra.`}
              </p>
              {addon.contract?.active && !addon.allowedByPlan ? (
                <p className="mt-1 text-base text-danger" data-testid="addon-sin-plan">
                  El plan actual no lo admite, así que no da nada hasta que vuelva a un plan {addon.allowedPlans.map((p) => PLAN_NAME[p] ?? p).join(" o ")}.
                </p>
              ) : null}
              {addon.allowedByPlan ? (
                <>
                  <AddonForm
                    slug={org.slug}
                    addon={addon.code}
                    active={addon.contract?.active === true}
                    extraPacks={addon.contract?.extraPacks ?? 0}
                    endsOn={addon.contract?.active && addon.contract.endsAt ? todayInArgentina(new Date(addon.contract.endsAt)) : ""}
                    maxPacks={MAX_EXTRA_PACKS}
                  />
                  {addon.contract?.active ? <EndAddonForm slug={org.slug} addon={addon.code} name={addon.name} /> : null}
                </>
              ) : (
                <p className="mt-2 max-w-prose text-base text-muted" data-testid="addon-plan-no-admitido">
                  Hace falta un plan {addon.allowedPlans.map((p) => PLAN_NAME[p] ?? p).join(" o ")}. Cambiá el plan primero.
                </p>
              )}
              {!addon.allowedByPlan && addon.contract?.active ? <EndAddonForm slug={org.slug} addon={addon.code} name={addon.name} /> : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="seccion-vistas-previas" className="panel-cell mt-6" data-testid="vistas-previas">
        <h2 id="seccion-vistas-previas" className="font-display text-2xl">
          Vistas previas de funciones
        </h2>
        <p className="mt-2 max-w-prose leading-relaxed text-muted">
          Habilitan una función nueva a este local por hasta {MAX_PREVIEW_DAYS} días, con motivo. La mora manda; el Dueño no las ve.
        </p>
        {previewable.length === 0 ? (
          <p className="mt-3 max-w-prose text-base text-muted" data-testid="vistas-previas-vacio">
            El plan de esta organización ya incluye todas las funciones nuevas: no hay nada que habilitar.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-ink/15">
            {previewable.map((item) => {
              const active = item.preview?.active === true;
              return (
                <li key={item.feature} data-testid="vista-previa" data-feature={item.feature} data-active={active ? "true" : "false"}>
                  <details>
                    <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0">
                        <span className="block font-display text-lg">{PREVIEW_FEATURE_LABEL[item.feature]}</span>
                        <span className="block text-base break-words" data-testid="vista-previa-estado">
                          {item.preview === null ? (
                            <span className="text-muted">Sin vista previa</span>
                          ) : (
                            <>
                              <span className={active ? "font-medium" : "text-muted"}>
                                {active ? "Vigente hasta el" : "Terminó el"} {formatDateWithYear(item.preview.endsAt)}
                              </span>
                              <span className="block text-sm text-muted">motivo: {item.preview.reason}</span>
                            </>
                          )}
                        </span>
                      </span>
                      <span className="text-base text-cobalt underline underline-offset-2">
                        {active ? "Cambiar el fin o terminar" : item.preview === null ? "Habilitar" : "Volver a habilitar"}
                      </span>
                    </summary>
                    <div className="pb-4">
                      <FeaturePreviewForm
                        slug={org.slug}
                        feature={item.feature}
                        active={active}
                        endsOn={active && item.preview ? todayInArgentina(new Date(item.preview.endsAt)) : ""}
                        minDate={todayInArgentina(now)}
                        maxDate={todayInArgentina(new Date(now.getTime() + (MAX_PREVIEW_DAYS - 1) * DAY_MS))}
                      />
                      {active ? <EndFeaturePreviewForm slug={org.slug} feature={item.feature} name={PREVIEW_FEATURE_LABEL[item.feature]} /> : null}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
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

      <section aria-labelledby="seccion-baja" className="panel-cell mt-6">
        <h2 id="seccion-baja" className="font-display text-2xl">
          {org.isActive ? "Dar de baja" : "Reactivar la organización"}
        </h2>
        <p className="mt-2 max-w-prose leading-relaxed text-muted" data-testid="aviso-baja">
          {org.isActive
            ? "Es distinto de suspender: la carta y los QR dejan de abrirse (el público ve «no encontrada», como si no existieran), no hay llamados y nadie del local (Dueño ni personal) puede entrar al panel ni a la sala. No se borra nada ni se toca la suscripción, y se puede revertir. Para una mora o un corte temporal, suspendé."
            : "La organización está dada de baja: su carta y sus QR no abren y su personal no puede entrar. Al reactivarla todo vuelve a funcionar según su suscripción actual (si venció, queda en mora como corresponda)."}
        </p>
        <OrganizationActiveForm slug={org.slug} active={org.isActive} name={org.name} />
      </section>

      <section aria-labelledby="seccion-borrado" className="panel-cell mt-6">
        <h2 id="seccion-borrado" className="font-display text-2xl">
          Borrar definitivamente
        </h2>
        <p className="mt-2 max-w-prose leading-relaxed text-muted" data-testid="aviso-borrado">
          Irreversible. Solo se puede con la organización dada de baja desde hace {DELETION_WAIT_DAYS} días. Se borran su carta, sus
          sucursales, sus mesas y QR, su suscripción, su personal y su historial de precios, y las fotos y el logo. Se conservan los
          pagos (10 años), los movimientos de esta pantalla y las cuentas de las personas. Antes, corré el respaldo (
          <span className="font-mono text-base">pnpm respaldo</span>).
        </p>
        {org.isActive ? (
          <p className="mt-3 max-w-prose" data-testid="borrado-estado">
            Para poder borrarla primero hay que darla de baja y esperar {DELETION_WAIT_DAYS} días.
          </p>
        ) : deletionAt === null ? (
          <p className="mt-3 max-w-prose" data-testid="borrado-estado">
            La baja no figura en los movimientos (puede haberse hecho a mano), así que no se puede borrar. Reactivala y dala de baja desde
            esta pantalla.
          </p>
        ) : !deletable ? (
          <p className="mt-3 max-w-prose" data-testid="borrado-estado">
            Se podrá borrar a partir del {formatDateWithYear(deletionAt.toISOString())}: hasta entonces la baja se puede revertir.
          </p>
        ) : (
          <DeleteOrganizationForm slug={org.slug} name={org.name} />
        )}
      </section>

      <section aria-labelledby="seccion-pago" className="panel-cell mt-6">
        <h2 id="seccion-pago" className="font-display text-2xl">
          Registrar un pago
        </h2>
        <p className="mt-2 max-w-prose leading-relaxed text-muted">
          El pago queda guardado y no se puede modificar ni borrar: si se cargó mal, se anula (con motivo) desde la lista de pagos y se
          registra el correcto. Mueve el vencimiento a la fecha que indiques y restablece la
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
                <PaymentItem
                  key={payment.id}
                  payment={payment}
                  slug={org.slug}
                  voidable={isVoidable(payment, org.currentPeriodEnd)}
                  suspendedByHand={suspended}
                  now={now}
                />
              ))}
            </ul>
            {org.payments.length >= PAYMENTS_LIMIT ? (
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
