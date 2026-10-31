import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { MenuUnavailable } from "@/components/menu/menu-unavailable";
import { PublicMenuView } from "@/components/menu/public-menu-view";
import { CallBar } from "./call-bar";
import { localizedMenu, requestLang, requestLangForNotice } from "@/lib/idiomas/pedido";
import { TEXTOS } from "@/lib/idiomas/textos";
import { issueVisitTicket } from "@/lib/llamados/visit-ticket";
import { visitInTurn } from "@/lib/llamados/visit-turn";
import { conParametro, leerVisitaDeLaUrl, urlConVisita } from "@/lib/llamados/visita";
import { resolveTable } from "@/lib/mesas/public-table";
import { getPublicMenu } from "@/lib/public-menu";
import { createAdminClient } from "@/lib/supabase/admin";

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

  // La visita vive en la URL (`?v=`, ADR 0044): escanear (sin `v`) emite una visita nueva y redirige; recargar REUTILIZA la misma, así que
  // tras un cobro o un «Reiniciar QR» una pestaña vieja ve «escaneá de nuevo» en vez de recibir un ticket nuevo con los botones. Solo hace
  // falta cuando la mesa ofrece llamados. `redirect` va fuera de todo `try`: lanza para cortar el render.
  let visita: { ticket: string; ttlMs: number; expired: boolean; v: string } | null = null;
  if (table.callsEnabled) {
    const leida = leerVisitaDeLaUrl(token, query.v);
    if (leida.kind === "nueva") redirect(urlConVisita(`/t/${token}`, query, issueVisitTicket(token)));
    visita =
      leida.kind === "propia"
        ? { ticket: leida.ticket, ttlMs: leida.ttlMs, expired: !(await visitInTurn(createAdminClient, token, leida.issuedAt)), v: leida.ticket }
        : { ticket: "", ttlMs: 0, expired: true, v: leida.raw };
  }

  const result = await getPublicMenu(table.orgSlug, table.branchSlug);
  if (!result) notFound();
  if (result.kind === "unavailable") return <MenuUnavailable organizationName={result.organizationName} reason={result.reason} lang={await requestLangForNotice(query)} />;

  const { menu, lang } = await localizedMenu(result.menu, query);

  // Una mesa desactivada se comporta como el link directo: la carta, sin la etiqueta de mesa ni los botones de llamado.
  // Los botones solo existen si la base informa que se puede llamar (plan, cuenta al día, mesa activa y no silenciada);
  // aunque alguien fuerce la acción, la función de base responde «no disponible». El ticket de visita (que se emite en cada
  // carga de la página, nunca desde caché) lo valida la acción: una pestaña vieja deja de poder avisar (ticket-de-visita).
  // El acceso a los videos vive en el dock cuando lo hay; sin dock (mesa sin llamados) queda el enlace suelto de la carta.
  // El feed de videos recibe la MISMA visita (`v`): recargar allá o volver acá tampoco emite otra.
  const videosPath = visita ? conParametro(`/t/${token}/videos`, "v", visita.v) : `/t/${token}/videos`;
  const videosHref = menu.hasVideos ? conParametro(videosPath, "lang", lang) : undefined;
  return visita ? (
    <PublicMenuView menu={menu} lang={lang} videosPath={videosPath} visit={visita.v} tableLabel={table.tableLabel} callBar={<CallBar token={token} ticket={visita.ticket} ttlMs={visita.ttlMs} expired={visita.expired} lang={lang} videosHref={videosHref} reviewUrl={menu.branch.reviewUrl} reviewKey={menu.branch.id} />} />
  ) : (
    <PublicMenuView menu={menu} lang={lang} videosPath={videosPath} tableLabel={table.tableActive ? table.tableLabel : null} />
  );
}
