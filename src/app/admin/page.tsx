import type { Metadata } from "next";
import Link from "next/link";
import {
  AUDIT_LIMIT,
  listAuditLog,
  listOrganizations,
  ORGANIZATIONS_LIMIT,
  type OrganizationRow,
} from "@/lib/admin/organizations";
import { CYCLE_LABEL } from "@/lib/admin/format";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { BILLING_STATE_LABEL, formatDateWithYear, PLAN_NAME, TRIAL_STATUS_LABEL } from "@/lib/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/server";
import { primaryButtonClass } from "@/components/panel/styles";
import { AuditItem } from "./audit";
import { StatusPill } from "./status-pill";

export const metadata: Metadata = { title: "SuperAdmin" };

function subscriptionLine(org: OrganizationRow): string {
  if (!org.plan) return "Sin suscripción";
  const plan = PLAN_NAME[org.plan] ?? org.plan;
  const cycle = org.billingCycle ? `, ${CYCLE_LABEL[org.billingCycle] ?? org.billingCycle}` : "";
  const state = org.suspended ? "Suspendida a mano" : BILLING_STATE_LABEL[org.state];
  const trial = org.trial === "in_trial" || org.trial === "expired" ? ` · ${TRIAL_STATUS_LABEL[org.trial]}` : "";
  if (!org.periodEnd) return `${plan}${cycle} · ${state}${trial}`;
  const until = org.datesState === "active" ? "vigente hasta el" : "venció el";
  return `${plan}${cycle} · ${state}${trial} · ${until} ${formatDateWithYear(org.periodEnd)}`;
}

function OrganizationItem({ org }: { org: OrganizationRow }) {
  return (
    <li className="panel-pick -mx-3 flex items-start justify-between gap-4 px-3 py-4" data-testid="organizacion">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 break-words">
          <Link
            href={`/admin/organizaciones/${org.slug}`}
            className="panel-pick-link min-w-0 font-display text-xl leading-tight [overflow-wrap:anywhere]"
          >
            {org.name}
          </Link>
          <span className="min-w-0 font-mono text-sm text-muted [overflow-wrap:anywhere]">({org.slug})</span>
          {org.isActive ? null : <span className="rounded-full bg-suspended-bg px-2.5 py-0.5 text-sm text-suspended-ink">inactiva</span>}
        </p>
        <p className="mt-1 text-base break-words text-muted">{subscriptionLine(org)}</p>
        <p className="mt-1 text-base break-words text-muted">
          Dueño: {org.ownerEmails.length ? org.ownerEmails.join(", ") : "sin Dueño"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3 pt-0.5">
        <StatusPill state={org.state} />
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="panel-pick-arrow size-5 text-brand"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </div>
    </li>
  );
}

export default async function AdminPage() {
  const user = await requirePlatformAdmin("/admin");
  const session = await createSessionClient();

  let organizations: OrganizationRow[] | null = null;
  try {
    const result = await listOrganizations({ session, admin: createAdminClient(), actorId: user.id });
    organizations = result.ok ? result.data : null;
  } catch {
    organizations = null; // sin SUPABASE_SERVICE_ROLE_KEY u otra falla: se informa abajo, sin romper la página
  }
  const audit = await listAuditLog({ session });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Organizaciones</h1>
      <p className="mt-4">
        <Link href="/admin/nueva" className={primaryButtonClass}>
          Nueva organización
        </Link>
      </p>

      <section aria-labelledby="lista" className="panel-cell mt-8">
        <h2 id="lista" className="font-display text-2xl">
          Todas
        </h2>
        {organizations === null ? (
          <p role="alert" className="mt-3 max-w-prose text-danger">
            No pudimos cargar las organizaciones. Probá de nuevo en unos minutos.
          </p>
        ) : organizations.length === 0 ? (
          <p className="mt-3 text-muted">Todavía no hay organizaciones.</p>
        ) : (
          <>
            <ul className="mt-3 panel-list">
              {organizations.map((org) => (
                <OrganizationItem key={org.id} org={org} />
              ))}
            </ul>
            {organizations.length === ORGANIZATIONS_LIMIT ? (
              <p className="mt-3 text-sm text-muted">Se muestran las {ORGANIZATIONS_LIMIT} más recientes.</p>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="movimientos" className="panel-cell mt-6">
        <h2 id="movimientos" className="font-display text-2xl">
          Últimos movimientos
        </h2>
        {!audit.ok ? (
          <p role="alert" className="mt-3 max-w-prose text-danger">
            No pudimos cargar la auditoría. Probá de nuevo en unos minutos.
          </p>
        ) : audit.data.length === 0 ? (
          <p className="mt-3 text-muted">Todavía no hay movimientos registrados.</p>
        ) : (
          <>
            <ul className="mt-3 panel-list">
              {audit.data.map((entry) => (
                <AuditItem key={entry.id} entry={entry} />
              ))}
            </ul>
            {audit.data.length === AUDIT_LIMIT ? (
              <p className="mt-3 text-sm text-muted">Se muestran los {AUDIT_LIMIT} más recientes.</p>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
