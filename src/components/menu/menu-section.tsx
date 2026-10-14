import Image from "next/image";
import { imageUrl } from "@/lib/carta/images";
import { formatArs } from "@/lib/money";
import type { MenuSection as Section } from "@/lib/menu";
import { categoryAnchor } from "./category-nav";

export function MenuSection({ section }: { section: Section }) {
  const { category, products } = section;
  const headingId = `${categoryAnchor(category.id)}-title`;

  return (
    <section id={categoryAnchor(category.id)} aria-labelledby={headingId} className="scroll-mt-14 pt-10">
      <h2 id={headingId} className="font-display text-[1.75rem] leading-tight text-cobalt">
        {category.name}
      </h2>
      <ul className="mt-5 space-y-6">
        {products.map((product) => {
          const photo = imageUrl(product.image_path);
          return (
          <li key={product.id}>
            {photo ? (
              // Tamaño fijo para que la foto no mueva el diseño al cargar. Sin optimizar: ver «Rendimiento de la carta pública».
              <Image
                src={photo}
                alt={`Foto de ${product.name}`}
                width={640}
                height={360}
                unoptimized
                loading="lazy"
                className="mb-3 aspect-[16/9] w-full rounded-md object-cover"
              />
            ) : null}
            <div className="flex items-baseline gap-2">
              <h3 className="text-[1.0625rem] leading-snug font-semibold break-words">{product.name}</h3>
              <span aria-hidden="true" className="leader" />
              <p className="shrink-0 text-[1.0625rem] font-semibold tabular-nums">{formatArs(product.price_cents)}</p>
            </div>
            {product.description ? (
              <p className="mt-1 max-w-[34ch] text-[0.9375rem] leading-relaxed text-muted">{product.description}</p>
            ) : null}
          </li>
          );
        })}
      </ul>
    </section>
  );
}
