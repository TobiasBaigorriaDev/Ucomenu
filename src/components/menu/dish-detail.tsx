"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { imageUrl } from "@/lib/carta/images";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import type { MenuProduct } from "@/lib/menu";
import { formatArs } from "@/lib/money";
import { DietaryLabels } from "./dietary-labels";
import { DishOptions } from "./dish-options";

/** El diálogo nativo contiene el foco, admite Escape y devuelve el foco al plato al cerrar. */
export function DishDetail({ product, onClose, lang }: { product: MenuProduct; onClose: () => void; lang: Lang }) {
  const t = TEXTOS[lang];
  const ref = useRef<HTMLDialogElement>(null);
  // Sin `close()` en la limpieza: StrictMode (desarrollo) desmonta y remonta el efecto, y ese cierre disparaba `onClose`
  // y desmontaba el detalle recién abierto. Al desmontarse, el elemento sale del DOM y del top layer por sí solo.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const photo = imageUrl(product.image_path);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dish-detail-title"
      className="carta-dialog fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl bg-porcelain p-5 text-ink sm:p-8">
      <button type="button" onClick={() => ref.current?.close()} className="mb-4 inline-flex min-h-11 items-center px-2 font-medium text-[var(--carta-green)] underline underline-offset-4">
        {t.dish.back}
      </button>
      {photo ? <div className="relative mb-6 aspect-[4/3] overflow-hidden rounded-lg"><Image src={photo} alt={product.name} fill sizes="(min-width: 640px) 512px, 90vw" className="object-cover" /></div> : null}
      <h2 id="dish-detail-title" className="font-display text-3xl [overflow-wrap:anywhere]">{product.name}</h2>
      <p className="mt-2 text-xl font-semibold text-[var(--carta-terra)]">{formatArs(product.price_cents)}</p>
      {product.description ? <p className="mt-4 leading-relaxed [overflow-wrap:anywhere]">{product.description}</p> : null}
      <DietaryLabels tags={product.dietary_tags} lang={lang} />
      {product.is_available === false ? <p className="mt-3 font-semibold text-[var(--carta-terra)]">{t.dish.soldOutBranch}</p> : null}
      {product.option_groups?.length ? <div className="mt-6"><DishOptions productId={`detalle-${product.id}`} groups={product.option_groups} lang={lang} /></div> : null}
      <p className="mt-6 text-sm leading-relaxed text-muted">{t.detailAllergens}</p>
    </dialog>
  );
}
