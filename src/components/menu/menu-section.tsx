import type { Layout } from "@/lib/identidad/layouts";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import type { MenuProduct, MenuSection as Section } from "@/lib/menu";
import { categoryAnchor } from "./anchors";
import { DishCard, type CardSpan } from "./dish-card";
import { DishPosterRow } from "./dish-poster-row";
import { DishRow } from "./dish-row";
import { posterFontSize } from "./poster";
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

/**
 * Sección de una categoría según el estilo de carta del local. `bento` (el predeterminado) lleva la banda de color pegajosa y la
 * grilla de cards; `clasica` y `minimal` llevan un título simple (la barra de categorías es fija y siempre visible, así que el
 * título no necesita quedar pegado) y una lista con puntos guía o una columna de cards con foto grande; `afiche`, una banda de
 * color con el título enorme y filas numeradas separadas por filetes gruesos.
 */
export function MenuSection({
  section,
  index,
  onSelect,
  lang,
  layout = "bento",
  numbers,
}: {
  section: Section;
  index: number;
  onSelect?: (product: MenuProduct) => void;
  lang: Lang;
  layout?: Layout;
  /** Número de cada plato en su categoría sin filtrar (`dishNumbers`); sin él, se numera según lo que se muestra. */
  numbers?: Map<string, number>;
}) {
  const { category, products } = section;
  const headingId = `${categoryAnchor(category.id)}-title`;
  const spans = cardSpans(products);

  if (layout === "afiche") {
    // Banda llena con el tono de la categoría (el mismo ciclo que el bento) y el nombre en la condensada, del ancho de la banda.
    // No es pegajosa: con títulos de este tamaño taparía los platos; la barra fija dice en qué categoría se está.
    return (
      <section id={categoryAnchor(category.id)} aria-labelledby={headingId} className="mt-12 scroll-mt-20 first:mt-6 sm:mt-16">
        <div className={`-mx-4 px-4 pt-4 pb-3 sm:mx-0 sm:px-6 sm:pt-5 ${toneFor(index)}`}>
          <div className="@container">
            <h2 id={headingId} className="font-display leading-[0.85] text-balance [overflow-wrap:anywhere]" style={{ fontSize: posterFontSize(category.name, { min: 2.5, max: 13 }) }}>
              {category.name}
            </h2>
          </div>
          <p className="mt-2 text-right text-sm font-bold tracking-[0.1em] uppercase">{TEXTOS[lang].count.dishes(products.length)}</p>
        </div>
        <ul>
          {products.map((product, i) => (
            <DishPosterRow key={product.id} product={product} number={numbers?.get(product.id) ?? i + 1} onSelect={onSelect} lang={lang} />
          ))}
        </ul>
      </section>
    );
  }

  if (layout !== "bento") {
    return (
      <section id={categoryAnchor(category.id)} aria-labelledby={headingId} className={`scroll-mt-20 ${layout === "minimal" ? "mt-16" : "mt-12"}`}>
        <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-ink pb-2">
          <h2 id={headingId} className="min-w-0 font-display text-[2rem] leading-none text-[var(--carta-green)] [overflow-wrap:anywhere] sm:text-4xl">
            {category.name}
          </h2>
          <p className="shrink-0 text-sm font-medium text-muted">{TEXTOS[lang].count.dishes(products.length)}</p>
        </div>
        {layout === "clasica" ? (
          <ul>
            {products.map((product) => <DishRow key={product.id} product={product} onSelect={onSelect} lang={lang} />)}
          </ul>
        ) : (
          <ul className="mt-6 grid gap-8">
            {products.map((product) => <DishCard key={product.id} product={product} span="single" onSelect={onSelect} lang={lang} />)}
          </ul>
        )}
      </section>
    );
  }

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
