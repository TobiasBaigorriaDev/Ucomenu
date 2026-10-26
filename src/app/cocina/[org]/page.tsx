import type { Metadata } from "next";
import { requireKitchen } from "@/lib/auth/session";
import { loadKitchen } from "@/lib/cocina/loader";
import { createSessionClient } from "@/lib/supabase/server";
import { KitchenBoard } from "./kitchen-board";

export const metadata: Metadata = { title: "Cocina" };

export default async function CocinaPage({ params }: PageProps<"/cocina/[org]">) {
  const { org } = await params;
  const { membership } = await requireKitchen(org, `/cocina/${org}`);

  // Primera pintura con datos del servidor; después la pantalla sondea `/cocina/{slug}/estado` cada ~3 s.
  const initial = await loadKitchen(await createSessionClient(), membership.org.id);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Pedidos en cocina</h1>
      <KitchenBoard slug={membership.org.slug} initial={initial} />
    </main>
  );
}
