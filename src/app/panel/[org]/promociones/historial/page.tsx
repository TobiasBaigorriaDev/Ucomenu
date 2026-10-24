import type { Metadata } from "next";
import Link from "next/link";
import { secondaryButtonClass } from "@/components/panel/styles";
import { requireMembership } from "@/lib/auth/session";
import { loadPromotionHistoryScreen } from "@/lib/promociones/pantalla-historial";

export const metadata: Metadata = { title: "Historial de promociones" };

/** Dueño y Staff (la lectura la decide la base por RLS). Se abre aunque la cuenta esté en solo lectura o suspendida. */
export default async function PromotionHistoryPage({ params, searchParams }: PageProps<"/panel/[org]/promociones/historial">) {
  const { org } = await params;
  const { despues } = await searchParams;
  const { user, membership } = await requireMembership(org, `/panel/${org}/promociones/historial`);
  const screen = await loadPromotionHistoryScreen({ orgId: membership.org.id, viewer: { id: user.id, role: membership.role }, rawCursor: despues });
  const base = `/panel/${membership.org.slug}/promociones/historial`;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <Link href={`/panel/${membership.org.slug}/promociones`} className="inline-flex min-h-11 items-center text-base text-cobalt underline underline-offset-2">
        Volver a las promociones
      </Link>
      <h1 className="font-display text-4xl leading-tight">Historial de promociones</h1>
      <p className="mt-2 max-w-prose text-base text-muted">
        Cada vez que se crea, cambia o borra una promoción, o se le suma o quita un plato, una categoría o una sucursal, queda registrado: qué
        cambió, cuándo y quién lo hizo. No cambia el historial de precios de la carta.
      </p>

      {screen.state === "error" ? (
        <p role="alert" className="mt-8 max-w-prose text-danger" data-testid="historial-promociones-error">
          No pudimos cargar el historial. Probá de nuevo en unos minutos.
        </p>
      ) : screen.rows.length === 0 ? (
        <p className="mt-8 max-w-prose text-base text-muted" data-testid="historial-promociones-vacio">
          Todavía no se creó ninguna promoción.
        </p>
      ) : (
        <>
          {screen.authorsNotice ? (
            <p className="mt-4 max-w-prose text-base text-muted">No pudimos identificar a quienes hicieron algunos cambios; se muestran como «otra persona».</p>
          ) : null}
          <ul className="panel-cell mt-6 panel-list" data-testid="historial-promociones-lista">
            {screen.rows.map((row) => (
              <li key={row.id} className="border-b border-ink/15 py-4" data-testid="historial-promociones-fila" data-event={row.event}>
                <p className="text-lg font-medium break-words">
                  {row.eventLabel}: {row.promotionName}
                </p>
                {row.detail ? <p className="mt-1 text-base break-words">{row.detail}</p> : null}
                <p className="mt-1 text-base text-muted">
                  <time dateTime={row.whenIso}>{row.whenLabel}</time> · {row.author}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap gap-3">
            {typeof despues === "string" && despues ? (
              <Link href={base} className={secondaryButtonClass}>
                Volver al principio
              </Link>
            ) : null}
            {screen.next ? (
              <Link href={`${base}?${new URLSearchParams({ despues: screen.next })}`} className={secondaryButtonClass}>
                Ver más
              </Link>
            ) : null}
          </div>
        </>
      )}
    </main>
  );
}
