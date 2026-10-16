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
import { AuditItem } from "./audit";

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
    <li className="border-b border-ink/15 py-3" data-testid="organizacion">
      <p className="text-lg break-words">
        <Link href={`/admin/organizaciones/${org.slug}`} className="font-medium underline underline-offset-2">
          {org.name}
        </Link>{" "}
        <span className="text-muted">({org.slug})</span>
        {org.isActive ? null : <span className="text-danger"> – inactiva</span>}
      </p>
      <p className="mt-1 text-base break-words text-muted">{subscriptionLine(org)}</p>
      <p className="mt-1 text-base break-words text-muted">
        Dueño: {org.ownerEmails.length ? org.ownerEmails.join(", ") : "sin Dueño"}
      </p>
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
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-4xl leading-tight">Organizaciones</h1>
      <p className="mt-3">
        <Link href="/admin/nueva" className="text-lg underline underline-offset-2">
          Nueva organización
        </Link>
      </p>

      <section aria-labelledby="lista" className="mt-8">
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
            <ul className="mt-3 border-t border-ink/15">
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

      <section aria-labelledby="movimientos" className="mt-10">
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
            <ul className="mt-3 border-t border-ink/15">
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
