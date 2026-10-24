import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { asUuid } from "@/lib/carta/validation";
import { loadAnotar } from "@/lib/sala/anotar-loader";
import { createSessionClient } from "@/lib/supabase/server";
import { AnotarScreen } from "./anotar-screen";

export const metadata: Metadata = { title: "Anotar pedido" };

export default async function SalaAnotarPage({ params }: PageProps<"/sala/[org]/mesas/[mesa]/anotar">) {
  const { org, mesa } = await params;
  const tableId = asUuid(mesa);
  if (!tableId) notFound();
  const { membership } = await requireMembership(org, `/sala/${org}/mesas/${tableId}/anotar`);

  const data = await loadAnotar(await createSessionClient(), membership.org.id, tableId);
  if (!data) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-8 lg:py-10">
      <AnotarScreen slug={membership.org.slug} data={data} isOwner={membership.role === "owner"} />
    </main>
  );
}
