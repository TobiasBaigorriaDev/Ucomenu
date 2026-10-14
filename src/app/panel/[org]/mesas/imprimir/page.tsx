import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { QrCode } from "@/components/panel/qr-code";
import { requireMembership } from "@/lib/auth/session";
import { asUuid } from "@/lib/carta/validation";
import { loadMesas } from "@/lib/mesas/tables";
import { resolveBaseUrl, tableUrl } from "@/lib/mesas/url";
import { createSessionClient } from "@/lib/supabase/server";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Imprimir los QR" };

/**
 * Hoja imprimible de los QR de una sucursal: una tarjeta por mesa ACTIVA. Es solo lectura, así que sigue
 * disponible con la cuenta en solo lectura o suspendida. La base del QR no viene de un parámetro de la URL.
 */
export default async function PrintTablesPage({ params, searchParams }: PageProps<"/panel/[org]/mesas/imprimir">) {
  const { org } = await params;
  const { sucursal } = await searchParams;
  const { membership } = await requireMembership(org, `/panel/${org}/mesas/imprimir`);

  const branchId = asUuid(Array.isArray(sucursal) ? sucursal[0] : sucursal);
  if (!branchId) notFound();

  const db = await createSessionClient();
  const branch = (await loadMesas(db, membership.org.id)).find((b) => b.id === branchId);
  // Una sucursal de otro local es un 404, igual que una inexistente.
  if (!branch) notFound();

  const base = resolveBaseUrl(await headers());
  const tables = branch.tables.filter((table) => table.is_active);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 print:max-w-none print:p-0">
      <div className="print:hidden">
        <Link href={`/panel/${org}/mesas`} className="inline-flex min-h-11 items-center text-base text-cobalt underline underline-offset-2">
          Volver a las mesas
        </Link>
        <h1 className="font-display text-4xl leading-tight break-words">QR de {branch.name}</h1>
        <p className="mt-2 max-w-prose text-base text-muted">
          Una tarjeta por mesa activa, seis por hoja A4. Imprimila, recortá las tarjetas y pegalas en cada mesa. Si
          regenerás el QR de una mesa, volvé a imprimir su tarjeta.
        </p>
        {base && tables.length > 0 ? (
          <div className="mt-4">
            <PrintButton />
          </div>
        ) : null}
      </div>

      {!base ? (
        <p role="alert" className="mt-6 max-w-prose text-base font-medium text-danger">
          No pudimos determinar la dirección pública de la carta. Pedile a quien administra el sistema que defina
          NEXT_PUBLIC_SITE_URL.
        </p>
      ) : tables.length === 0 ? (
        <p className="mt-6 max-w-prose text-lg text-muted">Esta sucursal no tiene mesas activas para imprimir.</p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 print:mt-0 print:gap-0">
          {tables.map((table) => (
            <li
              key={table.id}
              data-testid="tarjeta-qr"
              data-label={table.label}
              className="flex break-inside-avoid flex-col items-center justify-center border border-ink/40 px-4 py-6 text-center print:h-[88mm] print:border-ink"
            >
              <p className="font-display text-xl leading-tight break-words">{membership.org.name}</p>
              <QrCode
                value={tableUrl(base, table.qr_token)}
                title={`Código QR de ${table.label}`}
                className="mt-3 aspect-square w-48 print:w-[52mm]"
              />
              <p className="mt-3 font-display text-3xl leading-tight break-words">{table.label}</p>
              <p className="mt-1 text-base">Escaneá para ver la carta</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
