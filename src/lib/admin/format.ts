import type { Currency } from "./validation";

export const CYCLE_LABEL: Record<string, string> = { monthly: "mensual", yearly: "anual" };
export const METHOD_LABEL: Record<string, string> = {
  transfer: "Transferencia",
  payment_link: "Link de pago",
  cash: "Efectivo",
  other: "Otro medio",
};

/** Por qué un pago de Mercado Pago quedó a revisar (`payment_reviews.reason`), con qué hacer. */
export const REVIEW_REASON_LABEL: Record<string, string> = {
  amount_mismatch: "El importe pagado no coincide con el pedido. Reembolsá en Mercado Pago o registrá el pago a mano.",
  currency_mismatch: "La moneda del pago no coincide con el pedido. Reembolsá en Mercado Pago.",
  plan_changed: "El plan o el ciclo cambió entre el pedido y el pago. Registrá el pago a mano con el plan correcto o reembolsá.",
  intent_already_paid: "Ese pedido ya estaba pagado: es un pago doble. Reembolsá el segundo en Mercado Pago.",
  already_covered: "La cuenta ya tenía un período pagado por adelantado. Reembolsá en Mercado Pago o registrá la extensión a mano.",
  payment_reversed: "Mercado Pago reembolsó o revirtió un pago ya registrado. Si corresponde, anulalo desde la lista de pagos.",
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
