import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { asUuid } from "@/lib/carta/validation";
import { formatArs } from "@/lib/money";
import { buildPrecuenta, formatLocal, PRECUENTA_LEGEND, statusNotice } from "@/lib/sala/precuenta";
import { loadPrecuenta } from "@/lib/sala/precuenta-loader";
import { createSessionClient } from "@/lib/supabase/server";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Precuenta" };

export default async function SalaPrecuentaPage({ params }: PageProps<"/sala/[org]/cuenta/[pedido]">) {
  const { org, pedido } = await params;
  const orderId = asUuid(pedido);
  if (!orderId) notFound();
  const { membership } = await requireMembership(org, `/sala/${org}/cuenta/${orderId}`);

  const data = await loadPrecuenta(await createSessionClient(), membership.org.id, orderId);
  if (!data) notFound();

  const body = buildPrecuenta(data.lines);
  const notice = statusNotice(data.status);
  const back = data.tableId ? `/sala/${membership.org.slug}/mesas/${data.tableId}/anotar` : `/sala/${membership.org.slug}/mesas`;

  return (
    <main className="mx-auto max-w-md px-4 py-6 sm:px-8 print:max-w-none print:p-0">
      <Link href={back} className="text-base font-medium underline underline-offset-2 print:hidden">
        ← Volver al pedido
      </Link>

      <article aria-labelledby="precuenta-titulo" data-testid="precuenta" className="mt-4 rounded-3xl border border-ink/15 bg-white p-5 print:mt-0 print:rounded-none print:border-0 print:p-0">
        <p className="text-sm font-semibold tracking-wide text-muted uppercase">Precuenta</p>
        <h1 id="precuenta-titulo" className="font-display text-3xl leading-tight break-words">
          {membership.org.name}
        </h1>
        <p className="mt-1 text-lg break-words" data-testid="precuenta-mesa">
          {data.tableLabel}
          {data.multiBranch ? ` · Sucursal ${data.branchName}` : ""}
        </p>
        <p className="text-base text-muted" data-testid="precuenta-fecha">
          {formatLocal(new Date(), data.timeZone)}
        </p>
        {notice ? (
          <p role="status" data-testid="precuenta-estado" className="mt-3 rounded-2xl bg-grace-bg px-4 py-2 text-base font-semibold text-grace-ink ring-1 ring-inset ring-grace-edge">
            {notice}
          </p>
        ) : null}

        {body.lines.length === 0 ? (
          <p className="mt-5 text-lg text-muted" data-testid="precuenta-vacia">
            No hay platos vigentes en este pedido.
          </p>
        ) : (
          <ul className="mt-5 divide-y divide-ink/10 border-y border-ink/15" data-testid="precuenta-lineas">
            {body.lines.map((line, index) => (
              <li key={index} data-testid="precuenta-linea" className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-lg break-words">
                    {line.quantity} × {line.name}
                  </p>
                  {line.options.length > 0 ? <p className="text-base text-muted break-words">{line.options.join(", ")}</p> : null}
                  {line.quantity > 1 ? <p className="text-sm text-muted">{formatArs(line.unitCents)} c/u</p> : null}
                </div>
                <p className="shrink-0 text-lg">{formatArs(line.lineCents)}</p>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 flex items-baseline justify-between gap-3" data-testid="precuenta-total" data-centavos={body.totalCents}>
          <span className="text-xl font-semibold">Total</span>
          <strong className="font-display text-4xl leading-none">{formatArs(body.totalCents)}</strong>
        </p>
        <p className="mt-1 text-sm text-muted">{body.dishes === 1 ? "1 plato" : `${body.dishes} platos`}</p>

        <p data-testid="precuenta-leyenda" className="mt-5 rounded-2xl border-2 border-ink px-4 py-3 text-center text-lg font-bold tracking-wide uppercase">
          {PRECUENTA_LEGEND}
        </p>
      </article>

      <div className="mt-5 print:hidden">
        <PrintButton />
      </div>
    </main>
  );
}
