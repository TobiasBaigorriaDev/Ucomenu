import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import type { MenuProduct, MenuSection as Section } from "@/lib/menu";
import { categoryAnchor } from "./anchors";
import { DishCard, type CardSpan } from "./dish-card";
import { toneFor } from "./tones";

/**
 * Forma de cada card en la grilla de 2 columnas (3 en escritorio): si el primer plato de la categoría tiene foto y hay al
 * menos tres, es el destacado y ocupa dos columnas; si después queda un número impar de cards, la última ocupa el ancho
 * completo en el celular para no dejar un hueco. El orden de la carta (el del local) nunca se altera.
 */
export function cardSpans(products: Pick<MenuProduct, "image_path">[]): CardSpan[] {
  const featured = products.length >= 3 && Boolean(products[0]?.image_path);
  const rest = products.length - (featured ? 1 : 0);
  return products.map((_, i) => {
    if (featured && i === 0) return "featured";
    if (rest % 2 === 1 && i === products.length - 1) return "tail";
    return "normal";
  });
}

export function MenuSection({ section, index, onSelect, lang }: { section: Section; index: number; onSelect?: (product: MenuProduct) => void; lang: Lang }) {
  const { category, products } = section;
  const headingId = `${categoryAnchor(category.id)}-title`;
  const spans = cardSpans(products);

  return (
    <section id={categoryAnchor(category.id)} aria-labelledby={headingId} className="mt-14 scroll-mt-16 sm:mt-20">
      {/* Banda de la sección: queda pegada bajo la barra de categorías mientras se recorren sus platos, con el color de su
          celda en el bento. Así siempre se ve en qué categoría se está. La franja de fondo sólido evita que las cards se
          asomen por las esquinas redondeadas (z-[5]: por encima de las cards, debajo de la barra, que es z-10). */}
      <div className="sticky top-16 z-[5] -mx-4 bg-porcelain px-4 py-2 sm:-mx-6 sm:px-6">
        <div className={`flex items-baseline gap-3 rounded-2xl px-4 py-2.5 ${toneFor(index)}`}>
          <span aria-hidden="true" className="text-sm font-semibold tabular-nums">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h2 id={headingId} className="min-w-0 font-display text-[2rem] leading-none [overflow-wrap:anywhere] sm:text-5xl">
            {category.name}
          </h2>
          <p className="ml-auto shrink-0 text-sm font-medium">{TEXTOS[lang].count.dishes(products.length)}</p>
        </div>
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
        {products.map((product, i) => (
          <DishCard key={product.id} product={product} span={spans[i]} onSelect={onSelect} lang={lang} />
        ))}
      </ul>
    </section>
  );
}
