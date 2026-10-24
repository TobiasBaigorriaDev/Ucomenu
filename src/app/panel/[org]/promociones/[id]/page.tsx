import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntitlements, requireOwner } from "@/lib/auth/session";
import { asUuid } from "@/lib/carta/validation";
import { promocionesBlockNotice } from "@/lib/promociones/mensajes";
import { loadCatalog, loadPromotions } from "@/lib/promociones/promociones";
import { createSessionClient } from "@/lib/supabase/server";
import { PromotionForm } from "../promotion-form";

export const metadata: Metadata = { title: "Editar promoción" };

/** Solo Dueño. Una promoción que no existe (o es de otro local) da 404. */
export default async function EditarPromocionPage({ params }: PageProps<"/panel/[org]/promociones/[id]">) {
  const { org, id: rawId } = await params;
  const { membership } = await requireOwner(org, `/panel/${org}/promociones/${rawId}`);
  const id = asUuid(rawId);
  if (!id) notFound();
  const db = await createSessionClient();
  const [promotions, catalog, ent] = await Promise.all([loadPromotions(db, membership.org.id), loadCatalog(db, membership.org.id), getEntitlements(membership.org.id)]);
  const promotion = promotions.find((p) => p.id === id);
  if (!promotion) notFound();
  const notice = promocionesBlockNotice(ent);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <Link href={`/panel/${membership.org.slug}/promociones`} className="inline-flex min-h-11 items-center text-base text-cobalt underline underline-offset-2">
        Volver a las promociones
      </Link>
      <h1 className="font-display text-4xl leading-tight break-words">Editar «{promotion.name}»</h1>
      {notice ? (
        <p className="mt-3 max-w-prose text-base font-medium" data-testid="promociones-bloqueadas">
          {notice}
        </p>
      ) : null}
      <PromotionForm orgSlug={membership.org.slug} catalog={catalog} initial={promotion} canWrite={notice === null} />
    </main>
  );
}
