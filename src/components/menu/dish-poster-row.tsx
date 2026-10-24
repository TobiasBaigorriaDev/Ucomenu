import { imageUrl } from "@/lib/carta/images";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import type { MenuProduct } from "@/lib/menu";
import { CardPhoto } from "./dish-card";
import { DishPrice, PromoNote } from "./dish-price";
import { DietaryLabels } from "./dietary-labels";
import { DishOptions } from "./dish-options";
import { formatDishNumber } from "./poster";

/**
 * Plato en la carta de estilo «afiche»: una fila abierta, cerrada abajo por un filete grueso de tinta. Número decorativo en la
 * columna izquierda, nombre en la condensada y precio siempre arriba a la derecha, a la altura del nombre; debajo, ingredientes,
 * etiquetas y opciones. Si hay foto, encabeza la fila como un recorte apaisado a todo el ancho (la foto original, sin quitarle el
 * fondo). Toda la fila abre el detalle: un botón con el nombre accesible del plato la cubre entera.
 */
export function DishPosterRow({ product, number, onSelect, lang }: { product: MenuProduct; number: number; onSelect?: (product: MenuProduct) => void; lang: Lang }) {
  const t = TEXTOS[lang].dish;
  const photo = imageUrl(product.image_path);
  const soldOut = product.is_available === false;
  return (
    <li className="afiche-row group relative border-b-[3px] border-ink py-5 last:border-b-[6px] has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--carta-terra)]">
      {photo ? (
        <div className="mb-4 overflow-hidden">
          <CardPhoto src={photo} name={product.name} span="poster" lang={lang} />
        </div>
      ) : null}
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 sm:grid-cols-[3.25rem_minmax(0,1fr)_auto] sm:gap-x-4">
        <span aria-hidden="true" className="afiche-number text-[1.75rem] leading-none text-[var(--carta-terra)] tabular-nums sm:text-[2.25rem]">
          {formatDishNumber(number)}
        </span>
        {/* El nombre va como texto (no dentro del botón): un botón es un bloque en línea y su línea de base es la última, así
            que con un nombre de dos líneas el número y el precio bajaban a la segunda. */}
        <h3 aria-label={product.name} className="font-display text-[1.75rem] leading-[0.95] hyphens-auto [overflow-wrap:anywhere] sm:text-[2.25rem]">
          {product.name}
        </h3>
        <DishPrice product={product} lang={lang} className="text-right text-lg leading-tight font-bold whitespace-nowrap tabular-nums sm:text-xl" />
        <div className="col-start-2 col-end-4 min-w-0">
          {soldOut ? <p className="mt-2 w-fit bg-ink px-2 py-0.5 text-xs font-bold tracking-[0.12em] text-porcelain uppercase">{t.soldOut}</p> : null}
          <PromoNote promotion={product.promotion} lang={lang} className="mt-1.5" />
          {product.description ? <p className="mt-2 max-w-[60ch] text-[0.9375rem] leading-relaxed text-muted [overflow-wrap:anywhere]">{product.description}</p> : null}
          <DietaryLabels tags={product.dietary_tags} lang={lang} />
          {product.option_groups && product.option_groups.length > 0 ? (
            <div className="afiche-options pt-1">
              <DishOptions productId={product.id} groups={product.option_groups} lang={lang} />
            </div>
          ) : null}
        </div>
      </div>
      {/* Toda la fila abre el detalle; va al final para quedar por encima de la foto. */}
      {onSelect ? (
        <button type="button" onClick={() => onSelect(product)} aria-label={t.viewDetail(product.name)} className="absolute inset-0 scroll-mt-40 scroll-mb-32 focus-visible:outline-none" />
      ) : null}
    </li>
  );
}
