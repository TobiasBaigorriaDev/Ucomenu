import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import { loadCarta } from "@/lib/carta/catalog";
import { loadProductOptions } from "@/lib/carta/options";
import { loadProductAvailability } from "@/lib/carta/availability";
import { imageUrl } from "@/lib/carta/images";
import { writeBlockNotice } from "@/lib/carta/messages";
import { priceToInput } from "@/lib/carta/price";
import { asUuid } from "@/lib/carta/validation";
import { createSessionClient } from "@/lib/supabase/server";
import { PhotoForm } from "../../photo-form";
import { ProductForm } from "../../product-form";
import { OpcionesSection } from "./opciones-section";
import { AvailabilityForms } from "../../availability-forms";

export const metadata: Metadata = { title: "Editar plato" };

export default async function EditProductPage({ params, searchParams }: PageProps<"/panel/[org]/carta/platos/[id]">) {
  const { org, id } = await params;
  const { nuevo } = await searchParams;
  const { membership } = await requireMembership(org, `/panel/${org}/carta/platos/${id}`);

  const productId = asUuid(id);
  if (!productId) notFound();

  const db = await createSessionClient();
  const [carta, ent] = await Promise.all([loadCarta(db, membership.org.id), getEntitlements(membership.org.id)]);

  // El plato se busca solo entre los de ESTE local: un id de otro local es un 404, igual que uno inexistente.
  const product = carta.flatMap((category) => category.products).find((p) => p.id === productId);
  if (!product) notFound();

  const [groups, availability] = await Promise.all([
    loadProductOptions(db, membership.org.id, product.id),
    loadProductAvailability(db, membership.org.id, product.id),
  ]);

  const canWrite = ent?.canWrite === true;
  const notice = writeBlockNotice(ent);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href={`/panel/${org}/carta`} className="inline-flex min-h-11 items-center text-base text-cobalt underline underline-offset-2">
        Volver a la carta
      </Link>
      <h1 className="font-display text-4xl leading-tight break-words">{product.name}</h1>
      {nuevo ? (
        <p role="status" className="mt-2 text-lg font-medium" data-testid="plato-creado">
          Plato creado. Si querés, sumale una foto acá abajo.
        </p>
      ) : null}
      {product.is_active ? null : <p className="mt-2 text-base text-muted">Este plato está inactivo: no se ve en la carta.</p>}
      {notice ? <p className="mt-3 max-w-prose text-base font-medium" data-testid="carta-bloqueada">{notice}</p> : null}

      <section aria-labelledby="datos" className="mt-8">
        <h2 id="datos" className="font-display text-2xl">
          Datos del plato
        </h2>
        <ProductForm
          orgSlug={membership.org.slug}
          productId={product.id}
          categories={carta.map(({ id: categoryId, name }) => ({ id: categoryId, name }))}
          initial={{
            name: product.name,
            description: product.description ?? "",
            price: priceToInput(product.price_cents),
            categoryId: product.category_id,
            dietaryTags: product.dietary_tags,
          }}
          canWrite={canWrite}
        />
      </section>

      <section aria-labelledby="foto" className="mt-12">
        <h2 id="foto" className="font-display text-2xl">
          Foto
        </h2>
        <PhotoForm
          orgSlug={membership.org.slug}
          productId={product.id}
          productName={product.name}
          currentUrl={imageUrl(product.image_path)}
          canWrite={canWrite}
        />
      </section>

      <OpcionesSection orgSlug={membership.org.slug} productId={product.id} groups={groups} canWrite={canWrite} />

      <AvailabilityForms orgSlug={membership.org.slug} productId={product.id} branches={availability} canWrite={canWrite} />

      <p className="mt-12">
        <Link
          href={`/panel/${membership.org.slug}/carta/platos/${product.id}/historial`}
          className="inline-flex min-h-11 items-center text-base text-cobalt underline underline-offset-2"
          data-testid="ver-historial-plato"
        >
          Ver el historial de precios de este plato
        </Link>
      </p>
    </main>
  );
}
