import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Las funciones de base del cobro con Mercado Pago (ADR 0052), con su contrato tipado. Todas las ejecuta SOLO `service_role`: el
 * servidor las llama con `createAdminClient()` después de comprobar quién pide (el Dueño con su sesión) o de verificar el aviso contra
 * la API de Mercado Pago. Este módulo existe para poder probar la lógica del servidor sin base (`CobroDb` se reemplaza por un doble).
 */

export type DbResult<T> = { ok: true; data: T } | { ok: false; code: string | null; message: string };

export type PaymentIntent = {
  intentId: string;
  amountCents: number;
  currency: string;
  planCode: string;
  billingCycle: string;
  extraBranches: number;
  expiresAt: string;
  preferenceId: string | null;
  checkoutUrl: string | null;
};

export type RegisterOutcome = {
  result: "registered" | "already_registered" | "review" | "unknown_intent";
  reason?: string;
};

export interface CobroDb {
  startIntent(orgId: string, userId: string): Promise<DbResult<PaymentIntent>>;
  attachPreference(intentId: string, preferenceId: string, checkoutUrl: string): Promise<DbResult<boolean>>;
  registerPayment(input: { intentId: string; paymentId: string; amountCents: number; currency: string; paidAt: string | null }): Promise<DbResult<RegisterOutcome>>;
  /** `flagged`: el pago ya estaba registrado y queda a revisar. `recorded`: todavía no estaba; el registro verá la reversión y no renovará. */
  flagReversal(paymentId: string, status: "refunded" | "charged_back"): Promise<DbResult<"flagged" | "recorded">>;
}

const RESULTS = new Set(["registered", "already_registered", "review", "unknown_intent"]);

function failure(error: { code?: string; message: string }): { ok: false; code: string | null; message: string } {
  return { ok: false, code: error.code ?? null, message: error.message };
}

function parseIntent(raw: unknown): PaymentIntent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.intent_id !== "string" || typeof d.amount_cents !== "number" || typeof d.currency !== "string") return null;
  return {
    intentId: d.intent_id,
    amountCents: d.amount_cents,
    currency: d.currency,
    planCode: typeof d.plan_code === "string" ? d.plan_code : "",
    billingCycle: typeof d.billing_cycle === "string" ? d.billing_cycle : "",
    extraBranches: typeof d.extra_branches === "number" ? d.extra_branches : 0,
    expiresAt: typeof d.expires_at === "string" ? d.expires_at : "",
    preferenceId: typeof d.preference_id === "string" ? d.preference_id : null,
    checkoutUrl: typeof d.checkout_url === "string" ? d.checkout_url : null,
  };
}

/** Las funciones de base sobre el cliente real. */
export function createCobroDb(admin: SupabaseClient<Database>): CobroDb {
  return {
    async startIntent(orgId, userId) {
      const { data, error } = await admin.rpc("system_start_payment_intent", { p_org: orgId, p_user: userId });
      if (error) return failure(error);
      const intent = parseIntent(data);
      return intent ? { ok: true, data: intent } : { ok: false, code: null, message: "respuesta ilegible" };
    },
    async attachPreference(intentId, preferenceId, checkoutUrl) {
      const { data, error } = await admin.rpc("system_attach_payment_preference", { p_intent: intentId, p_preference_id: preferenceId, p_checkout_url: checkoutUrl });
      if (error) return failure(error);
      return { ok: true, data: data === true };
    },
    async registerPayment({ intentId, paymentId, amountCents, currency, paidAt }) {
      const { data, error } = await admin.rpc("system_register_mp_payment", {
        p_intent: intentId,
        p_provider_payment_id: paymentId,
        p_amount_cents: amountCents,
        p_currency: currency,
        // La base usa «ahora» cuando no hay fecha.
        p_paid_at: paidAt as string,
      });
      if (error) return failure(error);
      const result = typeof data === "object" && data !== null ? (data as { result?: unknown; reason?: unknown }) : {};
      if (typeof result.result !== "string" || !RESULTS.has(result.result)) return { ok: false, code: null, message: "respuesta ilegible" };
      return { ok: true, data: { result: result.result as RegisterOutcome["result"], reason: typeof result.reason === "string" ? result.reason : undefined } };
    },
    async flagReversal(paymentId, status) {
      const { data, error } = await admin.rpc("system_flag_mp_reversal", { p_provider_payment_id: paymentId, p_status: status });
      if (error) return failure(error);
      return { ok: true, data: data === "flagged" ? "flagged" : "recorded" };
    },
  };
}
