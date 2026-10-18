import type { Metadata } from "next";
import Link from "next/link";
import { PrimerosPasos } from "@/components/panel/primeros-pasos";
import { AvisoPush } from "@/components/push/aviso-push";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import { buildGuide, loadGuideCounts } from "@/lib/guia/primeros-pasos";
import { vapidPublicKey } from "@/lib/push/config";
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
    supabase.from("branches").select("id, slug, name, is_active").eq("organization_id", membership.org.id).order("name"),
    getEntitlements(membership.org.id),
    loadGuideCounts(supabase, membership.org.id),
  ]);

  const isOwner = membership.role === "owner";
  // Las desactivadas no publican carta: el Resumen enlaza solo las activas y avisa si no queda ninguna.
  const activeBranches = (branches.data ?? []).filter((branch) => branch.is_active);
  const allInactive = activeBranches.length === 0 && (branches.data?.length ?? 0) > 0;
  const guide = buildGuide({ counts, branchCount: activeBranches.length, ent, role: membership.role, slug: membership.org.slug });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Resumen</h1>

      {guide ? <PrimerosPasos guide={guide} /> : null}

      {/* Solo con el plan que incluye el llamado (la función de base rechazaría el alta igual) y con claves VAPID en el servidor. */}
      {ent?.features.includes("waiter_call") ? (
        <div className="mt-6">
          <AvisoPush slug={membership.org.slug} publicKey={vapidPublicKey()} where="panel" />
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-[3fr_2fr] lg:items-start">
        <section aria-labelledby="carta-publica" className="rounded-3xl bg-brand p-5 text-white sm:p-6">
          <h2 id="carta-publica" className="font-display text-2xl">
            Carta pública
          </h2>
          {activeBranches.length > 0 ? (
            <ul className="mt-3 divide-y divide-white/25 border-t border-white/25">
              {activeBranches.map((branch) => (
                <li key={branch.id}>
                  <Link
                    href={`/m/${membership.org.slug}/${branch.slug}`}
                    className="flex min-h-12 items-baseline gap-3 py-3 text-lg outline-offset-0 focus-visible:outline-white"
                  >
                    <span className="font-medium break-words">{branch.name}</span>
                    <span aria-hidden className="leader" />
                    <span className="text-base underline underline-offset-4">Ver la carta</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p className="mt-3 max-w-prose" data-testid="resumen-sin-sucursales-activas">
                {allInactive
                  ? "Todas las sucursales están desactivadas: la carta pública no está disponible."
                  : "Este local todavía no tiene sucursales."}
              </p>
              {isOwner ? (
                <Link
                  href={`/panel/${membership.org.slug}/sucursales`}
                  className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full bg-porcelain px-5 py-2 text-base font-medium text-ink"
                >
                  {allInactive ? "Reactivar una sucursal" : "Crear la primera sucursal"}
                </Link>
              ) : null}
            </>
          )}
        </section>

        {isOwner && ent ? (
          <section aria-labelledby="uso" className="rounded-3xl bg-sand p-5 ring-1 ring-inset ring-ink/15 sm:p-6">
            <h2 id="uso" className="font-display text-2xl">
              Uso del plan
            </h2>
            <ul className="mt-3 divide-y divide-ink/15 border-t border-ink/15">
              {Object.keys(RESOURCE_LABEL).map((key) => {
                const used = ent.usage[key] ?? 0;
                const limit = ent.limits[key];
                return (
                  <li key={key} className="flex items-baseline gap-3 py-3 text-lg">
                    <span>{RESOURCE_LABEL[key]}</span>
                    <span aria-hidden className="leader" />
                    <span className="font-medium tabular-nums">{limit === null || limit === undefined ? `${used}, sin tope` : `${used} de ${limit}`}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
