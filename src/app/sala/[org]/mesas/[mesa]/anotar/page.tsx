import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { asUuid } from "@/lib/carta/validation";
import { loadAnotar } from "@/lib/sala/anotar-loader";
import { createSessionClient } from "@/lib/supabase/server";
import { canSeeBranch, readBranchAccess } from "@/lib/sucursales/vista";
import { AnotarScreen } from "./anotar-screen";

export const metadata: Metadata = { title: "Anotar pedido" };

export default async function SalaAnotarPage({ params, searchParams }: PageProps<"/sala/[org]/mesas/[mesa]/anotar">) {
  const { org, mesa } = await params;
  const openClose = (await searchParams).accion === "cerrar";
  const tableId = asUuid(mesa);
  if (!tableId) notFound();
  const { membership } = await requireMembership(org, `/sala/${org}/mesas/${tableId}/anotar`);

  const db = await createSessionClient();
  const data = await loadAnotar(db, membership.org.id, tableId);
  if (!data) notFound();
  // Una mesa de una sucursal que no tiene asignada no existe para esta persona (ficha personal-por-sucursal).
  if (!canSeeBranch((await readBranchAccess(db, membership.org.id)).assigned, data.table.branchId)) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-8 lg:py-10">
      <AnotarScreen key={`${tableId}:${openClose}`} slug={membership.org.slug} data={data} isOwner={membership.role === "owner"} openClose={openClose} />
    </main>
  );
}
