import Link from "next/link";
import type { ReactNode } from "react";
import { LegalLinks } from "@/components/legal/legal-links";
import { LanguageSwitcher } from "@/components/menu/language-switcher";
import { MenuHeader } from "@/components/menu/menu-header";
import { MenuBrowser } from "@/components/menu/menu-browser";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import type { PublicMenu } from "@/lib/public-menu";
import { logoUrl } from "@/lib/identidad/logos";
import { paletteStyle } from "@/lib/identidad/palettes";
import { themeStyle, THEMES } from "@/lib/identidad/temas";
import { videosHref } from "@/lib/videos/feed";
import { cartaFontClass } from "./carta-fonts";
import { TemaIcono } from "./tema-icono";

/**
 * Carta pública de una sucursal. La comparten `/m/{org}/{sucursal}` y `/t/{token}` (esta con la etiqueta de la mesa).
 * `callBar` es la barra fija del llamado: se monta dentro de `.carta` para heredar su paleta y el fondo crema llega
 * hasta el borde de abajo, con espacio reservado para que la barra no tape el pie. `menu.sections` ya viene en el idioma
 * `lang` (`localizeSections`); `menu.languages` son los que ofrece el local.
 */
export function PublicMenuView({
  menu,
  tableLabel,
  callBar,
  videosPath,
  lang,
}: {
  menu: PublicMenu;
  lang: Lang;
  tableLabel?: string | null;
  callBar?: ReactNode;
  /** Dónde está el feed desde esta entrada (en la mesa, bajo `/t/{token}` para no perderla); por defecto, el de la sucursal. */
  videosPath?: string;
}) {
  const { sections } = menu;
  const t = TEXTOS[lang];
  const theme = menu.organization.theme;

  return (
    <div lang={lang} data-layout={menu.organization.menu_layout} data-tema={theme ?? undefined} className={`${cartaFontClass} ${callBar ? "carta pb-40" : "carta"}`} style={{ ...paletteStyle(menu.organization.menu_palette), ...themeStyle(theme) }}>
      <LanguageSwitcher languages={menu.languages} current={lang} />
      <MenuHeader organizationName={menu.organization.name} branchName={menu.branch.name} tableLabel={tableLabel} logo={logoUrl(menu.organization.logo_path)} lang={lang} theme={theme} />
      {menu.hasVideos && !callBar ? (
        // Solo un enlace, SIN precarga: la carta no carga nada del feed (ni video, ni `hls.js`) hasta que se entra (ficha feed-de-videos).
        // Con la barra de llamado (mesa), el acceso es su tercera celda y este enlace no se dibuja.
        <div className="mx-auto max-w-3xl px-4 pb-6 sm:px-6">
          <Link
            href={`${videosPath ?? videosHref(menu.organization.slug, menu.branch.slug)}?lang=${lang}`}
            prefetch={false}
            data-testid="ver-videos"
            className="inline-flex min-h-11 items-center gap-2.5 rounded-full border-[1.5px] border-ink px-5 text-base font-semibold hover:bg-ink/5"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 text-[var(--carta-terra)]" fill="currentColor">
              <path d="M7 4.5v15L19.5 12 7 4.5Z" />
            </svg>
            {t.feed.link}
          </Link>
        </div>
      ) : null}
      {sections.length > 0 ? (
        <MenuBrowser sections={sections} branchId={menu.branch.id} lang={lang} layout={menu.organization.menu_layout} />
      ) : (
        <main className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6">
          <p className="font-display text-2xl">{t.emptyTitle}</p>
          <p className="mt-3 text-muted">{t.emptyHint}</p>
        </main>
      )}
      <footer className="mx-auto max-w-3xl px-4 pb-12 text-center sm:px-6">
        {theme ? (
          // Con tema, los tres rombos del pie pasan a ser los motivos de la fecha.
          <span aria-hidden="true" className="mb-6 flex justify-center gap-3 text-[var(--carta-terra)]">
            {[0, 1, 2].map((i) => <TemaIcono key={i} name={THEMES[theme].motifs[i % THEMES[theme].motifs.length]} className="size-5" />)}
          </span>
        ) : (
          <span aria-hidden="true" className="mb-6 flex justify-center gap-1.5">
            <i className="size-1.5 rotate-45 bg-[var(--carta-terra)]" />
            <i className="size-1.5 rotate-45 bg-[var(--carta-green)]" />
            <i className="size-1.5 rotate-45 bg-[var(--carta-blush)]" />
          </span>
        )}
        <p className="text-sm leading-relaxed text-muted">
          {t.footerAllergens}
        </p>
        <LegalLinks className="mt-4 flex justify-center text-muted" lang={lang} />
        <p className="mt-5 text-sm text-muted">{t.madeWith}</p>
      </footer>
      {callBar}
    </div>
  );
}
