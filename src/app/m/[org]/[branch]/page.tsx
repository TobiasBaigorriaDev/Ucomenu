import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MenuUnavailable } from "@/components/menu/menu-unavailable";
import { PublicMenuView } from "@/components/menu/public-menu-view";
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

  return <PublicMenuView menu={result.menu} />;
}
