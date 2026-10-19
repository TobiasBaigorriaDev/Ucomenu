import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MenuUnavailable } from "@/components/menu/menu-unavailable";
import { PublicMenuView } from "@/components/menu/public-menu-view";
import { CallBar } from "./call-bar";
import { localizedMenu, requestLang, requestLangForNotice } from "@/lib/idiomas/pedido";
import { TEXTOS } from "@/lib/idiomas/textos";
import { issueVisitTicket, VISIT_TTL_MS } from "@/lib/llamados/visit-ticket";
import { resolveTable } from "@/lib/mesas/public-table";
import { getPublicMenu } from "@/lib/public-menu";

/**
 * Entrada por el QR de una mesa. El token vive en la URL, así que la página no se indexa y no envía el
 * *referrer*. Un token desconocido, regenerado o malformado es un 404 idéntico (no revela nada).
 */
export async function generateMetadata({ params, searchParams }: PageProps<"/t/[token]">): Promise<Metadata> {
  const { token } = await params;
  const query = await searchParams;
  const table = await resolveTable(token);
  const base = { robots: { index: false, follow: false }, referrer: "no-referrer" } as const;
  if (!table) return { ...base, title: TEXTOS.es.notFoundTitle };
  // El título sigue el idioma del pedido entre los que ofrece el local. Si la mesa no está disponible no hay carta que
  // consultar y vale cualquiera de los tres.
  if (table.status !== "available") return { ...base, title: TEXTOS[await requestLangForNotice(query)].unavailableTitle(table.orgName) };
  const result = await getPublicMenu(table.orgSlug, table.branchSlug);
  const lang = result?.kind === "menu" ? await requestLang(query, result.menu.languages) : "es";
  return { ...base, title: TEXTOS[lang].cartaDe(table.orgName) };
}

export default async function TablePage({ params, searchParams }: PageProps<"/t/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  const table = await resolveTable(token);
  if (!table) notFound();
  if (table.status !== "available") {
    return <MenuUnavailable organizationName={table.orgName} reason={table.status === "inactive" ? "branch_inactive" : "suspended"} lang={await requestLangForNotice(query)} />;
  }

  const result = await getPublicMenu(table.orgSlug, table.branchSlug);
  if (!result) notFound();
  if (result.kind === "unavailable") return <MenuUnavailable organizationName={result.organizationName} reason={result.reason} lang={await requestLangForNotice(query)} />;

  const { menu, lang } = await localizedMenu(result.menu, query);

  // Una mesa desactivada se comporta como el link directo: la carta, sin la etiqueta de mesa ni los botones de llamado.
  // Los botones solo existen si la base informa que se puede llamar (plan, cuenta al día, mesa activa y no silenciada);
  // aunque alguien fuerce la acción, la función de base responde «no disponible». El ticket de visita (que se emite en cada
  // carga de la página, nunca desde caché) lo valida la acción: una pestaña vieja deja de poder avisar (ticket-de-visita).
  return table.callsEnabled ? (
    <PublicMenuView menu={menu} lang={lang} tableLabel={table.tableLabel} callBar={<CallBar token={token} ticket={issueVisitTicket(token)} ttlMs={VISIT_TTL_MS} lang={lang} />} />
  ) : (
    <PublicMenuView menu={menu} lang={lang} tableLabel={table.tableActive ? table.tableLabel : null} />
  );
}
