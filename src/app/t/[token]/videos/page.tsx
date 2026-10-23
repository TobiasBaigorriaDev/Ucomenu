import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FeedScreen } from "@/components/menu/feed-screen";
import { MenuUnavailable } from "@/components/menu/menu-unavailable";
import { localizedMenu, requestLang, requestLangForNotice } from "@/lib/idiomas/pedido";
import { TEXTOS } from "@/lib/idiomas/textos";
import { issueVisitTicket, VISIT_TTL_MS } from "@/lib/llamados/visit-ticket";
import { resolveTable } from "@/lib/mesas/public-table";
import { getPublicMenu } from "@/lib/public-menu";
import { CallBar } from "../call-bar";

/**
 * El feed de videos desde el QR de una mesa (ficha feed-de-videos): lo mismo que `/m/{org}/{sucursal}/videos`, pero sin perder la mesa,
 * así el comensal sigue pudiendo llamar al mozo o pedir la cuenta. Misma resolución, mismos estados y mismo 404 que `/t/{token}`; el
 * token vive en la URL, así que no se indexa ni envía el *referrer*. El ticket de visita se emite en cada carga, como en la carta.
 */
export async function generateMetadata({ params, searchParams }: PageProps<"/t/[token]/videos">): Promise<Metadata> {
  const { token } = await params;
  const query = await searchParams;
  const table = await resolveTable(token);
  const base = { robots: { index: false, follow: false }, referrer: "no-referrer" } as const;
  if (!table) return { ...base, title: TEXTOS.es.notFoundTitle };
  if (table.status !== "available") return { ...base, title: TEXTOS[await requestLangForNotice(query)].unavailableTitle(table.orgName) };
  const result = await getPublicMenu(table.orgSlug, table.branchSlug);
  const lang = result?.kind === "menu" ? await requestLang(query, result.menu.languages) : "es";
  return { ...base, title: TEXTOS[lang].feed.pageTitle(table.orgName) };
}

export default async function TableVideosPage({ params, searchParams }: PageProps<"/t/[token]/videos">) {
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
  const backHref = `/t/${token}${typeof query.lang === "string" ? `?lang=${encodeURIComponent(query.lang)}` : ""}`;
  // Los botones solo existen si la base informa que se puede llamar (plan, cuenta al día, mesa activa y no silenciada).
  const callBar = table.callsEnabled ? <CallBar token={token} ticket={issueVisitTicket(token)} ttlMs={VISIT_TTL_MS} lang={lang} /> : undefined;
  return <FeedScreen menu={menu} lang={lang} backHref={backHref} callBar={callBar} />;
}
