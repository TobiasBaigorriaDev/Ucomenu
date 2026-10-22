import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cartaFontClass } from "@/components/menu/carta-fonts";
import { MenuHeader } from "@/components/menu/menu-header";
import { MenuUnavailable } from "@/components/menu/menu-unavailable";
import { VideoFeed, type FeedVideo } from "@/components/menu/video-feed";
import { logoUrl } from "@/lib/identidad/logos";
import { paletteStyle } from "@/lib/identidad/palettes";
import { localizedMenu, requestLang, requestLangForNotice } from "@/lib/idiomas/pedido";
import { TEXTOS } from "@/lib/idiomas/textos";
import { getPublicMenu } from "@/lib/public-menu";
import { createPublicClient } from "@/lib/supabase/public-client";
import { loadPublishedVideos, videosHref } from "@/lib/videos/feed";

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
  const rows = await loadPublishedVideos(createPublicClient(), menu.organization.id);
  const backHref = `/m/${menu.organization.slug}/${menu.branch.slug}${langQuery}`;
  const t = TEXTOS[lang].feed;

  if (rows.length === 0) {
    return (
      <div lang={lang} className={`${cartaFontClass} carta`} style={paletteStyle(menu.organization.menu_palette)}>
        <MenuHeader organizationName={menu.organization.name} branchName={menu.branch.name} logo={logoUrl(menu.organization.logo_path)} lang={lang} />
        <main className="mx-auto max-w-3xl px-4 pb-16 text-center sm:px-6">
          <p className="font-display text-2xl" data-testid="feed-vacio">
            {t.emptyTitle}
          </p>
          <p className="mx-auto mt-3 max-w-[52ch] leading-relaxed text-muted">{t.emptyHint}</p>
          <Link href={backHref} className="mt-6 inline-flex min-h-11 items-center rounded-full border-[1.5px] border-ink px-5 text-base font-semibold hover:bg-ink/5">
            {t.back}
          </Link>
        </main>
      </div>
    );
  }

  // «Ver plato» solo si el plato sigue visible en ESTA sucursal: la carta ya filtró los ocultos, las categorías vacías y los ajustes.
  const dishes = new Map(menu.sections.flatMap((section) => section.products).map((product) => [product.id, product]));
  const videos: FeedVideo[] = rows.map((row) => {
    const dish = row.product_id ? dishes.get(row.product_id) : undefined;
    return {
      id: row.id,
      title: row.title,
      playbackId: row.mux_playback_id,
      dish: dish ? { name: dish.name, price_cents: dish.price_cents, description: dish.description } : null,
    };
  });

  return (
    <div lang={lang} className={cartaFontClass}>
      <VideoFeed videos={videos} lang={lang} backHref={backHref} />
    </div>
  );
}
