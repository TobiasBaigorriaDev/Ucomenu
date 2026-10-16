import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PriceHistoryList } from "@/components/panel/price-history-list";
import { requireMembership } from "@/lib/auth/session";
import { asUuid } from "@/lib/carta/validation";
import { loadProductInfo } from "@/lib/precios/historial";
import { loadHistoryScreen } from "@/lib/precios/pantalla";
import { createSessionClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Historial de precios del plato" };

/**
 * Historial de un plato. El plato se busca solo entre los de ESTE local (RLS): un id de otro local, uno inexistente y
 * uno de un plato ya eliminado dan el mismo 404 (el historial de un plato eliminado se ve en la lista del local).
 */
export default async function ProductPriceHistoryPage({
  params,
  searchParams,
}: PageProps<"/panel/[org]/carta/platos/[id]/historial">) {
  const { org, id } = await params;
  const { despues } = await searchParams;
  const { user, membership } = await requireMembership(org, `/panel/${org}/carta/platos/${id}/historial`);

  const productId = asUuid(id);
  if (!productId) notFound();

  const info = await loadProductInfo(await createSessionClient(), membership.org.id, [productId]);
  if (info && !info.has(productId)) notFound();
  const product = info?.get(productId);

  const screen = info
    ? await loadHistoryScreen({
        orgId: membership.org.id,
        viewer: { id: user.id, role: membership.role },
        productId,
        rawCursor: despues,
      })
    : ({ state: "error" } as const);
  const base = `/panel/${membership.org.slug}/carta/platos/${productId}/historial`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href={`/panel/${org}/carta/platos/${productId}`}
        className="inline-flex min-h-11 items-center text-base text-cobalt underline underline-offset-2"
      >
        Volver al plato
      </Link>
      <h1 className="font-display text-4xl leading-tight break-words">{product ? product.name : "Historial de precios"}</h1>
      <p className="mt-2 max-w-prose text-base text-muted">Historial de precios: de cuánto a cuánto, cuándo y quién lo cambió.</p>

      {screen.state === "error" ? (
        <p role="alert" className="mt-8 max-w-prose text-danger" data-testid="historial-error">
          No pudimos cargar el historial. Probá de nuevo en unos minutos.
        </p>
      ) : (
        <PriceHistoryList
          orgSlug={membership.org.slug}
          rows={screen.rows}
          showProduct={false}
          nextHref={screen.next ? `${base}?${new URLSearchParams({ despues: screen.next })}` : null}
          firstHref={typeof despues === "string" && despues ? base : null}
          authorsNotice={screen.authorsNotice}
          emptyText="Este plato no tuvo cambios de precio."
        />
      )}
    </main>
  );
}
