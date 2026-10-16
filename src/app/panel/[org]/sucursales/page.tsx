import type { Metadata } from "next";
import Link from "next/link";
import { getEntitlements, requireOwner } from "@/lib/auth/session";
import { loadSucursales } from "@/lib/sucursales/branches";
import { branchLimitMessage, sucursalesBlockNotice } from "@/lib/sucursales/messages";
import { createSessionClient } from "@/lib/supabase/server";
import { CreateBranchForm, RenameBranchForm } from "./branch-forms";

export const metadata: Metadata = { title: "Sucursales" };

const linkButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-ink/40 px-4 py-2 text-base font-medium text-ink";

/** Solo Dueño (ficha gestion-de-sucursales). La comprobación es del servidor: el Staff que abra esta URL vuelve al inicio sin ver nada. */
export default async function SucursalesPage({ params }: PageProps<"/panel/[org]/sucursales">) {
  const { org } = await params;
  const { membership } = await requireOwner(org, `/panel/${org}/sucursales`);
  const db = await createSessionClient();

  const [branches, ent] = await Promise.all([loadSucursales(db, membership.org.id), getEntitlements(membership.org.id)]);
  // Si no se pudo leer el estado de la cuenta, falla cerrado: se muestra pero no se edita.
  const canWrite = ent?.canWrite === true;
  const notice = sucursalesBlockNotice(ent);
  const limit = ent?.limits.branches;
  const used = ent?.usage.branches ?? branches.length;
  const atLimit = typeof limit === "number" && used >= limit;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-4xl leading-tight">Sucursales</h1>
      <p className="mt-2 max-w-prose text-base text-muted">
        Cada sucursal tiene su dirección de carta, sus mesas y su QR. La carta es la misma para todo el local.
      </p>
      {ent ? null : (
        <p className="mt-2 text-base text-muted">No pudimos comprobar el estado de la cuenta, así que la edición está desactivada.</p>
      )}
      {notice ? (
        <p className="mt-3 max-w-prose text-base font-medium" data-testid="sucursales-bloqueadas">
          {notice}
        </p>
      ) : null}

      <p className="mt-4 text-lg" data-testid="sucursales-uso">
        Sucursales:{" "}
        <span className="font-medium tabular-nums">{typeof limit === "number" ? `${used} de ${limit}` : `${used}, sin tope`}</span>
      </p>

      <section aria-labelledby="lista" className="mt-6">
        <h2 id="lista" className="font-display text-2xl">
          Tus sucursales
        </h2>
        {branches.length === 0 ? (
          <p className="mt-3 max-w-prose text-base text-muted">Este local todavía no tiene sucursales: sin una, la carta no se puede abrir.</p>
        ) : (
          <ul className="mt-3 border-t border-ink/15">
            {branches.map((branch) => (
              <li key={branch.id} className="border-b border-ink/15 py-4" data-testid="sucursal" data-name={branch.name}>
                <p className="text-lg font-medium break-words">{branch.name}</p>
                <p className="mt-1 text-base text-muted break-all">
                  Dirección de la carta: /m/{membership.org.slug}/{branch.slug}
                </p>
                <p className="mt-1 text-base text-muted" data-testid="sucursal-mesas">
                  {branch.activeTables === 1 ? "1 mesa activa" : `${branch.activeTables} mesas activas`}
                  {branch.tables > branch.activeTables ? ` (${branch.tables} en total)` : ""}
                </p>
                <div className="mt-3 flex flex-wrap items-start gap-2">
                  <Link href={`/m/${membership.org.slug}/${branch.slug}`} className={linkButtonClass} aria-label={`Ver la carta de ${branch.name}`}>
                    Ver la carta
                  </Link>
                  <Link href={`/panel/${membership.org.slug}/mesas`} className={linkButtonClass} aria-label={`Mesas de ${branch.name}`}>
                    Mesas
                  </Link>
                  <RenameBranchForm orgSlug={membership.org.slug} id={branch.id} name={branch.name} canWrite={canWrite} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="alta" className="mt-10">
        <h2 id="alta" className="font-display text-2xl">
          Agregar una sucursal
        </h2>
        {atLimit ? (
          <p className="mt-3 max-w-prose text-base" data-testid="aviso-tope">
            {branchLimitMessage(ent)}
          </p>
        ) : null}
        <CreateBranchForm orgSlug={membership.org.slug} canWrite={canWrite} full={atLimit} />
      </section>
    </main>
  );
}
