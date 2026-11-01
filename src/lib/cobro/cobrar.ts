import { PLAN_NAME } from "@/lib/entitlements";
import type { CobroDb, PaymentIntent } from "./base";
import { isAllowedCheckoutUrl, MercadoPagoApiError, type MercadoPagoClient, type MercadoPagoPayment } from "./mercadopago";

/**
 * Lógica del servidor del cobro con link de Mercado Pago (ficha cobro-con-link-de-mercado-pago, ADR 0052), sin base ni red propias:
 * recibe un `CobroDb` y un `MercadoPagoClient` para poder probarla con dobles. Reglas de fondo:
 *  - lo que decide es lo que dice la API de Mercado Pago sobre el pago, nunca el cuerpo de un aviso ni lo que mande el navegador;
 *  - el importe y la vigencia los pone la base (acá no se calcula ninguno);
 *  - un error transitorio se propaga (la ruta responde 5xx y Mercado Pago reintenta); uno determinista (datos que la base rechaza)
 *    se informa como `invalid` y no se reintenta.
 */

export type SettleOutcome =
  | "registered"
  | "already_registered"
  | "review"
  | "unknown_intent"
  | "reversal_flagged"
  | "reversal_recorded"
  | "not_found"
  | "ignored_status"
  | "ignored_reference"
  | "ignored_currency"
  | "invalid";

/** Códigos SQLSTATE de datos que la base rechaza por su forma: reintentar no cambia nada. */
const DETERMINISTIC = new Set(["22023", "22P02"]);

/** Aplica un pago ya leído de la API de Mercado Pago: lo registra si está aprobado o marca la reversión si se devolvió. */
export async function settlePayment(db: CobroDb, payment: MercadoPagoPayment): Promise<SettleOutcome> {
  if (payment.status === "refunded" || payment.status === "charged_back") {
    // Solo los pagos de esta aplicación (con una intención como referencia): no se guarda nada de pagos ajenos de la misma cuenta.
    if (!payment.externalReference) return "ignored_reference";
    const flagged = await db.flagReversal(payment.id, payment.status);
    if (!flagged.ok) return failureOutcome(flagged);
    return flagged.data === "flagged" ? "reversal_flagged" : "reversal_recorded";
  }
  if (payment.status !== "approved") return "ignored_status";
  if (!payment.externalReference) return "ignored_reference";
  if (payment.currency !== "ARS" && payment.currency !== "USD") return "ignored_currency";

  const registered = await db.registerPayment({
    intentId: payment.externalReference,
    paymentId: payment.id,
    amountCents: payment.amountCents,
    currency: payment.currency,
    paidAt: payment.approvedAt,
  });
  if (!registered.ok) return failureOutcome(registered);
  return registered.data.result;
}

function failureOutcome(failure: { code: string | null; message: string }): SettleOutcome {
  if (failure.code && DETERMINISTIC.has(failure.code)) {
    console.error(`[mercadopago] la base rechazó el pago por su forma: ${failure.message}`);
    return "invalid";
  }
  throw new Error(`la base no pudo registrar el pago: ${failure.message}`);
}

/** Pide el pago a la API y lo aplica. `not_found`: no existe para esta cuenta (404). */
export async function settlePaymentById(db: CobroDb, mp: MercadoPagoClient, paymentId: string): Promise<SettleOutcome> {
  const payment = await mp.getPayment(paymentId);
  if (!payment) return "not_found";
  return settlePayment(db, payment);
}

export type VerifyResult = { registered: number; review: number; pending: boolean };

/** «Ya pagué»: busca en Mercado Pago los pagos de esas intenciones (las sin pagar de los últimos días, aunque el link ya haya vencido) y aplica los aprobados. Idempotente. */
export async function verifyIntentPayments(db: CobroDb, mp: MercadoPagoClient, intentIds: string[]): Promise<VerifyResult> {
  const result: VerifyResult = { registered: 0, review: 0, pending: true };
  for (const intentId of intentIds) {
    const payments = (await mp.searchPayments(intentId)).filter((payment) => payment.externalReference === intentId.toLowerCase());
    for (const payment of payments) {
      const outcome = await settlePayment(db, payment);
      if (outcome === "registered") result.registered += 1;
      else if (outcome === "review") result.review += 1;
      if (outcome === "registered" || outcome === "already_registered" || outcome === "review") result.pending = false;
    }
  }
  return result;
}

export type StartError = "not_configured" | "forbidden" | "unavailable" | { notAvailable: string };
export type StartResult = { ok: true; url: string } | { ok: false; error: StartError };

/** El motivo por el que la base no ofrece cobrar (`payment_quote`): estos nombres son los de sus excepciones. */
const NOT_AVAILABLE = new Set(["suspended_manually", "no_list_price", "price_unavailable", "already_covered", "organization_inactive", "subscription_not_found"]);

export function paymentTitle(intent: Pick<PaymentIntent, "planCode" | "billingCycle" | "extraBranches">): string {
  const plan = PLAN_NAME[intent.planCode] ?? intent.planCode;
  const cycle = intent.billingCycle === "yearly" ? "anual" : "mensual";
  const extra = intent.extraBranches > 0 ? ` + ${intent.extraBranches} ${intent.extraBranches === 1 ? "sucursal adicional" : "sucursales adicionales"}` : "";
  return `UcoMenu · Plan ${plan} (${cycle})${extra}`;
}

/**
 * «Pagar»: la base crea o reutiliza la intención (con el importe congelado y comprobando que quien pide es Dueño), Mercado Pago crea el
 * link y la base lo guarda. Pedirlo dos veces devuelve el mismo link mientras la intención siga pendiente.
 */
export async function startPayment(input: {
  db: CobroDb;
  mp: MercadoPagoClient | null;
  apiBase: string;
  siteUrl: string | null;
  orgId: string;
  slug: string;
  userId: string;
}): Promise<StartResult> {
  const { db, mp, siteUrl } = input;
  if (!mp || !siteUrl) return { ok: false, error: "not_configured" };

  const started = await db.startIntent(input.orgId, input.userId);
  if (!started.ok) {
    if (started.message.includes("not_owner")) return { ok: false, error: "forbidden" };
    const reason = [...NOT_AVAILABLE].find((name) => started.message.includes(name));
    if (reason) return { ok: false, error: { notAvailable: reason } };
    console.error(`[mercadopago] no se pudo crear la intención de pago: ${started.message}`);
    return { ok: false, error: "unavailable" };
  }
  const intent = started.data;
  if (intent.checkoutUrl && isAllowedCheckoutUrl(intent.checkoutUrl, input.apiBase)) return { ok: true, url: intent.checkoutUrl };

  const back = `${siteUrl}/panel/${encodeURIComponent(input.slug)}/suscripcion`;
  let preference: { id: string; url: string };
  try {
    preference = await mp.createPreference({
      intentId: intent.intentId,
      title: paymentTitle(intent),
      amountCents: intent.amountCents,
      currency: intent.currency,
      expiresAt: new Date(intent.expiresAt),
      // `source_news=webhooks`: pide solo avisos firmados (no los IPN viejos, que no traen firma).
      notificationUrl: `${siteUrl}/api/mercadopago/webhook?source_news=webhooks`,
      backUrls: { success: `${back}?pago=exito`, pending: `${back}?pago=pendiente`, failure: `${back}?pago=fallo` },
    });
  } catch (error) {
    console.error(`[mercadopago] no se pudo crear el link: ${error instanceof MercadoPagoApiError ? error.message : "error inesperado"}`);
    return { ok: false, error: "unavailable" };
  }

  const attached = await db.attachPreference(intent.intentId, preference.id, preference.url);
  if (attached.ok && !attached.data) {
    // Otro pedido simultáneo guardó su link primero: se usa ese, para que no haya dos links vivos con la misma intención.
    const again = await db.startIntent(input.orgId, input.userId);
    if (again.ok && again.data.intentId === intent.intentId && again.data.checkoutUrl && isAllowedCheckoutUrl(again.data.checkoutUrl, input.apiBase)) {
      return { ok: true, url: again.data.checkoutUrl };
    }
  }
  return { ok: true, url: preference.url };
}
