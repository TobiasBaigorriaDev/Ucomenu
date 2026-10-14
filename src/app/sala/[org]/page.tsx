import type { Metadata } from "next";
import { requireMembership } from "@/lib/auth/session";
import { loadSala } from "@/lib/sala/pending";
import { createSessionClient } from "@/lib/supabase/server";
import { SalaBoard } from "./sala-board";

export const metadata: Metadata = { title: "Sala en vivo" };

export default async function SalaPage({ params }: PageProps<"/sala/[org]">) {
  const { org } = await params;
  const { membership } = await requireMembership(org, `/sala/${org}`);

  // Primera pintura con datos del servidor; después la pantalla sondea `/sala/{slug}/estado` cada ~3 s.
  const initial = await loadSala(await createSessionClient(), membership.org.id);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-4xl leading-tight">Sala en vivo</h1>
      <SalaBoard slug={membership.org.slug} initial={initial} isOwner={membership.role === "owner"} />
    </main>
  );
}
