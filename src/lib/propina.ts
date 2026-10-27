/** Porcentaje entero; null desactiva. Compartido por cuenta y precuenta. */
export function isTipPercent(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100);
}

export function parseTipPercent(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,3}$/.test(value)) return null;
  const percent = Number(value);
  return isTipPercent(percent) ? percent : null;
}

export type SuggestedTip = { percent: number; cents: number; totalCents: number };

/** Redondea una sola vez al centavo, mitad hacia arriba, sin multiplicación flotante. */
export function suggestedTip(totalCents: number, percent: number | null): SuggestedTip | null {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || !isTipPercent(percent)) throw new Error("Cuenta o porcentaje inválido.");
  if (percent === null || totalCents === 0) return null;
  const cents = Number((BigInt(totalCents) * BigInt(percent) + BigInt(50)) / BigInt(100));
  const total = totalCents + cents;
  if (!Number.isSafeInteger(total)) throw new Error("Total fuera de rango.");
  return { percent, cents, totalCents: total };
}
