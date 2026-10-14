import { CategoryNav } from "@/components/menu/category-nav";
import { MenuHeader } from "@/components/menu/menu-header";
import { MenuSection } from "@/components/menu/menu-section";
import type { PublicMenu } from "@/lib/public-menu";

/** Carta pública de una sucursal. La comparten `/m/{org}/{sucursal}` y `/t/{token}` (esta con la etiqueta de la mesa). */
export function PublicMenuView({ menu, tableLabel }: { menu: PublicMenu; tableLabel?: string | null }) {
  const { sections } = menu;

  return (
    <>
      <MenuHeader organizationName={menu.organization.name} branchName={menu.branch.name} tableLabel={tableLabel} />
      {sections.length > 0 ? (
        <>
          <CategoryNav sections={sections} />
          <main className="mx-auto max-w-xl px-4 pb-8">
            {sections.map((section) => (
              <MenuSection key={section.category.id} section={section} />
            ))}
          </main>
        </>
      ) : (
        <main className="mx-auto max-w-xl px-4 py-16">
          <p className="font-display text-2xl">Esta carta todavía no tiene platos.</p>
          <p className="mt-3 text-muted">Volvé a mirar en unos minutos.</p>
        </main>
      )}
      <footer className="mx-auto max-w-xl border-t border-ink/15 px-4 py-8 text-sm leading-relaxed text-muted">
        La información de alérgenos de cada plato la declara el local. Ante cualquier duda, consultá al personal.
      </footer>
    </>
  );
}
