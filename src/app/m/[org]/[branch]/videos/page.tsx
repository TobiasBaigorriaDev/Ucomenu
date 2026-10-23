import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { FeedScreen } from "@/components/menu/feed-screen";
import { MenuUnavailable } from "@/components/menu/menu-unavailable";
import { localizedMenu, requestLang, requestLangForNotice } from "@/lib/idiomas/pedido";
import { TEXTOS } from "@/lib/idiomas/textos";
import { getPublicMenu } from "@/lib/public-menu";
import { videosHref } from "@/lib/videos/feed";

/**
 * Feed de videos de una sucursal (ficha feed-de-videos, ADR 0031). Resuelve la organización y la sucursal igual que la carta
 * (mismos alias, mismo «no disponible» si la cuenta está suspendida o la sucursal desactivada, mismo 404), y lee los videos EN VIVO
 * con el cliente anónimo: la base solo entrega los publicados y listos de una organización con el feed vigente, así que un cambio
 * de plan, de mora o de baja los oculta en el acto. Es otra ruta a propósito: la carta no carga nada de esto.
 */
export async function generateMetadata({ params, searchParams }: PageProps<"/m/[org]/[branch]/videos">): Promise<Metadata> {
  const { org, branch } = await params;
  const query = await searchParams;
  const result = await getPublicMenu(org, branch);
  if (!result) return { title: TEXTOS.es.notFoundTitle };
  if (result.kind === "unavailable") {
    const t = TEXTOS[await requestLangForNotice(query)];
    return { title: t.unavailableTitle(result.organizationName), robots: { index: false } };
  }
  const t = TEXTOS[await requestLang(query, result.menu.languages)];
  return { title: t.feed.pageTitle(result.menu.organization.name) };
}

export default async function VideosPage({ params, searchParams }: PageProps<"/m/[org]/[branch]/videos">) {
  const { org, branch } = await params;
  const query = await searchParams;
  const result = await getPublicMenu(org, branch);
  if (!result) notFound();
  if (result.kind === "unavailable") {
    return <MenuUnavailable organizationName={result.organizationName} reason={result.reason} lang={await requestLangForNotice(query)} />;
  }
  const langQuery = typeof query.lang === "string" ? `?lang=${encodeURIComponent(query.lang)}` : "";
  if (result.menu.branch.slug !== branch) permanentRedirect(`${videosHref(org, result.menu.branch.slug)}${langQuery}`);

  const { menu, lang } = await localizedMenu(result.menu, query);
  const backHref = `/m/${menu.organization.slug}/${menu.branch.slug}${langQuery}`;
  return <FeedScreen menu={menu} lang={lang} backHref={backHref} />;
}
