const wholeFormat = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const centsFormat = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formatea un importe en centavos de ARS. Los precios nunca viajan como decimales:
 * 280000 -> "$ 2.800"; 280050 -> "$ 2.800,50".
 */
export function formatArs(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`Importe inválido: ${cents}`);
  }
  return cents % 100 === 0 ? wholeFormat.format(cents / 100) : centsFormat.format(cents / 100);
}
