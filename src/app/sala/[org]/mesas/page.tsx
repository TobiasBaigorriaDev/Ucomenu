import type { Metadata } from "next";
import { requireMembership } from "@/lib/auth/session";
import { vapidPublicKey } from "@/lib/push/config";
import { loadMesas } from "@/lib/sala/mesas-loader";
import { createSessionClient } from "@/lib/supabase/server";
import { MesasBoard } from "./mesas-board";
import { ResetAllButton } from "./reset-all-button";

export const metadata: Metadata = { title: "Mesas" };

export default async function SalaMesasPage({ params }: PageProps<"/sala/[org]/mesas">) {
  const { org } = await params;
  const { membership } = await requireMembership(org, `/sala/${org}/mesas`);

  // Primera pintura con datos del servidor; después la pantalla sondea `/sala/{slug}/mesas/estado` cada ~3 s.
  const initial = await loadMesas(await createSessionClient(), membership.org.id);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Mesas</h1>
      <ResetAllButton slug={membership.org.slug} />
      <MesasBoard slug={membership.org.slug} initial={initial} isOwner={membership.role === "owner"} pushPublicKey={vapidPublicKey()} />
    </main>
  );
}
