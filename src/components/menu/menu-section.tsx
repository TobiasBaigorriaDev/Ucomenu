import { formatArs } from "@/lib/money";
import { imageUrl } from "@/lib/carta/images";
import type { MenuSection as Section } from "@/lib/menu";
import { categoryAnchor } from "./anchors";
import { DishPhoto } from "./dish-photo";

export function MenuSection({ section }: { section: Section }) {
  const { category, products } = section;
  const headingId = `${categoryAnchor(category.id)}-title`;
  /** Si algún plato de la categoría tiene foto, todos reservan su miniatura (con marcador) y la lista queda pareja. */
  const hasPhotos = products.some((product) => product.image_path);

  return (
    <section id={categoryAnchor(category.id)} aria-labelledby={headingId} className="scroll-mt-20 pt-16 sm:pt-24">
      <div className="text-center">
        <h2
          id={headingId}
          className="font-display text-[2rem] leading-tight text-[var(--carta-green)] [overflow-wrap:anywhere] sm:text-5xl"
        >
          {category.name}
        </h2>
        <p className="mt-2 text-sm text-muted">{products.length === 1 ? "1 plato" : `${products.length} platos`}</p>
        <span aria-hidden="true" className="mt-4 flex justify-center gap-1.5">
          <i className="size-1.5 rotate-45 bg-[var(--carta-terra)]" />
          <i className="size-1.5 rotate-45 bg-[var(--carta-green)]" />
          <i className="size-1.5 rotate-45 bg-[var(--carta-blush)]" />
        </span>
      </div>
      {/* Lista en columnas balanceadas: sin tarjetas, con un filete fino entre platos. El orden de la carta se lee de arriba abajo. */}
      <ul className="mt-8 gap-x-14 md:columns-2">
        {products.map((product) => (
          <li key={product.id} className="break-inside-avoid border-b border-ink/12 py-5">
            <div className="flex gap-4">
              {hasPhotos ? <DishPhoto src={imageUrl(product.image_path)} name={product.name} /> : null}
              <div className="min-w-0 flex-1">
                {/* Nombre y precio en una fila; si el nombre es largo y no entran los dos, el precio baja a su propia línea (a la derecha). */}
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="min-w-40 flex-1 font-display text-[1.25rem] leading-snug hyphens-auto [overflow-wrap:anywhere]">
                    {product.name}
                  </h3>
                  <p className="ml-auto shrink-0 text-base font-semibold whitespace-nowrap text-[var(--carta-terra)] tabular-nums">
                    {formatArs(product.price_cents)}
                  </p>
                </div>
                {product.description ? (
                  <p className="mt-1.5 max-w-[46ch] text-[0.9375rem] leading-relaxed text-muted [overflow-wrap:anywhere]">
                    {product.description}
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
