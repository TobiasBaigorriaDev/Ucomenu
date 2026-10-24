import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import type { MenuProduct } from "@/lib/menu";
import { formatArs } from "@/lib/money";
import type { ProductPromotion } from "@/lib/promociones/carta";

/**
 * Precio de un plato en la carta (ficha carta-con-precio-promocional). Sin promoción es el precio de siempre; con ella, el de lista
 * tachado (con un «Precio anterior» para lectores de pantalla) y el promocional. Sin estado: lo usan componentes de servidor y de cliente.
 */
export function DishPrice({ product, lang, className }: { product: Pick<MenuProduct, "price_cents" | "promotion">; lang: Lang; className: string }) {
  const { promotion } = product;
  if (!promotion) return <p className={className}>{formatArs(product.price_cents)}</p>;
  const t = TEXTOS[lang].promo;
  return (
    <p className={className} data-testid="precio-promocional">
      <span className="sr-only">{t.was}: </span>
      <s className="mr-1.5 text-[0.8em] font-normal text-muted" data-testid="precio-de-lista">
        {formatArs(product.price_cents)}
      </s>
      {formatArs(promotion.priceCents)}
    </p>
  );
}

/** «Happy hour · Hasta las 20:00»: qué promoción es y hasta cuándo rige. Nada si el plato no tiene promoción. */
export function PromoNote({ promotion, lang, className = "" }: { promotion: ProductPromotion | undefined; lang: Lang; className?: string }) {
  if (!promotion) return null;
  const t = TEXTOS[lang].promo;
  return (
    <p className={`text-sm font-medium text-[var(--carta-green)] [overflow-wrap:anywhere] ${className}`} data-testid="promocion-vigente">
      {promotion.name} · {t.until(promotion.until.time, promotion.until.day, promotion.until.date)}
    </p>
  );
}
