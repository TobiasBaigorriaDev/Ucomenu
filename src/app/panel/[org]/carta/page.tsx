import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import { toneFor } from "@/components/menu/tones";
import { loadCarta } from "@/lib/carta/catalog";
import { imageUrl } from "@/lib/carta/images";
import { writeBlockNotice } from "@/lib/carta/messages";
import { formatArs } from "@/lib/money";
import { createSessionClient } from "@/lib/supabase/server";
import { CreateCategoryForm, RenameCategoryForm } from "./category-forms";
import { ItemControls } from "./item-controls";

export const metadata: Metadata = { title: "Carta" };

const badgeClass = "inline-flex items-center rounded-full border border-ink/25 bg-sand px-2.5 py-0.5 text-sm text-ink";
const linkButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-ink/40 px-4 py-2 text-base font-medium text-ink";

export default async function CartaPage({ params }: PageProps<"/panel/[org]/carta">) {
  const { org } = await params;
  const { membership } = await requireMembership(org, `/panel/${org}/carta`);
  const db = await createSessionClient();

  const [carta, ent] = await Promise.all([loadCarta(db, membership.org.id), getEntitlements(membership.org.id)]);
  // Si no se pudo leer el estado de la cuenta, falla cerrado: se muestra pero no se edita.
  const canWrite = ent?.canWrite === true;
  const notice = writeBlockNotice(ent);

  const activeBefore = carta.map((_, index) => carta.slice(0, index).filter((category) => category.is_active).length);
  const used = ent?.usage.active_products ?? 0;
  const limit = ent?.limits.active_products;
  const atLimit = typeof limit === "number" && used >= limit;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Carta</h1>

      {ent ? (
        <p className="mt-2 text-lg" data-testid="platos-activos">
          Platos activos:{" "}
          <span className="font-medium tabular-nums">{typeof limit === "number" ? `${used} de ${limit}` : `${used}, sin tope`}</span>
        </p>
      ) : (
        <p className="mt-2 text-base text-muted">No pudimos comprobar el estado de la cuenta, así que la edición está desactivada.</p>
      )}
      {atLimit ? (
        <p className="mt-1 max-w-prose text-base text-muted" data-testid="aviso-tope">
          Llegaste al tope de platos activos de tu plan. Para sumar otro, desactivá uno.
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 max-w-prose text-base font-medium" data-testid="carta-bloqueada">
          {notice}
        </p>
      ) : null}

      <p className="mt-3 flex flex-wrap gap-2">
        <Link href={`/panel/${membership.org.slug}/historial-de-precios`} className={linkButtonClass} data-testid="ver-historial-precios">
          Historial de precios
        </Link>
        <Link href={`/panel/${membership.org.slug}/carta/traducciones`} className={linkButtonClass} data-testid="ver-traducciones">
          Traducciones
        </Link>
      </p>

      <section aria-labelledby="nueva-categoria" className="panel-cell mt-8">
        <h2 id="nueva-categoria" className="font-display text-2xl">
          Nueva categoría
        </h2>
        <CreateCategoryForm orgSlug={membership.org.slug} canWrite={canWrite} />
      </section>

      {carta.length === 0 ? (
        <p className="mt-10 max-w-prose text-lg text-muted" data-testid="carta-vacia">
          Todavía no hay categorías. Creá la primera para empezar a cargar platos.
        </p>
      ) : null}

      {carta.map((category, categoryIndex) => (
        <section
          key={category.id}
          aria-labelledby={`cat-${category.id}`}
          className="panel-cell mt-6"
          data-testid="categoria"
          data-name={category.name}
        >
          {/* La banda lleva el tono que esa categoría tiene en la carta pública (solo cuentan las activas). */}
          <div
            className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-2xl px-4 py-3 ${
              category.is_active ? toneFor(activeBefore[categoryIndex]) : "bg-sand text-ink ring-1 ring-inset ring-ink/15"
            }`}
          >
            <h2 id={`cat-${category.id}`} className="font-display text-3xl leading-tight break-words">
              {category.name}
            </h2>
            {category.is_active ? null : <span className={badgeClass}>Inactiva</span>}
          </div>
          {category.is_active ? null : (
            <p className="mt-2 max-w-prose text-sm text-muted">No se ve en la carta, ni sus platos, hasta que la actives.</p>
          )}

          <div className="mt-4 flex flex-wrap items-start gap-2">
            <ItemControls
              orgSlug={membership.org.slug}
              kind="category"
              id={category.id}
              name={category.name}
              isActive={category.is_active}
              canMoveUp={categoryIndex > 0}
              canMoveDown={categoryIndex < carta.length - 1}
              canWrite={canWrite}
            />
            <RenameCategoryForm orgSlug={membership.org.slug} id={category.id} name={category.name} canWrite={canWrite} />
          </div>

          {category.products.length > 0 ? (
            <ul className="mt-5 panel-list">
              {category.products.map((product, productIndex) => {
                const photo = imageUrl(product.image_path);
                return (
                  <li key={product.id} className="border-b border-ink/15 py-4 lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-center lg:gap-6" data-testid="plato" data-name={product.name}>
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {photo ? (
                        <Image
                          src={photo}
                          alt=""
                          width={96}
                          height={96}
                          unoptimized
                          className="size-16 shrink-0 rounded-2xl border border-ink/15 object-cover"
                        />
                      ) : (
                        <span
                          aria-hidden
                          data-initial={product.name.trim().charAt(0).toUpperCase()}
                          className="font-display flex size-16 shrink-0 items-center justify-center rounded-2xl bg-sand text-3xl text-brand ring-1 ring-inset ring-ink/15 after:content-[attr(data-initial)]"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-3 text-lg">
                          <span className="min-w-0 font-medium break-words">{product.name}</span>
                          <span aria-hidden className="leader" />
                          <span className="shrink-0 tabular-nums">{formatArs(product.price_cents)}</span>
                        </div>
                        {product.is_active ? null : <span className={`${badgeClass} mt-1`}>Inactivo</span>}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-start gap-2 lg:mt-0 lg:justify-end">
                      <ItemControls
                        orgSlug={membership.org.slug}
                        kind="product"
                        id={product.id}
                        name={product.name}
                        isActive={product.is_active}
                        canMoveUp={productIndex > 0}
                        canMoveDown={productIndex < category.products.length - 1}
                        canWrite={canWrite}
                      />
                      <Link
                        href={`/panel/${membership.org.slug}/carta/platos/${product.id}`}
                        className={linkButtonClass}
                        aria-label={`Editar ${product.name}`}
                      >
                        Editar
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-4 text-base text-muted">Esta categoría todavía no tiene platos.</p>
          )}

          <div className="mt-4">
            <Link
              href={`/panel/${membership.org.slug}/carta/platos/nuevo?categoria=${category.id}`}
              className={linkButtonClass}
              aria-label={`Agregar un plato a ${category.name}`}
            >
              Agregar plato
            </Link>
          </div>
        </section>
      ))}
    </main>
  );
}
