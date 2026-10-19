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
import { cartaFontClass } from "./carta-fonts";

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
  lang,
}: {
  menu: PublicMenu;
  lang: Lang;
  tableLabel?: string | null;
  callBar?: ReactNode;
}) {
  const { sections } = menu;
  const t = TEXTOS[lang];

  return (
    <div lang={lang} className={`${cartaFontClass} ${callBar ? "carta pb-40" : "carta"}`} style={paletteStyle(menu.organization.menu_palette)}>
      <LanguageSwitcher languages={menu.languages} current={lang} />
      <MenuHeader organizationName={menu.organization.name} branchName={menu.branch.name} tableLabel={tableLabel} logo={logoUrl(menu.organization.logo_path)} lang={lang} />
      {sections.length > 0 ? (
        <MenuBrowser sections={sections} branchId={menu.branch.id} lang={lang} />
      ) : (
        <main className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6">
          <p className="font-display text-2xl">{t.emptyTitle}</p>
          <p className="mt-3 text-muted">{t.emptyHint}</p>
        </main>
      )}
      <footer className="mx-auto max-w-3xl px-4 pb-12 text-center sm:px-6">
        <span aria-hidden="true" className="mb-6 flex justify-center gap-1.5">
          <i className="size-1.5 rotate-45 bg-[var(--carta-terra)]" />
          <i className="size-1.5 rotate-45 bg-[var(--carta-green)]" />
          <i className="size-1.5 rotate-45 bg-[var(--carta-blush)]" />
        </span>
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
