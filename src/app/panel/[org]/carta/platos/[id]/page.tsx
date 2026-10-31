import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import { parsePending, type AltaPending } from "@/lib/carta/alta-campos";
import { loadCarta } from "@/lib/carta/catalog";
import { loadProductOptions } from "@/lib/carta/options";
import { loadProductAvailability } from "@/lib/carta/availability";
import { imageUrl } from "@/lib/carta/images";
import { writeBlockNotice } from "@/lib/carta/messages";
import { priceToInput } from "@/lib/carta/price";
import { asUuid } from "@/lib/carta/validation";
import { createSessionClient } from "@/lib/supabase/server";
import { DeleteProductForm } from "../../delete-forms";
import { PhotoForm } from "../../photo-form";
import { ProductForm } from "../../product-form";
import { OpcionesSection } from "./opciones-section";
import { AvailabilityForms } from "../../availability-forms";
import { EditorTabs } from "./editor-tabs";

export const metadata: Metadata = { title: "Editar plato" };

const PENDING_LABEL: Record<AltaPending, string> = { foto: "la foto", opciones: "alguna variante u opción", precios: "algún precio por sucursal" };
const listFormat = new Intl.ListFormat("es-AR", { style: "long", type: "conjunction" });

export default async function EditProductPage({ params, searchParams }: PageProps<"/panel/[org]/carta/platos/[id]">) {
  const { org, id } = await params;
  const { nuevo, pendiente } = await searchParams;
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
  // Piezas del alta unificada que no se pudieron guardar (`?pendiente=`): el plato existe, se completa desde acá.
  const faltante = parsePending(pendiente);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8 lg:px-10 lg:py-10">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <Link href={`/panel/${org}/carta`} className="inline-flex min-h-11 items-center text-base text-cobalt underline underline-offset-2">
          Volver a la carta
        </Link>
        <Link
          href={`/panel/${membership.org.slug}/carta/platos/${product.id}/historial`}
          className="inline-flex min-h-11 items-center text-base text-cobalt underline underline-offset-2"
          data-testid="ver-historial-plato"
        >
          Ver el historial de precios de este plato
        </Link>
      </div>
      <h1 className="font-display text-4xl leading-tight break-words">{product.name}</h1>
      {nuevo ? (
        <p role="status" className="mt-2 text-lg font-medium" data-testid="plato-creado">
          Plato creado.{faltante.length === 0 ? " Si querés, sumale lo que falte desde acá." : ""}
        </p>
      ) : null}
      {nuevo && faltante.length > 0 ? (
        <p role="alert" className="mt-2 max-w-prose text-base font-medium" data-testid="alta-pendiente">
          El plato quedó creado, pero no se pudo guardar {listFormat.format(faltante.map((piece) => PENDING_LABEL[piece]))}. Revisalo acá abajo y cargalo de nuevo.
        </p>
      ) : null}
      {product.is_active ? null : <p className="mt-2 text-base text-muted">Este plato está inactivo: no se ve en la carta.</p>}
      {notice ? <p className="mt-3 max-w-prose text-base font-medium" data-testid="carta-bloqueada">{notice}</p> : null}

      <EditorTabs
        general={
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <section aria-labelledby="datos" className="panel-cell min-w-0">
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

            <section aria-labelledby="foto" className="panel-cell min-w-0">
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
          </div>
        }
        opciones={
          <OpcionesSection orgSlug={membership.org.slug} productId={product.id} groups={groups} canWrite={canWrite} hasDietaryTags={product.dietary_tags.length > 0} />
        }
        sucursales={
          <AvailabilityForms
            orgSlug={membership.org.slug}
            productId={product.id}
            branches={availability}
            basePriceCents={product.price_cents}
            canWrite={canWrite}
          />
        }
      />

      <section aria-labelledby="borrar" className="panel-cell mt-6">
        <h2 id="borrar" className="font-display text-2xl">
          Borrar
        </h2>
        <div className="mt-3">
          <DeleteProductForm orgSlug={membership.org.slug} id={product.id} name={product.name} canWrite={canWrite} />
        </div>
      </section>

    </main>
  );
}
