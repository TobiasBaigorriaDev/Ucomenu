import type { Metadata } from "next";
import Link from "next/link";
import { PrimerosPasos } from "@/components/panel/primeros-pasos";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import { buildGuide, loadGuideCounts } from "@/lib/guia/primeros-pasos";
import { createSessionClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Resumen" };

const RESOURCE_LABEL: Record<string, string> = {
  active_products: "Platos activos",
  branches: "Sucursales",
};

export default async function PanelHomePage({ params }: PageProps<"/panel/[org]">) {
  const { org } = await params;
  const { membership } = await requireMembership(org, `/panel/${org}`);

  const supabase = await createSessionClient();
  const [branches, ent, counts] = await Promise.all([
    supabase.from("branches").select("id, slug, name").eq("organization_id", membership.org.id).order("name"),
    getEntitlements(membership.org.id),
    loadGuideCounts(supabase, membership.org.id),
  ]);

  const isOwner = membership.role === "owner";
  const guide = buildGuide({ counts, branchCount: branches.data?.length ?? 0, ent, role: membership.role, slug: membership.org.slug });

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-4xl leading-tight">Resumen</h1>

      {guide ? <PrimerosPasos guide={guide} /> : null}

      <section aria-labelledby="carta-publica" className="mt-8">
        <h2 id="carta-publica" className="font-display text-2xl">
          Carta pública
        </h2>
        {branches.data && branches.data.length > 0 ? (
          <ul className="mt-3 border-t border-ink/15">
            {branches.data.map((branch) => (
              <li key={branch.id} className="border-b border-ink/15">
                <Link
                  href={`/m/${membership.org.slug}/${branch.slug}`}
                  className="flex min-h-12 items-baseline gap-3 py-3 text-lg"
                >
                  <span className="font-medium break-words">{branch.name}</span>
                  <span aria-hidden className="leader" />
                  <span className="text-base text-cobalt underline underline-offset-2">Ver la carta</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="mt-3 max-w-prose text-muted">Este local todavía no tiene sucursales.</p>
            {isOwner ? (
              <Link
                href={`/panel/${membership.org.slug}/sucursales`}
                className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md bg-cobalt px-5 py-2 text-base font-medium text-white"
              >
                Crear la primera sucursal
              </Link>
            ) : null}
          </>
        )}
      </section>

      {isOwner && ent ? (
        <section aria-labelledby="uso" className="mt-10">
          <h2 id="uso" className="font-display text-2xl">
            Uso del plan
          </h2>
          <ul className="mt-3 border-t border-ink/15">
            {Object.keys(RESOURCE_LABEL).map((key) => {
              const used = ent.usage[key] ?? 0;
              const limit = ent.limits[key];
              return (
                <li key={key} className="flex items-baseline gap-3 border-b border-ink/15 py-3 text-lg">
                  <span>{RESOURCE_LABEL[key]}</span>
                  <span aria-hidden className="leader" />
                  <span className="tabular-nums">{limit === null || limit === undefined ? `${used}, sin tope` : `${used} de ${limit}`}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
