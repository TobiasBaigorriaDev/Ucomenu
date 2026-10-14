import Link from "next/link";
import type { HistoryRow } from "@/lib/precios/pantalla";

const linkButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-ink/40 px-4 py-2 text-base font-medium text-ink";

/**
 * Lista del historial de precios (del local o de un plato). Solo presentación: los datos ya vienen resueltos y con
 * las etiquetas de «quién» decididas por el servidor según el rol. La dirección del cambio va en palabras
 * («Sube» / «Baja»), no solo en un símbolo.
 */
export function PriceHistoryList({
  orgSlug,
  rows,
  showProduct,
  nextHref,
  firstHref,
  authorsNotice,
  emptyText,
}: {
  orgSlug: string;
  rows: HistoryRow[];
  showProduct: boolean;
  /** Enlace a los cambios más antiguos; `null` si no hay más. */
  nextHref: string | null;
  /** Enlace a lo más reciente; solo cuando se está viendo una página posterior a la primera. */
  firstHref: string | null;
  /** El Dueño no pudo ver los emails: se avisa una vez. */
  authorsNotice: boolean;
  emptyText: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="mt-8">
        <p className="max-w-prose text-lg text-muted" data-testid="historial-vacio">
          {emptyText}
        </p>
        {firstHref ? (
          <Link href={firstHref} className={`${linkButtonClass} mt-4`}>
            Volver a lo más reciente
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-6">
      {authorsNotice ? (
        <p role="status" className="mb-3 max-w-prose text-base text-muted" data-testid="historial-autores-no-disponibles">
          No pudimos identificar a las personas en este momento. Probá de nuevo en unos minutos.
        </p>
      ) : null}
      <ul className="border-t border-ink/15" data-testid="historial-lista">
        {rows.map((row) => (
          <li key={row.id} className="border-b border-ink/15 py-4" data-testid="historial-fila">
            {showProduct ? (
              <p className="text-lg font-medium [overflow-wrap:anywhere]" data-testid="historial-plato">
                {row.productLinkId ? (
                  <Link href={`/panel/${orgSlug}/carta/platos/${row.productLinkId}/historial`} className="text-cobalt underline underline-offset-2">
                    {row.productName}
                  </Link>
                ) : (
                  <span className="text-muted">Plato eliminado</span>
                )}
                {row.productInactive ? <span className="ml-2 text-sm font-normal text-muted">(inactivo)</span> : null}
              </p>
            ) : null}
            <p className="mt-1 text-lg tabular-nums [overflow-wrap:anywhere]">
              <span data-testid="historial-cambio">{row.transition}</span>
              <span className="ml-2 text-base text-muted" data-testid="historial-diferencia">
                <span aria-hidden>{row.direction === "up" ? "▲ " : "▼ "}</span>
                {row.difference}
              </span>
            </p>
            <p className="mt-1 text-base text-muted [overflow-wrap:anywhere]">
              <time dateTime={row.whenIso} data-testid="historial-cuando">
                {row.whenLabel}
              </time>
              {" · "}
              <span data-testid="historial-autor">{row.author}</span>
            </p>
          </li>
        ))}
      </ul>
      {nextHref || firstHref ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {nextHref ? (
            <Link href={nextHref} className={linkButtonClass} data-testid="historial-ver-mas">
              Ver cambios más antiguos
            </Link>
          ) : null}
          {firstHref ? (
            <Link href={firstHref} className={linkButtonClass}>
              Volver a lo más reciente
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
