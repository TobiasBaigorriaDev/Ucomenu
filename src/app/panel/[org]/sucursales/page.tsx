import type { Metadata } from "next";
import Link from "next/link";
import { getEntitlements, requireOwner } from "@/lib/auth/session";
import { loadSucursales } from "@/lib/sucursales/branches";
import { branchBreakdown } from "@/lib/entitlements";
import { branchLimitMessage, sucursalesBlockNotice } from "@/lib/sucursales/messages";
import { createSessionClient } from "@/lib/supabase/server";
import { CreateBranchForm, RenameBranchForm, ReviewLinkForm, ToggleBranchActiveForm } from "./branch-forms";

export const metadata: Metadata = { title: "Sucursales" };

const linkButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-ink/40 px-4 py-2 text-base font-medium text-ink";

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
  // «Usadas» = activas: las desactivadas no cuentan para el tope del plan.
  const activeCount = branches.filter((branch) => branch.isActive).length;
  const used = ent?.usage.branches ?? activeCount;
  const atLimit = typeof limit === "number" && used >= limit;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Sucursales</h1>
      <p className="mt-2 max-w-prose text-base text-muted">
        Cada sucursal tiene su dirección de carta, sus mesas y su QR. La carta es la misma para todo el local. Una sucursal desactivada no cuenta para el tope de tu plan y su carta y sus QR dicen «no disponible».
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
        Sucursales activas:{" "}
        <span className="font-medium tabular-nums">{typeof limit === "number" ? `${used} de ${limit}` : `${used}, sin tope`}</span>
        {branchBreakdown(ent) ? <span className="text-base text-muted" data-testid="sucursales-desglose"> ({branchBreakdown(ent)})</span> : null}
      </p>

      <section aria-labelledby="lista" className="panel-cell mt-6">
        <h2 id="lista" className="font-display text-2xl">
          Tus sucursales
        </h2>
        {branches.length === 0 ? (
          <p className="mt-3 max-w-prose text-base text-muted">Este local todavía no tiene sucursales: sin una, la carta no se puede abrir.</p>
        ) : (
          <ul className="mt-3 panel-list">
            {branches.map((branch) => (
              <li
                key={branch.id}
                className="border-b border-ink/15 py-4"
                data-testid="sucursal"
                data-name={branch.name}
                data-active={branch.isActive ? "true" : "false"}
              >
                <p className="text-lg font-medium break-words">
                  {branch.name}
                  {branch.isActive ? null : (
                    <span className="ml-2 rounded-full border border-ink/40 px-2 py-0.5 text-sm font-medium" data-testid="sucursal-desactivada">
                      Desactivada
                    </span>
                  )}
                </p>
                <p className="mt-1 text-base text-muted break-all">
                  Dirección de la carta: /m/{membership.org.slug}/{branch.slug}
                  {branch.isActive ? "" : " (hoy dice «no disponible»)"}
                </p>
                <p className="mt-1 text-base text-muted" data-testid="sucursal-mesas">
                  {branch.activeTables === 1 ? "1 mesa activa" : `${branch.activeTables} mesas activas`}
                  {branch.tables > branch.activeTables ? ` (${branch.tables} en total)` : ""}
                </p>
                <p className="mt-1 text-base text-muted break-all" data-testid="sucursal-resenas">
                  {branch.reviewUrl ? `Enlace de reseñas: ${branch.reviewUrl}` : "Sin enlace de reseñas de Google."}
                </p>
                <div className="mt-3 flex flex-wrap items-start gap-2">
                  {branch.isActive ? (
                    <Link href={`/m/${membership.org.slug}/${branch.slug}`} className={linkButtonClass} aria-label={`Ver la carta de ${branch.name}`}>
                      Ver la carta
                    </Link>
                  ) : null}
                  <Link href={`/panel/${membership.org.slug}/mesas`} className={linkButtonClass} aria-label={`Mesas de ${branch.name}`}>
                    Mesas
                  </Link>
                  <RenameBranchForm orgSlug={membership.org.slug} id={branch.id} name={branch.name} canWrite={canWrite} />
                  <ReviewLinkForm orgSlug={membership.org.slug} id={branch.id} name={branch.name} link={branch.reviewUrl} canWrite={canWrite} />
                  <ToggleBranchActiveForm
                    orgSlug={membership.org.slug}
                    id={branch.id}
                    name={branch.name}
                    isActive={branch.isActive}
                    isLastActive={branch.isActive && activeCount === 1}
                    canWrite={canWrite}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="alta" className="panel-cell mt-6">
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
