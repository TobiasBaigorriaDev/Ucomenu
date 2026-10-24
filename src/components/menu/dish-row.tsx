import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import type { MenuProduct } from "@/lib/menu";
import { DishPrice, PromoNote } from "./dish-price";
import { DietaryLabels } from "./dietary-labels";
import { DishOptions } from "./dish-options";

/**
 * Plato en la carta de estilo «clásica»: nombre, puntos guía y precio en una línea, y debajo la descripción, las etiquetas y las
 * opciones, como una carta impresa. Sin foto en la lista (está en el detalle). Toda la fila abre el detalle: el botón del nombre
 * se estira sobre ella, igual que en `DishCard`.
 */
export function DishRow({ product, onSelect, lang }: { product: MenuProduct; onSelect?: (product: MenuProduct) => void; lang: Lang }) {
  const t = TEXTOS[lang].dish;
  const soldOut = product.is_available === false;
  return (
    <li className="relative border-b border-ink/15 py-4 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--carta-terra)]">
      <div className="flex items-baseline gap-2">
        <h3 aria-label={product.name} className="min-w-0 font-display text-[1.3125rem] leading-[1.1] hyphens-auto [overflow-wrap:anywhere] sm:text-2xl">
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
        <span aria-hidden="true" className="leader" />
        <DishPrice product={product} lang={lang} className="shrink-0 text-base font-semibold whitespace-nowrap text-[var(--carta-terra)] tabular-nums" />
      </div>
      <PromoNote promotion={product.promotion} lang={lang} className="mt-1" />
      {soldOut ? <p className="mt-2 w-fit rounded-full bg-ink px-3 py-1 text-xs font-semibold text-porcelain">{t.soldOut}</p> : null}
      {product.description ? <p className="mt-1.5 text-sm leading-relaxed text-muted [overflow-wrap:anywhere]">{product.description}</p> : null}
      <DietaryLabels tags={product.dietary_tags} lang={lang} />
      {product.option_groups && product.option_groups.length > 0 ? (
        <div className="pt-2">
          <DishOptions productId={product.id} groups={product.option_groups} lang={lang} />
        </div>
      ) : null}
    </li>
  );
}
