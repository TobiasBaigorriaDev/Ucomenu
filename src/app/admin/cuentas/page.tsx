import type { Metadata } from "next";
import Link from "next/link";
import { listOrphanAccounts, type OrphanAccount } from "@/lib/admin/orphan-accounts";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { formatDateWithYear } from "@/lib/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/server";
import { DeleteOrphanForm } from "./delete-orphan-form";

export const metadata: Metadata = { title: "Cuentas sin local" };

function OrphanItem({ account }: { account: OrphanAccount }) {
  return (
    <li className="border-b border-ink/15 py-4" data-testid="cuenta-sin-local">
      <p className="font-mono text-base break-words [overflow-wrap:anywhere]">{account.email}</p>
      <p className="mt-1 text-sm break-words text-muted">
        Creada el {formatDateWithYear(account.createdAt)} ·{" "}
        {account.lastSignInAt ? `último ingreso el ${formatDateWithYear(account.lastSignInAt)}` : "nunca ingresó"}
      </p>
      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">Borrar esta cuenta</summary>
        <DeleteOrphanForm userId={account.userId} email={account.email} />
      </details>
    </li>
  );
}

export default async function OrphanAccountsPage({ searchParams }: PageProps<"/admin/cuentas">) {
  const user = await requirePlatformAdmin("/admin/cuentas");
  const query = await searchParams;
  const deleted = query.borrada === "1";

  let accounts: OrphanAccount[] | null = null;
  try {
    const result = await listOrphanAccounts({ session: await createSessionClient(), admin: createAdminClient(), actorId: user.id });
    accounts = result.ok ? result.data : null;
  } catch {
    accounts = null; // sin SUPABASE_SERVICE_ROLE_KEY u otra falla: se informa abajo, sin romper la página
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <p>
        <Link href="/admin" className="underline underline-offset-4">
          ← Organizaciones
        </Link>
      </p>
      <h1 className="mt-4 font-display text-4xl leading-tight">Cuentas sin local</h1>
      <p className="mt-3 max-w-prose leading-relaxed text-muted">
        Cuentas que se quedaron sin ningún local, por ejemplo después de borrar una organización. Se conservan hasta que decidas borrarlas:
        borrar una libera el email y corta sus sesiones. No aparecen las cuentas de SuperAdmin ni las creadas hace menos de una hora.
      </p>
      {deleted ? (
        <p role="status" className="mt-4 max-w-prose font-medium" data-testid="aviso-cuenta-borrada">
          Listo: la cuenta se borró. Quedó en los movimientos, sin su email.
        </p>
      ) : null}

      <section aria-labelledby="lista" className="panel-cell mt-8">
        <h2 id="lista" className="font-display text-2xl">
          Sin ningún local
        </h2>
        {accounts === null ? (
          <p role="alert" className="mt-3 max-w-prose text-danger">
            No pudimos cargar las cuentas. Probá de nuevo en unos minutos.
          </p>
        ) : accounts.length === 0 ? (
          <p className="mt-3 text-muted">No hay cuentas sin local.</p>
        ) : (
          <ul className="mt-3">
            {accounts.map((account) => (
              <OrphanItem key={account.userId} account={account} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
