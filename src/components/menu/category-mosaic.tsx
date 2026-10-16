import Image from "next/image";
import { imageUrl } from "@/lib/carta/images";
import type { MenuSection } from "@/lib/menu";
import { categoryAnchor, MOSAIC_ID } from "./anchors";
import { mosaicLayout, type TileShape } from "./mosaic";

const SPAN: Record<TileShape, string> = { small: "", wide: "col-span-2", tall: "row-span-2" };

/**
 * Ancho que necesita la foto de cada forma de mosaico (la grilla mide como máximo 48 rem y tiene dos columnas), para su
 * `sizes`: la ancha ocupa todo el ancho y la chica la mitad. La alta mide dos filas, así que con `object-cover` la foto
 * (apaisada) tiene que ser ~1,4 veces más ancha que la celda para cubrir el alto.
 */
const TILE_SIZES: Record<TileShape, string> = {
  small: "(min-width: 768px) 24rem, 50vw",
  tall: "(min-width: 768px) 31rem, 70vw",
  wide: "(min-width: 768px) 48rem, 100vw",
};

/** Colores de los mosaicos sin foto: se alternan para que dos vecinos no repitan. */
const SOLID = [
  "bg-[var(--carta-blush)] text-ink",
  "bg-[var(--carta-green)] text-white",
  "bg-[var(--carta-sand)] text-ink",
  "bg-[var(--carta-terra)] text-white",
];

/** Los nombres largos usan una letra menor para que entren sin partirse a mitad de palabra. */
function nameSize(name: string): string {
  if (name.length > 28) return "text-base sm:text-xl";
  if (name.length > 16) return "text-lg sm:text-2xl";
  return "text-[1.375rem] sm:text-[1.75rem]";
}

/**
 * Índice de categorías en mosaico: un enlace por categoría. Usa la foto del primer plato de la categoría que
 * tenga foto; si no hay ninguna, un bloque de color. Es la navegación principal de la carta; al bajar aparece
 * la barra fija (`CategoryBar`).
 */
export function CategoryMosaic({ sections }: { sections: MenuSection[] }) {
  const shapes = mosaicLayout(sections.length);
  const photos = sections.map(({ products }) => imageUrl(products.find((product) => product.image_path)?.image_path));
  const firstPhoto = photos.findIndex(Boolean);

  return (
    <nav id={MOSAIC_ID} aria-label="Categorías de la carta" className="mx-auto max-w-3xl px-4 sm:px-6">
      {/* Las filas miden como mínimo 8,5 rem pero crecen si un nombre largo lo necesita: nunca se recorta. */}
      <ul className="grid auto-rows-[minmax(8.5rem,auto)] grid-cols-2 gap-3 sm:auto-rows-[minmax(11rem,auto)] sm:gap-4">
        {sections.map(({ category }, i) => {
          const photo = photos[i];
          return (
            <li key={category.id} className={SPAN[shapes[i]]}>
              <a
                href={`#${categoryAnchor(category.id)}`}
                className={`carta-tile relative flex h-full items-start overflow-hidden rounded-3xl p-4 sm:p-5 ${
                  photo ? "bg-[var(--carta-green-deep)] text-white" : SOLID[i % SOLID.length]
                }`}
              >
                {photo ? (
                  <>
                    <Image
                      src={photo}
                      alt=""
                      fill
                      sizes={TILE_SIZES[shapes[i]]}
                      loading={i === firstPhoto ? "eager" : "lazy"}
                      fetchPriority={i === firstPhoto ? "high" : "auto"}
                      className="object-cover"
                    />
                    <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-black/65 via-black/15 to-black/5" />
                  </>
                ) : null}
                <span className={`relative font-display leading-[1.1] hyphens-auto [overflow-wrap:anywhere] ${nameSize(category.name)}`}>
                  {category.name}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
