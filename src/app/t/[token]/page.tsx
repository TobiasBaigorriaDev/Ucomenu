import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MenuUnavailable } from "@/components/menu/menu-unavailable";
import { PublicMenuView } from "@/components/menu/public-menu-view";
import { CallBar } from "./call-bar";
import { resolveTable } from "@/lib/mesas/public-table";
import { getPublicMenu } from "@/lib/public-menu";

/**
 * Entrada por el QR de una mesa. El token vive en la URL, así que la página no se indexa y no envía el
 * *referrer*. Un token desconocido, regenerado o malformado es un 404 idéntico (no revela nada).
 */
export async function generateMetadata({ params }: PageProps<"/t/[token]">): Promise<Metadata> {
  const { token } = await params;
  const table = await resolveTable(token);
  const base = { robots: { index: false, follow: false }, referrer: "no-referrer" } as const;
  if (!table) return { ...base, title: "Carta no encontrada" };
  if (table.status === "suspended") return { ...base, title: `${table.orgName} · Carta no disponible` };
  return { ...base, title: `Carta de ${table.orgName}` };
}

export default async function TablePage({ params }: PageProps<"/t/[token]">) {
  const { token } = await params;
  const table = await resolveTable(token);
  if (!table) notFound();
  if (table.status === "suspended") return <MenuUnavailable organizationName={table.orgName} />;

  const result = await getPublicMenu(table.orgSlug, table.branchSlug);
  if (!result) notFound();
  if (result.kind === "unavailable") return <MenuUnavailable organizationName={result.organizationName} />;

  // Una mesa desactivada se comporta como el link directo: la carta, sin la etiqueta de mesa ni los botones de llamado.
  // Los botones solo existen si la base informa que se puede llamar (plan, cuenta al día, mesa activa y no silenciada);
  // aunque alguien fuerce la acción, la función de base responde «no disponible».
  return table.callsEnabled ? (
    <div className="pb-32">
      <PublicMenuView menu={result.menu} tableLabel={table.tableLabel} />
      <CallBar token={token} />
    </div>
  ) : (
    <PublicMenuView menu={result.menu} tableLabel={table.tableActive ? table.tableLabel : null} />
  );
}
