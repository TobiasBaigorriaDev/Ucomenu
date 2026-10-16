import type { Currency } from "./validation";

export const CYCLE_LABEL: Record<string, string> = { monthly: "mensual", yearly: "anual" };
export const METHOD_LABEL: Record<string, string> = {
  transfer: "Transferencia",
  payment_link: "Link de pago",
  cash: "Efectivo",
  other: "Otro medio",
};

/** Importe en centavos con su moneda («$ 20.000,50 ARS», «US$ 20 USD»). Solo para mostrar. */
export function formatMoney(cents: number, currency: string): string {
  const code: Currency = currency === "USD" ? "USD" : "ARS";
  const amount = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: code,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
  return `${amount} ${currency}`;
}
