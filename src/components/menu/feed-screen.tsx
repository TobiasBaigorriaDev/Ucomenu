import Link from "next/link";
import type { ReactNode } from "react";
import { cartaFontClass } from "@/components/menu/carta-fonts";
import { MenuHeader } from "@/components/menu/menu-header";
import type { CommentAccess } from "@/components/menu/comments-sheet";
import type { LikeAccess } from "@/components/menu/like-button";
import { VideoFeed, type FeedVideo } from "@/components/menu/video-feed";
import { logoUrl } from "@/lib/identidad/logos";
import { paletteStyle } from "@/lib/identidad/palettes";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import type { PublicMenu } from "@/lib/public-menu";
import { createPublicClient } from "@/lib/supabase/public-client";
import { loadPublishedVideos } from "@/lib/videos/feed";

/**
 * La pantalla del feed, la misma desde el link directo de la carta (`/m/…/videos`) y desde la mesa (`/t/{token}/videos`). Lee los
 * videos EN VIVO con el cliente anónimo: la base solo entrega los publicados y listos de una organización con el feed vigente.
 * `callBar` es la barra de llamado del comensal (solo en la mesa): el feed le deja su lugar abajo y no la tapa. `likes` (token y ticket de
 * visita) convierte el corazón en un botón; sin él, el conteo se ve pero no se interactúa (ficha likes-del-feed). `comments` es lo mismo para el
 * formulario de comentarios; sin él se leen los aprobados pero no se escribe (ficha comentarios-del-feed).
 */
export async function FeedScreen({ menu, lang, backHref, callBar, likes, comments }: { menu: PublicMenu; lang: Lang; backHref: string; callBar?: ReactNode; likes?: LikeAccess; comments?: CommentAccess }) {
  const t = TEXTOS[lang].feed;
  const rows = await loadPublishedVideos(createPublicClient(), menu.organization.id);
  const palette = paletteStyle(menu.organization.menu_palette);

  if (rows.length === 0) {
    return (
      <div lang={lang} className={`${cartaFontClass} carta ${callBar ? "pb-40" : ""}`} style={palette}>
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
        {callBar}
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
      likeCount: row.like_count,
      commentCount: row.comment_count,
      dish: dish ? { name: dish.name, price_cents: dish.price_cents, description: dish.description } : null,
    };
  });

  return (
    <div lang={lang} className={`${cartaFontClass} carta`} style={palette}>
      <VideoFeed videos={videos} lang={lang} backHref={backHref} callBar={callBar} likes={likes ?? null} comments={comments ?? null} />
    </div>
  );
}
