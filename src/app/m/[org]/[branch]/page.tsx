import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { MenuUnavailable } from "@/components/menu/menu-unavailable";
import { PublicMenuView } from "@/components/menu/public-menu-view";
import { localizedMenu, requestLang, requestLangForNotice } from "@/lib/idiomas/pedido";
import { TEXTOS } from "@/lib/idiomas/textos";
import { getPublicMenu } from "@/lib/public-menu";

export async function generateMetadata({ params, searchParams }: PageProps<"/m/[org]/[branch]">): Promise<Metadata> {
  const { org, branch } = await params;
  const query = await searchParams;
  const result = await getPublicMenu(org, branch);
  if (!result) return { title: TEXTOS.es.notFoundTitle };
  if (result.kind === "unavailable") {
    const t = TEXTOS[await requestLangForNotice(query)];
    return { title: t.unavailableTitle(result.organizationName), robots: { index: false } };
  }
  const t = TEXTOS[await requestLang(query, result.menu.languages)];
  return { title: t.cartaDe(result.menu.organization.name) };
}

export default async function PublicMenuPage({ params, searchParams }: PageProps<"/m/[org]/[branch]">) {
  const { org, branch } = await params;
  const query = await searchParams;
  const result = await getPublicMenu(org, branch);
  if (!result) notFound();
  if (result.kind === "unavailable") {
    return <MenuUnavailable organizationName={result.organizationName} reason={result.reason} lang={await requestLangForNotice(query)} />;
  }
  if (result.menu.branch.slug !== branch) {
    // La redirección conserva el idioma pedido.
    const lang = typeof query.lang === "string" ? `?lang=${encodeURIComponent(query.lang)}` : "";
    permanentRedirect(`/m/${org}/${result.menu.branch.slug}${lang}`);
  }

  const { menu, lang } = await localizedMenu(result.menu, query);
  return <PublicMenuView menu={menu} lang={lang} />;
}
