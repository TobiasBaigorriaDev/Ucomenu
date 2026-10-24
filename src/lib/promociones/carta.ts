import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { wallClock } from "./precio";

/**
 * Precio promocional en la carta pública (ficha carta-con-precio-promocional, ADR 0040). La AUTORIDAD es `effective_prices` de la base;
 * acá solo se lee en vivo (fuera de la caché del catálogo, como los ajustes de la sucursal) y se pone cada resultado en su plato.
 */

type Db = SupabaseClient<Database>;

export type PromotionUntil = {
  /** `HH:MM` del reloj de la sucursal. */
  time: string;
  /** `today`: termina hoy · `tomorrow`: después de la medianoche · `later`: otro día. */
  day: "today" | "tomorrow" | "later";
  /** `dd/mm` del fin (para `later`). */
  date: string;
};

/** La promoción que rige hoy para un plato: el precio promocional y hasta cuándo. El precio de lista sigue en `price_cents` del plato. */
export type ProductPromotion = {
  priceCents: number;
  name: string;
  until: PromotionUntil;
};

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS;

/** «Hasta cuándo» a partir del fin de la franja en el reloj de la sucursal (`AAAA-MM-DDTHH:MM:SS`) y del día de hoy allí. */
export function describeUntil(endsLocal: string, today: string): PromotionUntil | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(endsLocal);
  if (!match) return null;
  const [, date, time] = match;
  const offset = dayNumber(date) - dayNumber(today);
  const day = offset <= 0 ? "today" : offset === 1 ? "tomorrow" : "later";
  return { time, day, date: `${date.slice(8, 10)}/${date.slice(5, 7)}` };
}

/**
 * Las promociones en curso de una sucursal, por plato: precio efectivo y fin de la franja. En vivo en cada pedido de la carta. Un fallo
 * de lectura lanza: nunca se interpreta como «sin promociones» (se publicaría el precio de lista, más alto que el que obliga al local).
 */
export async function loadBranchPromotions(db: Db, branchId: string, timeZone: string, now: Date = new Date()): Promise<Map<string, ProductPromotion>> {
  const { data, error } = await db.rpc("effective_prices", { p_branch: branchId, p_product: undefined, p_at: undefined });
  if (error) throw new Error("No se pudieron leer los precios promocionales de la sucursal de la carta.");
  const today = wallClock(now, timeZone).date;
  const map = new Map<string, ProductPromotion>();
  for (const row of data ?? []) {
    if (!row.promotion_id || !row.promotion_name || !row.ends_local) continue;
    const until = describeUntil(row.ends_local, today);
    if (until) map.set(row.product_id, { priceCents: row.price_cents, name: row.promotion_name, until });
  }
  return map;
}

/**
 * Pone la promoción en cada plato que la tiene. El precio de lista (`price_cents`) no se toca: la carta lo muestra tachado. Una promoción
 * cuyo precio no es menor al de lista (no debería llegar: la base no la aplica) se ignora. Función pura.
 */
export function applyPromotions<P extends { id: string; price_cents: number }>(
  products: readonly P[],
  promotions: ReadonlyMap<string, ProductPromotion>,
): (P & { promotion?: ProductPromotion })[] {
  return products.map((product) => {
    const promotion = promotions.get(product.id);
    return promotion && promotion.priceCents < product.price_cents ? { ...product, promotion } : { ...product };
  });
}
