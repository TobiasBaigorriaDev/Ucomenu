/**
 * Precios de la carta. Se escriben en pesos y se guardan en CENTAVOS ENTEROS (`products.price_cents`,
 * `integer`): el texto se parsea dígito a dígito, nunca se pasa por un `float`.
 *
 * Formato aceptado (es-AR): la coma separa los decimales y el punto agrupa miles.
 *   "2800" · "2.800" · "2800,5" · "2.800,50" · "$ 2.800"
 * Por tolerancia se acepta también un punto decimal de 1 o 2 cifras ("2800.50"); "2.800" es siempre 2800.
 */

/** $ 10.000.000: muy por encima de cualquier plato y muy por debajo del límite del `integer`. */
export const MAX_PRICE_CENTS = 1_000_000_000;

export type PriceProblem = "blank" | "invalid" | "too_many_decimals" | "too_big";

export const PRICE_PROBLEM_MESSAGE: Record<PriceProblem, string> = {
  blank: "Ingresá el precio.",
  invalid: "El precio no es válido. Escribilo como 2800 o 2.800,50.",
  too_many_decimals: "El precio admite como máximo 2 decimales.",
  too_big: "El precio es demasiado alto.",
};

export type PriceResult = { ok: true; cents: number } | { ok: false; problem: PriceProblem };

const GROUPED = /^\d{1,3}(\.\d{3})+$/;
const DIGITS = /^\d+$/;

export function parsePrice(raw: unknown): PriceResult {
  if (typeof raw !== "string") return { ok: false, problem: "blank" };
  const text = raw.replace(/^\s*\$?\s*/, "").trim();
  if (text.length === 0) return { ok: false, problem: "blank" };

  let integer: string;
  let decimals = "";

  const comma = text.split(",");
  if (comma.length > 2) return { ok: false, problem: "invalid" };

  if (comma.length === 2) {
    [integer, decimals] = comma;
    if (!DIGITS.test(decimals)) return { ok: false, problem: "invalid" };
  } else if (text.includes(".") && !GROUPED.test(text)) {
    // Sin coma y con un punto que no agrupa miles: solo vale como decimal ("2800.5", "2800.50").
    const dot = text.split(".");
    if (dot.length !== 2 || !DIGITS.test(dot[1])) return { ok: false, problem: "invalid" };
    [integer, decimals] = dot;
  } else {
    integer = text;
  }

  if (decimals.length > 2) return { ok: false, problem: "too_many_decimals" };
  if (!(DIGITS.test(integer) || GROUPED.test(integer))) return { ok: false, problem: "invalid" };

  const whole = integer.replaceAll(".", "");
  // Antes de convertir: evita desbordes con textos larguísimos.
  if (whole.replace(/^0+/, "").length > 9) return { ok: false, problem: "too_big" };

  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  if (cents > MAX_PRICE_CENTS) return { ok: false, problem: "too_big" };
  return { ok: true, cents };
}

/** Para precargar el campo al editar: 280000 -> "2800"; 280050 -> "2800,50". */
export function priceToInput(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(whole) : `${whole},${String(rest).padStart(2, "0")}`;
}
