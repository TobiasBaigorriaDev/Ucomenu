import type { Metadata } from "next";
import Link from "next/link";
import { requireKitchen } from "@/lib/auth/session";
import { loadKitchenMenu } from "@/lib/cocina/loader";
import { createSessionClient } from "@/lib/supabase/server";
import { AvailabilityList } from "./availability-list";

export const metadata: Metadata = { title: "Platos agotados" };

export default async function CocinaCartaPage({ params, searchParams }: PageProps<"/cocina/[org]/carta">) {
  const { org } = await params;
  const { membership } = await requireKitchen(org, `/cocina/${org}/carta`);
  const { sucursal } = await searchParams;
  const menu = await loadKitchenMenu(await createSessionClient(), membership.org.id, typeof sucursal === "string" ? sucursal : null);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Platos agotados</h1>
      <p className="mt-3 max-w-prose text-lg leading-relaxed text-muted">
        Marcá lo que se terminó y la carta lo muestra como «no disponible» en esa sucursal. Cuando haya de nuevo, volvé a marcarlo.
      </p>

      {!menu.enabled ? (
        <section aria-labelledby="carta-aviso" data-testid="cocina-deshabilitada" className="panel-cell mt-6 max-w-prose">
          <h2 id="carta-aviso" className="font-display text-2xl">
            Por ahora no se puede cambiar la carta
          </h2>
          <p className="mt-2 text-lg leading-relaxed text-muted">El plan o la cuenta no lo permiten ahora. Avisale al dueño.</p>
        </section>
      ) : menu.branchId === null ? (
        <p className="mt-6 text-lg text-muted">Este local no tiene sucursales activas.</p>
      ) : (
        <>
          {menu.branches.length > 1 ? (
            <nav aria-label="Sucursal" className="mt-6 flex flex-wrap gap-2">
              {menu.branches.map((branch) => (
                <Link
                  key={branch.id}
                  href={`/cocina/${membership.org.slug}/carta?sucursal=${branch.id}`}
                  aria-current={branch.id === menu.branchId ? "page" : undefined}
                  className={`${branch.id === menu.branchId ? "bg-brand text-white" : "bg-blush text-ink hover:bg-sand"} inline-flex min-h-11 items-center rounded-full px-4 text-base font-medium`}
                >
                  {branch.name}
                </Link>
              ))}
            </nav>
          ) : null}
          {menu.categories.length === 0 ? (
            <p className="mt-6 text-lg text-muted">La carta todavía no tiene platos activos.</p>
          ) : (
            <AvailabilityList key={menu.branchId} slug={membership.org.slug} branchId={menu.branchId} categories={menu.categories} />
          )}
        </>
      )}
    </main>
  );
}
