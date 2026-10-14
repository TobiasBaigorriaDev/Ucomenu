import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryNav } from "@/components/menu/category-nav";
import { MenuHeader } from "@/components/menu/menu-header";
import { MenuSection } from "@/components/menu/menu-section";
import { MenuUnavailable } from "@/components/menu/menu-unavailable";
import { getPublicMenu } from "@/lib/public-menu";

export async function generateMetadata({ params }: PageProps<"/m/[org]/[branch]">): Promise<Metadata> {
  const { org, branch } = await params;
  const result = await getPublicMenu(org, branch);
  if (!result) return { title: "Carta no encontrada" };
  if (result.kind === "unavailable") {
    return { title: `${result.organizationName} · Carta no disponible`, robots: { index: false } };
  }
  return { title: `Carta de ${result.menu.organization.name}` };
}

export default async function PublicMenuPage({ params }: PageProps<"/m/[org]/[branch]">) {
  const { org, branch } = await params;
  const result = await getPublicMenu(org, branch);
  if (!result) notFound();
  if (result.kind === "unavailable") return <MenuUnavailable organizationName={result.organizationName} />;

  const { menu } = result;
  const { sections } = menu;

  return (
    <>
      <MenuHeader organizationName={menu.organization.name} branchName={menu.branch.name} />
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
