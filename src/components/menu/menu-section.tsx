import type { MenuProduct, MenuSection as Section } from "@/lib/menu";
import { categoryAnchor } from "./anchors";
import { DishCard, type CardSpan } from "./dish-card";

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

export function MenuSection({ section, index, onSelect }: { section: Section; index: number; onSelect?: (product: MenuProduct) => void }) {
  const { category, products } = section;
  const headingId = `${categoryAnchor(category.id)}-title`;
  const spans = cardSpans(products);

  return (
    <section id={categoryAnchor(category.id)} aria-labelledby={headingId} className="scroll-mt-20 pt-14 sm:pt-20">
      {/* Cabecera editorial: filete, número del índice (el mismo del bento), nombre en display y cantidad de platos. */}
      <div className="flex items-baseline gap-3 border-t-[1.5px] border-ink pt-3">
        <span aria-hidden="true" className="text-sm font-semibold text-[var(--carta-terra)] tabular-nums">
          {String(index + 1).padStart(2, "0")}
        </span>
        <h2 id={headingId} className="min-w-0 font-display text-[2.5rem] leading-none text-[var(--carta-green)] [overflow-wrap:anywhere] sm:text-6xl">
          {category.name}
        </h2>
        <p className="ml-auto shrink-0 text-sm text-muted">{products.length === 1 ? "1 plato" : `${products.length} platos`}</p>
      </div>
      <ul className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
        {products.map((product, i) => (
          <DishCard key={product.id} product={product} span={spans[i]} onSelect={onSelect} />
        ))}
      </ul>
    </section>
  );
}
