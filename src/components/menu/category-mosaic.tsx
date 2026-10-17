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
  "bg-[var(--carta-sand)] text-ink ring-1 ring-inset ring-ink/15",
  "bg-[var(--carta-terra)] text-white",
];

/** Tamaño del nombre según la forma de la celda; los nombres largos bajan un escalón para que entren sin partirse a mitad de palabra. */
function nameSize(name: string, shape: TileShape): string {
  if (name.length > 28) return "text-lg sm:text-2xl";
  if (shape === "wide") return name.length > 16 ? "text-3xl sm:text-4xl" : "text-4xl sm:text-5xl";
  if (shape === "tall") return name.length > 16 ? "text-xl sm:text-3xl" : "text-2xl sm:text-4xl";
  return name.length > 16 ? "text-xl sm:text-2xl" : "text-2xl sm:text-3xl";
}

/**
 * Índice de categorías en bento: un enlace por categoría, con su número de índice, su nombre y la cantidad de platos.
 * La primera celda es siempre ancha y hace de portada. Usa la foto del primer plato de la categoría que tenga foto;
 * si no hay ninguna, un bloque de color de la paleta del local. Es la navegación principal de la carta; al bajar
 * aparece la barra fija (`CategoryBar`).
 */
export function CategoryMosaic({ sections }: { sections: MenuSection[] }) {
  const shapes = mosaicLayout(sections.length);
  const photos = sections.map(({ products }) => imageUrl(products.find((product) => product.image_path)?.image_path));
  const firstPhoto = photos.findIndex(Boolean);

  return (
    <nav id={MOSAIC_ID} aria-label="Categorías de la carta" className="mx-auto max-w-3xl px-4 sm:px-6">
      {/* Las filas miden como mínimo 8,5 rem pero crecen si un nombre largo lo necesita: nunca se recorta. */}
      <ul className="grid auto-rows-[minmax(8.5rem,auto)] grid-cols-2 gap-3 sm:auto-rows-[minmax(11rem,auto)] sm:gap-4">
        {sections.map(({ category, products }, i) => {
          const photo = photos[i];
          const count = products.length === 1 ? "1 plato" : `${products.length} platos`;
          return (
            <li key={category.id} className={SPAN[shapes[i]]}>
              <a
                href={`#${categoryAnchor(category.id)}`}
                className={`carta-tile relative flex h-full flex-col justify-between gap-6 overflow-hidden rounded-3xl p-4 sm:p-5 ${
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
                    <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/10 to-black/75" />
                  </>
                ) : null}
                <span aria-hidden="true" className="relative flex items-start justify-between">
                  <span className="text-sm font-semibold tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 7l10 10M17 8v9H8" />
                  </svg>
                </span>
                <span className="relative">
                  <span className={`block font-display leading-[1.05] hyphens-auto [overflow-wrap:anywhere] ${nameSize(category.name, shapes[i])}`}>
                    {category.name}
                  </span>
                  <span className="mt-1.5 block text-sm font-medium">{count}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
