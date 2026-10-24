import type { Metadata } from "next";
import Link from "next/link";
import { getEntitlements, requireOwner } from "@/lib/auth/session";
import { promocionesBlockNotice } from "@/lib/promociones/mensajes";
import { loadCatalog } from "@/lib/promociones/promociones";
import { createSessionClient } from "@/lib/supabase/server";
import { PromotionForm } from "../promotion-form";

export const metadata: Metadata = { title: "Nueva promoción" };

/** Solo Dueño. La base vuelve a exigir rol, plan y cuenta al día al guardar. */
export default async function NuevaPromocionPage({ params }: PageProps<"/panel/[org]/promociones/nueva">) {
  const { org } = await params;
  const { membership } = await requireOwner(org, `/panel/${org}/promociones/nueva`);
  const db = await createSessionClient();
  const [catalog, ent] = await Promise.all([loadCatalog(db, membership.org.id), getEntitlements(membership.org.id)]);
  const notice = promocionesBlockNotice(ent);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <Link href={`/panel/${membership.org.slug}/promociones`} className="inline-flex min-h-11 items-center text-base text-cobalt underline underline-offset-2">
        Volver a las promociones
      </Link>
      <h1 className="font-display text-4xl leading-tight">Nueva promoción</h1>
      {notice ? (
        <p className="mt-3 max-w-prose text-base font-medium" data-testid="promociones-bloqueadas">
          {notice}
        </p>
      ) : null}
      <PromotionForm orgSlug={membership.org.slug} catalog={catalog} canWrite={notice === null} />
    </main>
  );
}
