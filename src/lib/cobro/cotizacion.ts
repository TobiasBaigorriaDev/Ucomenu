import { formatMoney } from "@/lib/admin/format";
import { PLAN_NAME } from "@/lib/entitlements";
import type { StartError } from "./cobrar";

/**
 * Lo que el Dueño va a pagar y los textos del cobro (ficha cobro-con-link-de-mercado-pago, ADR 0052). La cuenta la hace la base
 * (`owner_payment_quote`); acá solo se lee su respuesta y se la pone en palabras. Puro: se prueba en `cotizacion.test.ts`.
 */

export type PendingIntent = { id: string; expiresAt: string };

/** Las intenciones sin pagar de los últimos días (aunque su link haya vencido): lo que «Ya pagué, verificar» consulta. */
type Unpaid = PendingIntent[];

export type PaymentQuote =
  | {
      available: true;
      planCode: string;
      billingCycle: string;
      currency: string;
      planPriceCents: number;
      extraBranches: number;
      extraBranchUnitCents: number;
      amountCents: number;
      pending: PendingIntent | null;
      unpaid: Unpaid;
    }
  | { available: false; reason: string; pending: PendingIntent | null; unpaid: Unpaid };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Lee la respuesta de `owner_payment_quote`; `null` si no es del Dueño o no tiene la forma esperada (no se adivina un importe). */
export function parseQuote(raw: unknown): PaymentQuote | null {
  if (!isRecord(raw) || typeof raw.available !== "boolean") return null;
  const pendingRaw = raw.pending_intent;
  const pending: PendingIntent | null =
    isRecord(pendingRaw) && typeof pendingRaw.id === "string" && typeof pendingRaw.expires_at === "string"
      ? { id: pendingRaw.id, expiresAt: pendingRaw.expires_at }
      : null;

  const unpaid: Unpaid = Array.isArray(raw.unpaid_intents)
    ? raw.unpaid_intents.flatMap((item): PendingIntent[] =>
        isRecord(item) && typeof item.id === "string" && typeof item.expires_at === "string" ? [{ id: item.id, expiresAt: item.expires_at }] : [],
      )
    : [];

  if (!raw.available) return { available: false, reason: typeof raw.reason === "string" ? raw.reason : "unknown", pending, unpaid };

  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const planPrice = num(raw.plan_price_cents);
  const amount = num(raw.amount_cents);
  if (planPrice === null || amount === null || amount <= 0 || typeof raw.plan_code !== "string" || typeof raw.billing_cycle !== "string" || typeof raw.currency !== "string") return null;
  return {
    available: true,
    planCode: raw.plan_code,
    billingCycle: raw.billing_cycle,
    currency: raw.currency,
    planPriceCents: planPrice,
    extraBranches: num(raw.extra_branches) ?? 0,
    extraBranchUnitCents: num(raw.extra_branch_unit_cents) ?? 0,
    amountCents: amount,
    pending,
    unpaid,
  };
}

export type QuoteSummary = { total: string; period: string; lines: string[] };

/** El desglose para mostrar: «Plan Pro, mensual», «2 sucursales adicionales» y el total. */
export function describeQuote(quote: Extract<PaymentQuote, { available: true }>): QuoteSummary {
  const yearly = quote.billingCycle === "yearly";
  const lines = [`Plan ${PLAN_NAME[quote.planCode] ?? quote.planCode} ${yearly ? "anual" : "mensual"}: ${formatMoney(quote.planPriceCents, quote.currency)}`];
  if (quote.extraBranches > 0) {
    const label = quote.extraBranches === 1 ? "1 sucursal adicional" : `${quote.extraBranches} sucursales adicionales`;
    lines.push(`${label}: ${formatMoney(quote.extraBranches * quote.extraBranchUnitCents, quote.currency)}`);
  }
  return { total: formatMoney(quote.amountCents, quote.currency), period: yearly ? "por año" : "por mes", lines };
}

/**
 * ¿Hay algo que mostrar en el bloque de pago? Cuando no se puede ofrecer pagar y tampoco hay nada que decir (Premium sin precio de lista,
 * cuenta suspendida a mano, sin precio de la sucursal adicional...), el bloque no se muestra: un título solo, sin nada debajo, confunde.
 */
export function hasPayContent(quote: PaymentQuote, returned: unknown): boolean {
  return quote.available || quote.reason === "already_covered" || quote.unpaid.length > 0 || returnNotice(returned) !== null;
}

const NOT_AVAILABLE_MESSAGE: Record<string, string> = {
  suspended_manually: "Tu cuenta está suspendida por UcoMenú. Contactanos para resolverlo.",
  no_list_price: "Tu plan no se paga desde acá. Contactá a UcoMenú.",
  price_unavailable: "Tu plan no se paga desde acá. Contactá a UcoMenú.",
  already_covered: "Tu suscripción ya tiene un período pagado por adelantado. No hace falta pagar de nuevo.",
  too_many_unpaid: "Tenés muchos pedidos de pago sin confirmar. Si ya pagaste alguno, pulsá «Ya pagué, verificar»; si no se resuelve, contactá a UcoMenú.",
};
const GENERIC_NOT_AVAILABLE = "No pudimos preparar el pago para esta cuenta. Contactá a UcoMenú.";

export function startErrorMessage(error: StartError): string {
  if (typeof error === "object") return NOT_AVAILABLE_MESSAGE[error.notAvailable] ?? GENERIC_NOT_AVAILABLE;
  switch (error) {
    case "not_configured":
      return "El pago en línea todavía no está disponible. Contactá a UcoMenú.";
    case "forbidden":
      return "Solo el Dueño puede pagar la suscripción.";
    case "unavailable":
      return "No pudimos crear el link de pago. Probá de nuevo en unos minutos.";
  }
}

/** Qué se le dice al Dueño cuando vuelve de Mercado Pago o termina de verificar un pago (`?pago=`). */
export function returnNotice(raw: unknown): { tone: "info" | "warning"; text: string } | null {
  switch (raw) {
    case "exito":
      return { tone: "info", text: "Volviste de Mercado Pago. Estamos confirmando tu pago: puede tardar unos minutos. Si no se refleja, pulsá «Ya pagué, verificar»." };
    case "pendiente":
      return { tone: "info", text: "Tu pago quedó pendiente de acreditación en Mercado Pago. Cuando se apruebe, tu suscripción se actualiza sola." };
    case "fallo":
      return { tone: "warning", text: "El pago no se completó. No se te cobró nada: podés intentarlo de nuevo." };
    // Resultados de «Ya pagué, verificar».
    case "registrado":
      return { tone: "info", text: "¡Listo! Registramos tu pago y tu suscripción quedó al día." };
    case "ya_registrado":
      return { tone: "info", text: "Tu pago ya estaba registrado." };
    case "revision":
      return { tone: "warning", text: "Recibimos tu pago, pero UcoMenú tiene que revisarlo antes de actualizar tu suscripción. Te vamos a avisar." };
    default:
      return null;
  }
}
