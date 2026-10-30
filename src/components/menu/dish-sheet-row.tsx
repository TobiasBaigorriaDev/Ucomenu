import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import { DIETARY_TAGS } from "@/lib/carta/dietary";
import type { MenuProduct } from "@/lib/menu";
import { formatArs } from "@/lib/money";
import { DishPrice } from "./dish-price";
import { DIETARY_ABBR, sheetOptionLines } from "./sheet";

/**
 * Plato en la carta de estilo «hoja»: una línea de texto de página impresa, sin foto aunque el plato la tenga. Nombre en negrita con
 * las siglas dietarias y «Agotado» pegados y el precio a la derecha (la columna tiene ancho fijo, no se reacomoda); debajo, la descripción, la
 * promoción y las variantes en cuerpo chico. Es solo texto: como en un PDF, la fila no se toca ni abre un detalle.
 */
export function DishSheetRow({ product, lang }: { product: MenuProduct; lang: Lang }) {
  const t = TEXTOS[lang];
  const soldOut = product.is_available === false;
  const tags = DIETARY_TAGS.filter((tag) => product.dietary_tags?.includes(tag));
  const { lines, hidden } = sheetOptionLines(product.option_groups);
  return (
    <li className="sheet-row break-inside-avoid py-[3px]">
      <div className="flex items-baseline justify-between gap-x-2 text-xs leading-[1.2]">
        <span className="min-w-0 flex-1">
          <h3 aria-label={product.name} className={`inline text-xs leading-[1.2] font-bold [overflow-wrap:break-word] ${soldOut ? "text-muted line-through decoration-1" : ""}`}>
            {product.name}
          </h3>
          {tags.length ? (
            <ul aria-label={t.dietary.list} className="ml-1.5 inline">
              {tags.map((tag) => (
                <li key={tag} className="mr-1 inline text-[0.625rem] font-bold tracking-wide text-[var(--carta-green)]">
                  <span aria-hidden="true">{DIETARY_ABBR[tag]}</span>
                  <span className="sr-only">{t.dietary[tag]}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {soldOut ? <span className="ml-1.5 bg-ink px-1 py-px align-baseline text-[0.5625rem] font-bold tracking-[0.1em] whitespace-nowrap text-porcelain uppercase">{t.dish.soldOut}</span> : null}
        </span>
        <DishPrice product={product} lang={lang} className={`shrink-0 text-xs leading-[1.2] font-semibold whitespace-nowrap tabular-nums ${soldOut ? "text-muted" : "text-[var(--carta-terra)]"}`} />
      </div>
      {product.promotion ? (
        <p className="mt-px text-[0.6875rem] leading-snug font-semibold text-[var(--carta-green)] [overflow-wrap:anywhere]" data-testid="promocion-vigente">
          {product.promotion.name} · {t.promo.until(product.promotion.until.time, product.promotion.until.day, product.promotion.until.date)}
        </p>
      ) : null}
      {product.description ? <p className="mt-px text-[0.6875rem] leading-snug text-muted [overflow-wrap:anywhere]">{product.description}</p> : null}
      {lines.length ? (
        <ul data-testid="opciones-plato" className="mt-px text-[0.6875rem] leading-snug">
          {lines.map((group) => (
            <li key={group.id} data-testid="grupo-opciones" className="[overflow-wrap:anywhere]">
              <span className="font-semibold text-[var(--carta-green)]">{group.name}:</span>{" "}
              {group.options.map((option, i) => (
                <span key={option.id}>
                  {i > 0 ? " / " : ""}
                  {option.name}
                  {option.deltaCents > 0 ? <span className="whitespace-nowrap text-[var(--carta-terra)] tabular-nums"> + {formatArs(option.deltaCents)}</span> : null}
                </span>
              ))}
            </li>
          ))}
          {hidden > 0 ? <li className="text-muted">{t.options.more(hidden)}</li> : null}
        </ul>
      ) : null}
    </li>
  );
}
