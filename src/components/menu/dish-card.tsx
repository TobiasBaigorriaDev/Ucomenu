"use client";

import Image from "next/image";
import { useState } from "react";
import { imageUrl } from "@/lib/carta/images";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import type { MenuProduct } from "@/lib/menu";
import { DishPrice, PromoNote } from "./dish-price";
import { DietaryLabels } from "./dietary-labels";
import { DishOptions } from "./dish-options";

/** Cómo ocupa la grilla: destacada (2 columnas), cola impar (2 en el celular, 1 en escritorio), normal (1) o única (estilo minimal: una columna, foto grande). */
export type CardSpan = "featured" | "tail" | "normal" | "single";
/** Las formas de foto: las de las cards y la del estilo «afiche» (recorte apaisado a todo el ancho de la fila, sin esquinas). */
type PhotoShape = CardSpan | "poster";

const SPAN_CLASS: Record<CardSpan, string> = {
  // En escritorio ocupa dos filas y las dos cards siguientes se apilan a su lado (siempre hay al menos dos: ver `cardSpans`).
  featured: "col-span-2 md:row-span-2",
  tail: "col-span-2 md:col-span-1",
  normal: "",
  single: "",
};
const PHOTO_RATIO: Record<PhotoShape, string> = {
  featured: "aspect-[16/10] md:aspect-auto md:min-h-64 md:flex-1",
  tail: "aspect-[16/10] md:aspect-[4/3]",
  normal: "aspect-[4/3]",
  single: "aspect-[3/2]",
  poster: "aspect-[3/2] sm:aspect-[2/1]",
};
/** El ancho que ocupa la foto en pantalla, para que `/_next/image` pida solo lo necesario (ver next.config.ts). */
const PHOTO_SIZES: Record<PhotoShape, string> = {
  featured: "(min-width: 768px) 66vw, 100vw",
  tail: "(min-width: 768px) 33vw, 100vw",
  normal: "(min-width: 768px) 33vw, 50vw",
  single: "(min-width: 672px) 42rem, 100vw",
  poster: "(min-width: 768px) 45rem, 100vw",
};

/**
 * Foto de la card. Si no carga (archivo borrado, Storage caído) muestra un marcador neutro con un cubierto: no finge ser
 * una foto. Solo se confía en `onError`: una imagen diferida (`lazy`) que aún no empezó a cargar figura como `complete` con
 * ancho 0, así que mirar ese estado al hidratar la marcaba como rota por error. El tamaño lo fija la proporción, así que la grilla no salta al cargar. Ver ficha rendimiento-carta-publica.
 */
export function CardPhoto({ src, name, span, lang, desktopSpan = 1 }: { src: string; name: string; span: PhotoShape; lang: Lang; desktopSpan?: 1 | 2 | 3 }) {
  const [failed, setFailed] = useState(false);
  const ratio = desktopSpan > 1 && span === "tail" ? "aspect-[16/10] md:aspect-[16/7]"
    : desktopSpan > 1 && span === "normal" ? "aspect-[4/3] md:aspect-[16/7]"
    : PHOTO_RATIO[span];
  const frame = `relative w-full overflow-hidden bg-[var(--carta-sand)] ${ratio}`;

  if (failed) {
    return (
      <div aria-hidden="true" className={`${frame} grid place-items-center text-muted/60`}>
        <svg viewBox="0 0 24 24" className="size-10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10" />
          <path d="M17 21V3c-2 1.5-3 4-3 7 0 2 1 3 3 3" />
        </svg>
      </div>
    );
  }

  return (
    <div className={frame}>
      <Image
        src={src}
        alt={TEXTOS[lang].dish.photoAlt(name)}
        width={span === "single" || span === "poster" ? 768 : span === "featured" ? 640 : 384}
        height={span === "single" || span === "poster" ? 512 : span === "featured" ? 400 : 288}
        sizes={desktopSpan === 3 ? "(min-width: 768px) 80vw, 100vw" : desktopSpan === 2 ? "(min-width: 768px) 66vw, 100vw" : PHOTO_SIZES[span]}
        loading="lazy"
        onError={() => setFailed(true)}
        className="absolute inset-0 size-full object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-out group-hover:scale-[1.04]"
      />
    </div>
  );
}

/**
 * Card de un plato: foto (o una card tipográfica teñida con la paleta si no hay), nombre en display, precio, descripción
 * corta, etiquetas y opciones. Toda la card abre el detalle: el botón del nombre se estira sobre ella.
 */
export function DishCard({ product, span, desktopSpan = 1, onSelect, lang }: { product: MenuProduct; span: CardSpan; desktopSpan?: 1 | 2 | 3; onSelect?: (product: MenuProduct) => void; lang: Lang }) {
  const t = TEXTOS[lang].dish;
  const photo = imageUrl(product.image_path);
  // Las cards grandes (destacada y única) llevan el nombre más grande y la descripción completa.
  const featured = span === "featured" || span === "single";
  const soldOut = product.is_available === false;
  const name = (
    <h3 aria-label={product.name} className={`font-display leading-[1.05] hyphens-auto [overflow-wrap:anywhere] ${featured ? "text-3xl sm:text-4xl" : "text-[1.3125rem]"}`}>
      {onSelect ? (
        <button
          type="button"
          onClick={() => onSelect(product)}
          aria-label={t.viewDetail(product.name)}
          className="scroll-mt-40 scroll-mb-32 text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
        >
          {product.name}
        </button>
      ) : (
        product.name
      )}
    </h3>
  );

  return (
    <li className={`${SPAN_CLASS[span]} ${desktopSpan === 3 ? "md:col-span-3" : desktopSpan === 2 ? "md:col-span-2" : ""}`}>
      <article
        className={`carta-pieza group relative flex h-full flex-col overflow-hidden rounded-3xl ring-1 ring-inset ring-ink/15 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-[var(--carta-terra)] ${
          photo ? "bg-porcelain" : "bg-[var(--carta-sand)]"
        }`}
      >
        {photo ? <CardPhoto src={photo} name={product.name} span={span} lang={lang} desktopSpan={desktopSpan} /> : null}
        {!photo ? (
          // Inicial editorial: llena el espacio de una card sin foto sin sumarle altura ni información (es decorativa).
          <span aria-hidden="true" className="pointer-events-none absolute -right-1 -bottom-4 font-display text-[7rem] leading-none text-[var(--carta-green)]/10 select-none md:text-[9rem]">
            {product.name.trim().charAt(0).toUpperCase()}
          </span>
        ) : null}
        {photo && soldOut ? (
          <p className="carta-pildora absolute top-3 left-3 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-porcelain">{t.soldOut}</p>
        ) : null}
        <div className={`carta-cuerpo flex flex-col gap-2 p-4 ${featured ? "md:flex-none" : "flex-1"}`}>
          {!photo && soldOut ? <p className="carta-pildora w-fit rounded-full bg-ink px-3 py-1 text-xs font-semibold text-porcelain">{t.soldOut}</p> : null}
          {name}
          <DishPrice product={product} lang={lang} className="text-base font-semibold whitespace-nowrap text-[var(--carta-terra)] tabular-nums" />
          <PromoNote promotion={product.promotion} lang={lang} />
          {product.description ? (
            <p className={`text-sm leading-relaxed text-muted [overflow-wrap:anywhere] ${featured ? "sm:text-[0.9375rem]" : "line-clamp-3"}`}>
              {product.description}
            </p>
          ) : null}
          <DietaryLabels tags={product.dietary_tags} lang={lang} />
          {product.option_groups && product.option_groups.length > 0 ? (
            <div className="mt-auto pt-1">
              <DishOptions productId={product.id} groups={product.option_groups} maxRows={span === "normal" ? 6 : undefined} lang={lang} />
            </div>
          ) : null}
        </div>
      </article>
    </li>
  );
}
