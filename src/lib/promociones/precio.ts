/**
 * Precio efectivo de un plato en una sucursal (ficha promociones-y-precio-efectivo, ADR 0040). Réplica en TypeScript de
 * `public.effective_prices`: la AUTORIDAD es la base; esto sirve para mostrar una vista previa sin ir a la base y para la prueba
 * de paridad (`precio.test.ts` y `promociones.rls.test.ts` recorren la misma tabla de casos, `casos-precio.ts`).
 *
 * Reglas (las mismas que la cabecera de la migración 20261123100000):
 *  - La franja se mide en el reloj de pared de la sucursal, en minutos del día: `[startMinute, endMinute)`. `endMinute <
 *    startMinute` cruza la medianoche y pertenece al día en que empieza. Los segundos no cuentan.
 *  - `startsOn` / `endsOn` (inclusivos) se miden sobre el día en que EMPIEZA la franja.
 *  - Porcentaje: base × (100 − p) / 100, mitad hacia arriba, en enteros. Monto: base − monto, piso 0. Precio fijo: el valor.
 *  - Una promoción solo se aplica si deja el precio ESTRICTAMENTE por debajo del de lista. Gana el precio más bajo; empate: la más
 *    antigua (`createdAt`, a microsegundos) y luego el `id`.
 */

export type DiscountType = "percent" | "amount" | "fixed_price";

/** Una promoción ya filtrada por lo que decide la base de datos: activa, de esta organización, de esta sucursal y de este plato. */
export type PromotionRule = {
  id: string;
  name: string;
  discountType: DiscountType;
  discountValue: number;
  /** Lunes = bit 0 … domingo = bit 6. */
  weekdaysMask: number;
  startMinute: number;
  endMinute: number;
  /** `AAAA-MM-DD` o `null`. */
  startsOn: string | null;
  endsOn: string | null;
  /** Instante de alta (ISO). Desempata dos promociones con el mismo precio. */
  createdAt: string;
};

export type AppliedPromotion = {
  id: string;
  name: string;
  discountType: DiscountType;
  discountValue: number;
  /** Cuándo termina esta franja en el reloj de la sucursal: `AAAA-MM-DDTHH:MM:SS`. */
  endsLocal: string;
};

export type EffectivePrice = {
  /** Precio de lista de la sucursal (el propio o el base). */
  basePriceCents: number;
  priceCents: number;
  promotion: AppliedPromotion | null;
};

const DAY_MS = 86_400_000;

const clockFormats = new Map<string, Intl.DateTimeFormat>();

function clockFormat(timeZone: string): Intl.DateTimeFormat {
  let format = clockFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    clockFormats.set(timeZone, format);
  }
  return format;
}

/** El reloj de pared de un instante en una zona: el día (`AAAA-MM-DD`) y el minuto del día (0–1439). */
export function wallClock(at: Date, timeZone: string): { date: string; minute: number } {
  const parts: Record<string, string> = {};
  for (const part of clockFormat(timeZone).formatToParts(at)) parts[part.type] = part.value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

const utcMs = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

/** El día anterior de una fecha `AAAA-MM-DD`. */
export function previousDate(date: string): string {
  return new Date(utcMs(date) - DAY_MS).toISOString().slice(0, 10);
}

/** Día ISO (lunes = 1 … domingo = 7) de una fecha `AAAA-MM-DD`. */
export function isoWeekday(date: string): number {
  const day = new Date(utcMs(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Si la promoción está en curso en ese reloj de pared: cuándo termina la franja (`AAAA-MM-DDTHH:MM:SS`, reloj de la sucursal) o
 * `null`. Prueba la franja que empezó hoy y la que empezó ayer (solo si cruza la medianoche).
 */
export function windowEndsLocal(rule: PromotionRule, clock: { date: string; minute: number }): string | null {
  const crosses = rule.endMinute < rule.startMinute;
  for (const [startDate, back] of [[clock.date, false] as const, [previousDate(clock.date), true] as const]) {
    if (((rule.weekdaysMask >> (isoWeekday(startDate) - 1)) & 1) !== 1) continue;
    if (rule.startsOn !== null && startDate < rule.startsOn) continue;
    if (rule.endsOn !== null && startDate > rule.endsOn) continue;
    const inside = back
      ? crosses && clock.minute < rule.endMinute
      : clock.minute >= rule.startMinute && (crosses || clock.minute < rule.endMinute);
    if (!inside) continue;
    const endMs = utcMs(startDate) + ((crosses ? 1440 : 0) + rule.endMinute) * 60_000;
    return new Date(endMs).toISOString().slice(0, 19);
  }
  return null;
}

/** Precio con la promoción, en centavos, antes de compararlo con el de lista. Entero. */
export function promotionPriceCents(rule: Pick<PromotionRule, "discountType" | "discountValue">, basePriceCents: number): number {
  switch (rule.discountType) {
    case "percent":
      return Math.floor((basePriceCents * (100 - rule.discountValue) + 50) / 100);
    case "amount":
      return Math.max(0, basePriceCents - rule.discountValue);
    case "fixed_price":
      return rule.discountValue;
  }
}

/**
 * Precio efectivo en un instante. `promotions` son las que ya aplican a este plato en esta sucursal (la base filtra por objetivo,
 * sucursal, pausa, plan y estado de la cuenta); acá se decide cuáles están en curso y cuál gana.
 */
export function effectivePrice(input: { basePriceCents: number; promotions: readonly PromotionRule[]; timeZone: string; at: Date }): EffectivePrice {
  const { basePriceCents, promotions, timeZone, at } = input;
  const clock = wallClock(at, timeZone);

  let best: { rule: PromotionRule; price: number; endsLocal: string } | null = null;
  for (const rule of promotions) {
    const endsLocal = windowEndsLocal(rule, clock);
    if (endsLocal === null) continue;
    const price = promotionPriceCents(rule, basePriceCents);
    if (price >= basePriceCents) continue;
    if (best === null || beats({ rule, price }, best)) best = { rule, price, endsLocal };
  }

  if (best === null) return { basePriceCents, priceCents: basePriceCents, promotion: null };
  const { rule, price, endsLocal } = best;
  return {
    basePriceCents,
    priceCents: price,
    promotion: { id: rule.id, name: rule.name, discountType: rule.discountType, discountValue: rule.discountValue, endsLocal },
  };
}

function beats(a: { rule: PromotionRule; price: number }, b: { rule: PromotionRule; price: number }): boolean {
  if (a.price !== b.price) return a.price < b.price;
  const byAge = compareInstants(a.rule.createdAt, b.rule.createdAt);
  if (byAge !== 0) return byAge < 0;
  return a.rule.id < b.rule.id;
}

/**
 * Compara dos instantes ISO al microsegundo. Postgres guarda `created_at` con microsegundos y `Date.parse` los pierde: dos altas del
 * mismo milisegundo se desempatarían distinto que en la base. Devuelve negativo, cero o positivo.
 */
export function compareInstants(left: string, right: string): number {
  const a = splitInstant(left);
  const b = splitInstant(right);
  return a.seconds !== b.seconds ? a.seconds - b.seconds : a.micros - b.micros;
}

/** Segundos enteros desde 1970 y microsegundos de la fracción (0–999999). */
export function splitInstant(iso: string): { seconds: number; micros: number } {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(iso.trim());
  if (!match) return { seconds: Date.parse(iso) / 1000, micros: 0 };
  const [, date, time, fraction = "", zone = "Z"] = match;
  const offset = zone === "Z" ? "Z" : zone.length === 3 ? `${zone}:00` : zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone;
  return { seconds: Date.parse(`${date}T${time}${offset}`) / 1000, micros: Number(`${fraction}000000`.slice(0, 6)) };
}
