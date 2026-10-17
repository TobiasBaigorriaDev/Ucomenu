import type { ReactNode } from "react";
import { LegalLinks } from "@/components/legal/legal-links";
import { MenuHeader } from "@/components/menu/menu-header";
import { MenuBrowser } from "@/components/menu/menu-browser";
import type { PublicMenu } from "@/lib/public-menu";
import { logoUrl } from "@/lib/identidad/logos";
import { paletteStyle } from "@/lib/identidad/palettes";

/**
 * Carta pública de una sucursal. La comparten `/m/{org}/{sucursal}` y `/t/{token}` (esta con la etiqueta de la mesa).
 * `callBar` es la barra fija del llamado: se monta dentro de `.carta` para heredar su paleta y el fondo crema llega
 * hasta el borde de abajo, con espacio reservado para que la barra no tape el pie.
 */
export function PublicMenuView({
  menu,
  tableLabel,
  callBar,
}: {
  menu: PublicMenu;
  tableLabel?: string | null;
  callBar?: ReactNode;
}) {
  const { sections } = menu;

  return (
    <div className={callBar ? "carta pb-40" : "carta"} style={paletteStyle(menu.organization.menu_palette)}>
      <MenuHeader organizationName={menu.organization.name} branchName={menu.branch.name} tableLabel={tableLabel} logo={logoUrl(menu.organization.logo_path)} />
      {sections.length > 0 ? (
        <MenuBrowser sections={sections} />
      ) : (
        <main className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6">
          <p className="font-display text-2xl">Esta carta todavía no tiene platos.</p>
          <p className="mt-3 text-muted">Volvé a mirar en unos minutos.</p>
        </main>
      )}
      <footer className="mx-auto max-w-3xl px-4 pb-12 text-center sm:px-6">
        <span aria-hidden="true" className="mb-6 flex justify-center gap-1.5">
          <i className="size-1.5 rotate-45 bg-[var(--carta-terra)]" />
          <i className="size-1.5 rotate-45 bg-[var(--carta-green)]" />
          <i className="size-1.5 rotate-45 bg-[var(--carta-blush)]" />
        </span>
        <p className="text-sm leading-relaxed text-muted">
          La información de alérgenos de cada plato la declara el local. Ante cualquier duda, consultá al personal.
        </p>
        <LegalLinks className="mt-4 flex justify-center text-muted" />
      </footer>
      {callBar}
    </div>
  );
}
