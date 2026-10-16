import Link from "next/link";
import type { HistoryRow } from "@/lib/precios/pantalla";

const linkButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-ink/40 px-4 py-2 text-base font-medium text-ink";

const ZONA = "America/Argentina/Buenos_Aires";
const diaClave = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA });
const diaTitulo = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: ZONA });
const horaFormato = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: ZONA });

/** Agrupa filas consecutivas por día (hora de Argentina). El orden de entrada, más nuevo primero, no cambia. */
function porDia(rows: HistoryRow[]) {
  const dias: { key: string; title: string; rows: HistoryRow[] }[] = [];
  for (const row of rows) {
    const date = new Date(row.whenIso);
    const valid = !Number.isNaN(date.getTime());
    const key = valid ? diaClave.format(date) : row.whenIso;
    const last = dias[dias.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else dias.push({ key, title: valid ? diaTitulo.format(date) : row.whenLabel, rows: [row] });
  }
  return dias;
}

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
      <div className="mt-8 border-t-2 border-ink/30 pt-5">
        <p className="max-w-prose font-display text-2xl leading-snug" data-testid="historial-vacio">
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
    <div className="mt-8">
      {authorsNotice ? (
        <p role="status" className="mb-4 max-w-prose text-base text-muted" data-testid="historial-autores-no-disponibles">
          No pudimos identificar a las personas en este momento. Probá de nuevo en unos minutos.
        </p>
      ) : null}
      <div data-testid="historial-lista">
        {porDia(rows).map((dia) => (
          <section key={dia.key} aria-label={dia.title} className="border-t-2 border-ink/30 pb-6 pt-4 first:border-t-0 first:pt-0">
            <h2 className="font-display text-2xl lining-nums first-letter:uppercase">{dia.title}</h2>
            <ul className="mt-2">
              {dia.rows.map((row) => (
                <li key={row.id} className="border-b border-ink/15 py-4 last:border-b-0" data-testid="historial-fila">
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
                  <div className={`${showProduct ? "mt-1" : ""} flex flex-wrap items-center gap-x-3 gap-y-1`}>
                    <span className="text-2xl font-semibold tabular-nums [overflow-wrap:anywhere]" data-testid="historial-cambio">
                      {row.transition}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-base font-medium tabular-nums ${
                        row.direction === "up" ? "bg-grace-bg text-grace-ink" : "bg-tile text-ink"
                      }`}
                      data-testid="historial-diferencia"
                    >
                      <span aria-hidden>{row.direction === "up" ? "▲" : "▼"}</span>
                      {row.difference}
                    </span>
                  </div>
                  <p className="mt-1 text-base text-muted [overflow-wrap:anywhere]">
                    <time dateTime={row.whenIso} title={row.whenLabel} className="tabular-nums" data-testid="historial-cuando">
                      {horaFormato.format(new Date(row.whenIso))}
                    </time>
                    {" · "}
                    <span data-testid="historial-autor">{row.author}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {nextHref || firstHref ? (
        <div className="mt-2 flex flex-wrap gap-2">
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
