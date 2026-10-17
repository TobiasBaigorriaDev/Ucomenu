import type { Metadata } from "next";
import Link from "next/link";
import { PriceHistoryList } from "@/components/panel/price-history-list";
import { requireMembership } from "@/lib/auth/session";
import { loadHistoryScreen } from "@/lib/precios/pantalla";

export const metadata: Metadata = { title: "Historial de precios" };

/** Dueño y Staff (la lectura la decide la base por RLS). Se abre aunque la cuenta esté en solo lectura o suspendida. */
export default async function PriceHistoryPage({ params, searchParams }: PageProps<"/panel/[org]/historial-de-precios">) {
  const { org } = await params;
  const { despues } = await searchParams;
  const { user, membership } = await requireMembership(org, `/panel/${org}/historial-de-precios`);

  const screen = await loadHistoryScreen({
    orgId: membership.org.id,
    viewer: { id: user.id, role: membership.role },
    rawCursor: despues,
  });
  const base = `/panel/${membership.org.slug}/historial-de-precios`;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <Link href={`/panel/${org}/carta`} className="inline-flex min-h-11 items-center text-base text-cobalt underline underline-offset-2">
        Volver a la carta
      </Link>
      <h1 className="font-display text-4xl leading-tight">Historial de precios</h1>
      <p className="mt-2 max-w-prose text-base text-muted">
        Cada vez que cambia el precio de un plato queda registrado: de cuánto a cuánto, cuándo y quién lo hizo.
      </p>

      {screen.state === "error" ? (
        <p role="alert" className="mt-8 max-w-prose text-danger" data-testid="historial-error">
          No pudimos cargar el historial. Probá de nuevo en unos minutos.
        </p>
      ) : (
        <PriceHistoryList
          orgSlug={membership.org.slug}
          rows={screen.rows}
          showProduct
          nextHref={screen.next ? `${base}?${new URLSearchParams({ despues: screen.next })}` : null}
          firstHref={typeof despues === "string" && despues ? base : null}
          authorsNotice={screen.authorsNotice}
          emptyText="Todavía no se cambió el precio de ningún plato."
        />
      )}
    </main>
  );
}
