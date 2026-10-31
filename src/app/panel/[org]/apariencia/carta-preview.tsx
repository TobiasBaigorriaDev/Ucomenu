"use client";

import { CategoryMosaic } from "@/components/menu/category-mosaic";
import { cartaFontClass } from "@/components/menu/carta-fonts";
import { MenuHeader } from "@/components/menu/menu-header";
import { MenuSection } from "@/components/menu/menu-section";
import { SheetView } from "@/components/menu/sheet-view";
import { DEFAULT_LOOK, lookProps, type Look } from "@/lib/identidad/apariencia";
import type { Layout } from "@/lib/identidad/layouts";
import { paletteStyle } from "@/lib/identidad/palettes";
import { themeStyle, type Theme } from "@/lib/identidad/temas";
import type { MenuProduct, MenuSection as Section } from "@/lib/menu";

const dish = (id: string, name: string, description: string, pesos: number, extra: Partial<MenuProduct> = {}): MenuProduct => ({
  id: `muestra-${id}`, category_id: "muestra-principales", name, description, price_cents: pesos * 100, sort_order: 0, ...extra,
});

// Datos de muestra (no son del local): bastan para ver el fondo, las celdas de categoría, las cards y el cartel de «agotado».
const SECTIONS: Section[] = [
  { category: { id: "muestra-entradas", name: "Entradas", sort_order: 0 }, products: [dish("a", "Provoleta", "", 6200)] },
  { category: { id: "muestra-principales", name: "Principales", sort_order: 1 }, products: [
    dish("b", "Milanesa napolitana", "Con papas rústicas y salsa casera.", 11800),
    dish("c", "Risotto de hongos", "Cremoso, con parmesano y aceite de oliva.", 12400, { dietary_tags: ["vegetarian"] }),
    dish("d", "Ravioles de ricota", "Salsa fileto o crema.", 10900, { is_available: false }),
  ] },
  { category: { id: "muestra-postres", name: "Postres", sort_order: 2 }, products: [dish("e", "Flan casero", "", 4800)] },
  { category: { id: "muestra-bebidas", name: "Bebidas", sort_order: 3 }, products: [dish("f", "Limonada", "", 3200)] },
];

/**
 * Vista previa de la carta con los componentes reales (cabecera, mosaico de categorías, banda de sección y cards) y datos de
 * muestra, dentro de `.carta` con la paleta elegida. Se muestra entera, sin recorte: quien se desplaza es el contenedor (el panel fijo del estudio o la hoja del celular), así con una portada también se llega al menú.
 */
export function CartaPreview({ name, logo, palette, layout, theme = null, look = DEFAULT_LOOK, tagline = null, cover = null, social = {}, testId }: { name: string; logo: string | null; palette: string; layout: Layout; theme?: Theme | null; look?: Look; tagline?: string | null; cover?: string | null; social?: { instagram?: string | null; whatsapp?: string | null }; testId: string }) {
  const { attrs, style } = lookProps(look, theme !== null);
  return (
    <div className="relative mt-5 overflow-hidden rounded-xl border border-ink/15">
      <div
        aria-hidden="true"
        inert
        data-testid={testId}
        data-tema={theme ?? undefined}
        data-layout={layout}
        {...attrs}
        className={`${cartaFontClass} carta carta-preview pb-8 select-none`}
        style={{ ...paletteStyle(palette), ...themeStyle(theme), ...style, minHeight: 0 }}
      >
        <MenuHeader organizationName={name} branchName="Centro" logo={logo} theme={theme} layout={layout} tagline={tagline} cover={cover} social={social} />
        {layout === "bento" ? (
          <CategoryMosaic sections={SECTIONS} lang="es" />
        ) : (
          // La barra real es fija; acá se dibuja la misma tira de categorías en el flujo.
          <ul className={`mx-auto flex max-w-3xl gap-2 overflow-hidden px-4 py-2.5 sm:px-6 ${layout === "afiche" ? "border-b-[3px] border-ink" : "border-y border-ink/10"}`}>
            {SECTIONS.map(({ category }, i) => (
              <li key={category.id} className={`carta-chip flex min-h-11 shrink-0 items-center rounded-full px-4 text-[0.75rem] font-semibold tracking-[0.08em] uppercase ${i === 1 ? "bg-[var(--carta-green)] text-[var(--on-accent)]" : "bg-[var(--carta-blush)] text-ink"}`}>
                {category.name}
              </li>
            ))}
          </ul>
        )}
        <div className={`mx-auto px-4 pb-4 sm:px-6 ${layout !== "bento" ? "mt-6 " : ""}${layout === "minimal" ? "max-w-2xl" : "max-w-3xl"}`}>
          {layout === "hoja" ? <SheetView sections={SECTIONS} title={{ name, logo }} lang="es" /> : <MenuSection section={SECTIONS[1]} index={1} lang="es" layout={layout} />}
        </div>
      </div>
    </div>
  );
}
