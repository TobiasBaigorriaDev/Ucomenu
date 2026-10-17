import type { Metadata } from "next";
import Link from "next/link";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import { loadCarta } from "@/lib/carta/catalog";
import { writeBlockNotice } from "@/lib/carta/messages";
import { asUuid } from "@/lib/carta/validation";
import { createSessionClient } from "@/lib/supabase/server";
import { ProductForm } from "../../product-form";

export const metadata: Metadata = { title: "Nuevo plato" };

export default async function NewProductPage({ params, searchParams }: PageProps<"/panel/[org]/carta/platos/nuevo">) {
  const { org } = await params;
  const { categoria } = await searchParams;
  const { membership } = await requireMembership(org, `/panel/${org}/carta/platos/nuevo`);
  const db = await createSessionClient();

  const [carta, ent] = await Promise.all([loadCarta(db, membership.org.id), getEntitlements(membership.org.id)]);
  const canWrite = ent?.canWrite === true;
  const notice = writeBlockNotice(ent);

  const categories = carta.map(({ id, name }) => ({ id, name }));
  const requested = asUuid(Array.isArray(categoria) ? categoria[0] : categoria);
  const initialCategory = categories.find((c) => c.id === requested)?.id ?? categories[0]?.id ?? "";

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <Link href={`/panel/${org}/carta`} className="inline-flex min-h-11 items-center text-base text-cobalt underline underline-offset-2">
        Volver a la carta
      </Link>
      <h1 className="font-display text-4xl leading-tight">Nuevo plato</h1>
      {notice ? <p className="mt-3 max-w-prose text-base font-medium" data-testid="carta-bloqueada">{notice}</p> : null}

      {categories.length === 0 ? (
        <p className="mt-6 max-w-prose text-lg text-muted">
          Primero creá una categoría en la carta. Después podés cargar platos acá.
        </p>
      ) : (
        <ProductForm
          orgSlug={membership.org.slug}
          categories={categories}
          initial={{ name: "", description: "", price: "", categoryId: initialCategory }}
          canWrite={canWrite}
        />
      )}
    </main>
  );
}
