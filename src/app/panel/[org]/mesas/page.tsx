import type { Metadata } from "next";
import Link from "next/link";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import { suggestNextLabel } from "@/lib/mesas/labels";
import { mesasBlockNotice } from "@/lib/mesas/messages";
import { loadMesas } from "@/lib/mesas/tables";
import { createSessionClient } from "@/lib/supabase/server";
import { CreateTableForm, RegenerateQrForm, RenameTableForm, TableToggle } from "./table-forms";

export const metadata: Metadata = { title: "Mesas" };

const badgeClass = "inline-flex items-center rounded-sm border border-ink/40 px-2 py-0.5 text-sm text-ink";
const linkButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-ink/40 px-4 py-2 text-base font-medium text-ink";

export default async function MesasPage({ params }: PageProps<"/panel/[org]/mesas">) {
  const { org } = await params;
  const { membership } = await requireMembership(org, `/panel/${org}/mesas`);
  const db = await createSessionClient();

  const [branches, ent] = await Promise.all([loadMesas(db, membership.org.id), getEntitlements(membership.org.id)]);
  // Si no se pudo leer el estado de la cuenta, falla cerrado: se muestra pero no se edita.
  const canWrite = ent?.canWrite === true;
  const notice = mesasBlockNotice(ent);
  const limit = ent?.limits.tables_per_branch;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-4xl leading-tight">Mesas</h1>
      <p className="mt-2 max-w-prose text-base text-muted">
        Cada mesa tiene su propio QR. Al escanearlo, el comensal ve la carta de la sucursal sabiendo en qué mesa está.
      </p>
      {ent ? null : (
        <p className="mt-2 text-base text-muted">No pudimos comprobar el estado de la cuenta, así que la edición está desactivada.</p>
      )}
      {notice ? (
        <p className="mt-3 max-w-prose text-base font-medium" data-testid="mesas-bloqueadas">
          {notice}
        </p>
      ) : null}

      {branches.length === 0 ? (
        <p className="mt-10 max-w-prose text-lg text-muted">Este local todavía no tiene sucursales.</p>
      ) : null}

      {branches.map((branch) => {
        const active = branch.tables.filter((table) => table.is_active).length;
        return (
          <section
            key={branch.id}
            aria-labelledby={`suc-${branch.id}`}
            className="mt-12 border-t-2 border-ink/30 pt-5"
            data-testid="sucursal"
            data-name={branch.name}
          >
            <h2 id={`suc-${branch.id}`} className="font-display text-3xl leading-tight break-words">
              {branch.name}
            </h2>
            <p className="mt-1 text-lg" data-testid="mesas-activas">
              Mesas activas:{" "}
              <span className="font-medium tabular-nums">{typeof limit === "number" ? `${active} de ${limit}` : `${active}, sin tope`}</span>
            </p>
            {typeof limit === "number" && active >= limit ? (
              <p className="mt-1 max-w-prose text-base text-muted" data-testid="aviso-tope">
                Llegaste al tope de mesas activas de tu plan en esta sucursal. Para sumar otra, desactivá una.
              </p>
            ) : null}

            {active > 0 ? (
              <div className="mt-3">
                <Link href={`/panel/${membership.org.slug}/mesas/imprimir/${branch.id}`} className={linkButtonClass}>
                  Imprimir los QR de {branch.name}
                </Link>
              </div>
            ) : null}

            <CreateTableForm
              orgSlug={membership.org.slug}
              branchId={branch.id}
              branchName={branch.name}
              suggestion={suggestNextLabel(branch.tables.map((table) => table.label))}
              canWrite={canWrite}
            />

            {branch.tables.length > 0 ? (
              <ul className="mt-6 border-t border-ink/15">
                {branch.tables.map((table) => (
                  <li key={table.id} className="border-b border-ink/15 py-4" data-testid="mesa" data-label={table.label}>
                    <div className="flex items-baseline gap-3 text-lg">
                      <span className="min-w-0 font-medium break-words">{table.label}</span>
                      <span aria-hidden className="leader" />
                      {table.is_active ? null : <span className={`${badgeClass} shrink-0`}>Inactiva</span>}
                    </div>
                    <div className="mt-3 flex flex-wrap items-start gap-2">
                      <TableToggle
                        orgSlug={membership.org.slug}
                        id={table.id}
                        label={table.label}
                        isActive={table.is_active}
                        canWrite={canWrite}
                      />
                      <RenameTableForm orgSlug={membership.org.slug} id={table.id} label={table.label} canWrite={canWrite} />
                      <RegenerateQrForm orgSlug={membership.org.slug} id={table.id} label={table.label} canWrite={canWrite} />
                      <Link
                        href={`/t/${table.qr_token}`}
                        className={linkButtonClass}
                        aria-label={`Probar el QR de ${table.label}`}
                      >
                        Probar el QR
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-6 text-base text-muted">Esta sucursal todavía no tiene mesas.</p>
            )}
          </section>
        );
      })}
    </main>
  );
}
