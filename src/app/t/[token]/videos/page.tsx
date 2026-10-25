import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FeedScreen } from "@/components/menu/feed-screen";
import { MenuUnavailable } from "@/components/menu/menu-unavailable";
import { localizedMenu, requestLang, requestLangForNotice } from "@/lib/idiomas/pedido";
import { TEXTOS } from "@/lib/idiomas/textos";
import { issueVisitTicket } from "@/lib/llamados/visit-ticket";
import { visitInTurn } from "@/lib/llamados/visit-turn";
import { leerVisitaDeLaUrl, urlConVisita } from "@/lib/llamados/visita";
import { resolveTable } from "@/lib/mesas/public-table";
import { getPublicMenu } from "@/lib/public-menu";
import { createAdminClient } from "@/lib/supabase/admin";
import { CallBar } from "../call-bar";

/**
 * El feed de videos desde el QR de una mesa (ficha feed-de-videos): lo mismo que `/m/{org}/{sucursal}/videos`, pero sin perder la mesa,
 * así el comensal sigue pudiendo llamar al mozo o pedir la cuenta. Misma resolución, mismos estados y mismo 404 que `/t/{token}`; el
 * token vive en la URL, así que no se indexa ni envía el *referrer*. La visita vive en la URL (`?v=`), como en la carta: escanear la emite, recargar la reutiliza (ADR 0044).
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
  // Una sola visita para el llamado y para los likes, tomada de la URL (`?v=`): sin ella es un escaneo y se emite y redirige; con ella se
  // reutiliza. Solo hace falta si la mesa ofrece llamados, likes o comentarios. `redirect` va fuera de todo `try`.
  const usaVisita = table.callsEnabled || table.likesEnabled || table.commentsEnabled;
  let visita: { ticket: string; ttlMs: number; expired: boolean; v: string } | null = null;
  if (usaVisita) {
    const leida = leerVisitaDeLaUrl(token, query.v);
    if (leida.kind === "nueva") redirect(urlConVisita(`/t/${token}/videos`, query, issueVisitTicket(token)));
    visita =
      leida.kind === "propia"
        ? { ticket: leida.ticket, ttlMs: leida.ttlMs, expired: !(await visitInTurn(createAdminClient, token, leida.issuedAt)), v: leida.ticket }
        : { ticket: "", ttlMs: 0, expired: true, v: leida.raw };
  }

  const result = await getPublicMenu(table.orgSlug, table.branchSlug);
  if (!result) notFound();
  if (result.kind === "unavailable") return <MenuUnavailable organizationName={result.organizationName} reason={result.reason} lang={await requestLangForNotice(query)} />;

  const { menu, lang } = await localizedMenu(result.menu, query);
  // Volver a la carta conserva la visita (y el idioma): tampoco emite una nueva.
  const backHref = visita ? urlConVisita(`/t/${token}`, query, visita.v) : `/t/${token}${typeof query.lang === "string" ? `?lang=${encodeURIComponent(query.lang)}` : ""}`;
  // Los botones solo existen si la base informa que se puede (llamar: plan, cuenta al día, mesa activa y no silenciada; likes y comentarios:
  // plan con feed, cuenta que escribe, mesa y sucursal activas). Con la visita terminada, los llamados piden escanear de nuevo.
  const ticket = visita?.ticket ?? "";
  const callBar = table.callsEnabled && visita ? <CallBar token={token} ticket={ticket} ttlMs={visita.ttlMs} expired={visita.expired} lang={lang} reviewUrl={menu.branch.reviewUrl} reviewKey={menu.branch.id} /> : undefined;
  return <FeedScreen menu={menu} lang={lang} backHref={backHref} callBar={callBar} likes={table.likesEnabled ? { token, ticket } : undefined} comments={table.commentsEnabled ? { token, ticket } : undefined} />;
}
