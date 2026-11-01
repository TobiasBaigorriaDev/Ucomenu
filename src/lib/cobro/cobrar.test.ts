import { describe, expect, it, vi } from "vitest";
import type { CobroDb, DbResult, PaymentIntent, RegisterOutcome } from "./base";
import { paymentTitle, settlePayment, settlePaymentById, startPayment, verifyIntentPayments } from "./cobrar";
import type { MercadoPagoClient, MercadoPagoPayment } from "./mercadopago";

const INTENT = "0b9c1c64-3a38-4a43-9d9e-0a2d1e9e0f11";
const REAL = "https://api.mercadopago.com";
const LINK = "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=p1";

const pago = (extra: Partial<MercadoPagoPayment> = {}): MercadoPagoPayment => ({
  id: "123456789",
  status: "approved",
  externalReference: INTENT,
  amountCents: 2_900_000,
  currency: "ARS",
  approvedAt: "2026-11-02T13:00:00.000Z",
  ...extra,
});
const intent = (extra: Partial<PaymentIntent> = {}): PaymentIntent => ({
  intentId: INTENT,
  amountCents: 2_900_000,
  currency: "ARS",
  planCode: "pro",
  billingCycle: "monthly",
  extraBranches: 0,
  expiresAt: "2026-11-05T12:00:00.000Z",
  preferenceId: null,
  checkoutUrl: null,
  ...extra,
});
const ok = <T>(data: T): DbResult<T> => ({ ok: true, data });
const fail = (message: string, code: string | null = null): DbResult<never> => ({ ok: false, code, message });

function fakeDb(over: Partial<CobroDb> = {}) {
  return {
    startIntent: vi.fn<CobroDb["startIntent"]>(over.startIntent ?? (async () => ok(intent()))),
    attachPreference: vi.fn<CobroDb["attachPreference"]>(over.attachPreference ?? (async () => ok(true))),
    registerPayment: vi.fn<CobroDb["registerPayment"]>(over.registerPayment ?? (async () => ok<RegisterOutcome>({ result: "registered" }))),
    flagReversal: vi.fn<CobroDb["flagReversal"]>(over.flagReversal ?? (async () => ok<"flagged" | "recorded">("flagged"))),
  };
}
function fakeMp(over: Partial<MercadoPagoClient> = {}) {
  return {
    createPreference: vi.fn(async () => ({ id: "p1", url: LINK })),
    getPayment: vi.fn(async () => pago()),
    searchPayments: vi.fn(async () => [pago()]),
    ...over,
  } satisfies MercadoPagoClient;
}

describe("aplicar un pago leído de Mercado Pago", () => {
  it("un pago aprobado se registra con lo que dice la API (importe, moneda, fecha) y la intención de su referencia", async () => {
    const db = fakeDb();
    expect(await settlePayment(db, pago())).toBe("registered");
    expect(db.registerPayment).toHaveBeenCalledWith({ intentId: INTENT, paymentId: "123456789", amountCents: 2_900_000, currency: "ARS", paidAt: "2026-11-02T13:00:00.000Z" });
  });

  it("devuelve lo que decidió la base (ya registrado, a revisar, intención desconocida)", async () => {
    for (const result of ["already_registered", "review", "unknown_intent"] as const) {
      expect(await settlePayment(fakeDb({ registerPayment: async () => ok({ result }) }), pago())).toBe(result);
    }
  });

  it("solo los pagos aprobados con referencia propia y moneda conocida llegan a la base", async () => {
    const db = fakeDb();
    for (const status of ["pending", "in_process", "rejected", "cancelled", "authorized", "in_mediation"]) {
      expect(await settlePayment(db, pago({ status }))).toBe("ignored_status");
    }
    expect(await settlePayment(db, pago({ externalReference: null }))).toBe("ignored_reference");
    expect(await settlePayment(db, pago({ currency: "BRL" }))).toBe("ignored_currency");
    expect(await settlePayment(db, pago({ currency: null }))).toBe("ignored_currency");
    expect(db.registerPayment).not.toHaveBeenCalled();
    expect(db.flagReversal).not.toHaveBeenCalled();
  });

  it("un reembolso o contracargo se marca a revisar y no se registra como pago", async () => {
    const db = fakeDb();
    expect(await settlePayment(db, pago({ status: "refunded" }))).toBe("reversal_flagged");
    expect(await settlePayment(db, pago({ status: "charged_back" }))).toBe("reversal_flagged");
    expect(db.flagReversal).toHaveBeenNthCalledWith(1, "123456789", "refunded");
    expect(db.flagReversal).toHaveBeenNthCalledWith(2, "123456789", "charged_back");
    // Si el pago todavía no estaba registrado, la base guarda la reversión para que el registro no renueve.
    expect(await settlePayment(fakeDb({ flagReversal: async () => ok("recorded") }), pago({ status: "refunded" }))).toBe("reversal_recorded");
    // Un reembolso de un pago ajeno a esta aplicación (sin intención como referencia) no se guarda.
    const ajeno = fakeDb();
    expect(await settlePayment(ajeno, pago({ status: "refunded", externalReference: null }))).toBe("ignored_reference");
    expect(ajeno.flagReversal).not.toHaveBeenCalled();
    expect(db.registerPayment).not.toHaveBeenCalled();
  });

  it("un fallo transitorio se propaga (Mercado Pago reintenta); uno de forma inválida no se reintenta", async () => {
    await expect(settlePayment(fakeDb({ registerPayment: async () => fail("connection reset") }), pago())).rejects.toThrow(/connection reset/);
    await expect(settlePayment(fakeDb({ registerPayment: async () => fail("deadlock", "40P01") }), pago())).rejects.toThrow(/deadlock/);
    await expect(settlePayment(fakeDb({ flagReversal: async () => fail("timeout") }), pago({ status: "refunded" }))).rejects.toThrow(/timeout/);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await settlePayment(fakeDb({ registerPayment: async () => fail("invalid_amount", "22023") }), pago())).toBe("invalid");
    spy.mockRestore();
  });

  it("por id: pide el pago a la API (no existe = not_found) y aplica lo que ella dice, nunca otra cosa", async () => {
    const db = fakeDb();
    const mp = fakeMp();
    expect(await settlePaymentById(db, mp, "123456789")).toBe("registered");
    expect(mp.getPayment).toHaveBeenCalledWith("123456789");
    expect(await settlePaymentById(db, fakeMp({ getPayment: async () => null }), "1")).toBe("not_found");
    await expect(settlePaymentById(db, fakeMp({ getPayment: async () => { throw new Error("Mercado Pago no respondió"); } }), "1")).rejects.toThrow();
  });
});

describe("«Ya pagué, verificar»", () => {
  it("aplica solo los pagos de ESA intención y cuenta lo registrado y lo que quedó a revisar", async () => {
    const otro = pago({ id: "2", externalReference: "99999999-3a38-4a43-9d9e-0a2d1e9e0f11" });
    const mp = fakeMp({ searchPayments: async () => [pago(), otro, pago({ id: "3", status: "pending" })] });
    const db = fakeDb();
    const result = await verifyIntentPayments(db, mp, [INTENT]);
    expect(result).toEqual({ registered: 1, review: 0, pending: false });
    expect(db.registerPayment).toHaveBeenCalledTimes(1);
    expect(db.registerPayment.mock.calls[0][0].paymentId).toBe("123456789");

    const revision = await verifyIntentPayments(fakeDb({ registerPayment: async () => ok({ result: "review", reason: "amount_mismatch" }) }), fakeMp(), [INTENT]);
    expect(revision).toEqual({ registered: 0, review: 1, pending: false });
    const ya = await verifyIntentPayments(fakeDb({ registerPayment: async () => ok({ result: "already_registered" }) }), fakeMp(), [INTENT]);
    expect(ya).toEqual({ registered: 0, review: 0, pending: false });
  });

  it("sin pagos aprobados sigue pendiente", async () => {
    expect(await verifyIntentPayments(fakeDb(), fakeMp({ searchPayments: async () => [] }), [INTENT])).toEqual({ registered: 0, review: 0, pending: true });
    expect(await verifyIntentPayments(fakeDb(), fakeMp({ searchPayments: async () => [pago({ status: "pending" })] }), [INTENT])).toEqual({ registered: 0, review: 0, pending: true });
    expect(await verifyIntentPayments(fakeDb(), fakeMp(), [])).toEqual({ registered: 0, review: 0, pending: true });
  });

  it("revisa TODAS las intenciones sin pagar (un pedido anterior, de un link ya vencido, también se recupera)", async () => {
    const VIEJA = "11111111-3a38-4a43-9d9e-0a2d1e9e0f11";
    const mp = fakeMp({
      searchPayments: async (reference) => (reference === VIEJA ? [pago({ id: "777", externalReference: VIEJA })] : []),
    });
    const db = fakeDb();
    expect(await verifyIntentPayments(db, mp, [INTENT, VIEJA])).toEqual({ registered: 1, review: 0, pending: false });
    expect(db.registerPayment.mock.calls.map((call) => call[0].intentId)).toEqual([VIEJA]);
  });
});

describe("«Pagar»", () => {
  const base = { apiBase: REAL, siteUrl: "https://ucomenu.com", orgId: "o", slug: "la-bestia", userId: "u" };

  it("sin Mercado Pago o sin dirección pública no hace nada", async () => {
    const db = fakeDb();
    expect(await startPayment({ ...base, db, mp: null })).toEqual({ ok: false, error: "not_configured" });
    expect(await startPayment({ ...base, db, mp: fakeMp(), siteUrl: null })).toEqual({ ok: false, error: "not_configured" });
    expect(db.startIntent).not.toHaveBeenCalled();
  });

  it("crea el link con el importe congelado por la base, guarda el link y devuelve adónde ir", async () => {
    const db = fakeDb();
    const mp = fakeMp();
    expect(await startPayment({ ...base, db, mp })).toEqual({ ok: true, url: LINK });
    expect(db.startIntent).toHaveBeenCalledWith("o", "u");
    expect(mp.createPreference).toHaveBeenCalledWith({
      intentId: INTENT,
      title: "UcoMenu · Plan Pro (mensual)",
      amountCents: 2_900_000,
      currency: "ARS",
      expiresAt: new Date("2026-11-05T12:00:00.000Z"),
      notificationUrl: "https://ucomenu.com/api/mercadopago/webhook?source_news=webhooks",
      backUrls: {
        success: "https://ucomenu.com/panel/la-bestia/suscripcion?pago=exito",
        pending: "https://ucomenu.com/panel/la-bestia/suscripcion?pago=pendiente",
        failure: "https://ucomenu.com/panel/la-bestia/suscripcion?pago=fallo",
      },
    });
    expect(db.attachPreference).toHaveBeenCalledWith(INTENT, "p1", LINK);
  });

  it("si la intención ya tiene link, lo reutiliza sin crear otro en Mercado Pago", async () => {
    const db = fakeDb({ startIntent: async () => ok(intent({ preferenceId: "p0", checkoutUrl: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=p0" })) });
    const mp = fakeMp();
    expect(await startPayment({ ...base, db, mp })).toEqual({ ok: true, url: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=p0" });
    expect(mp.createPreference).not.toHaveBeenCalled();
  });

  it("un link guardado que no es de Mercado Pago no se usa: se pide uno nuevo", async () => {
    const db = fakeDb({ startIntent: async () => ok(intent({ checkoutUrl: "https://evil.example.com/pagar" })) });
    const mp = fakeMp();
    expect(await startPayment({ ...base, db, mp })).toEqual({ ok: true, url: LINK });
    expect(mp.createPreference).toHaveBeenCalledTimes(1);
  });

  it("traduce lo que la base no ofrece cobrar y a quién no es Dueño, sin llamar a Mercado Pago", async () => {
    const mp = fakeMp();
    const con = (message: string) => startPayment({ ...base, db: fakeDb({ startIntent: async () => fail(message, message === "not_owner" ? "42501" : "55000") }), mp });
    expect(await con("not_owner")).toEqual({ ok: false, error: "forbidden" });
    for (const reason of ["suspended_manually", "no_list_price", "price_unavailable", "already_covered", "organization_inactive", "subscription_not_found"]) {
      expect(await con(reason)).toEqual({ ok: false, error: { notAvailable: reason } });
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await con("algo raro")).toEqual({ ok: false, error: "unavailable" });
    spy.mockRestore();
    expect(mp.createPreference).not.toHaveBeenCalled();
  });

  it("si Mercado Pago falla no deja nada a medias: no se guarda ningún link", async () => {
    const db = fakeDb();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mp = fakeMp({ createPreference: async () => { throw new Error("caído"); } });
    expect(await startPayment({ ...base, db, mp })).toEqual({ ok: false, error: "unavailable" });
    spy.mockRestore();
    expect(db.attachPreference).not.toHaveBeenCalled();
  });

  it("si otro pedido simultáneo guardó su link primero, usa ese", async () => {
    const ganador = "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=ganador";
    const startIntent = vi.fn<CobroDb["startIntent"]>().mockResolvedValueOnce(ok(intent())).mockResolvedValueOnce(ok(intent({ checkoutUrl: ganador })));
    const db = fakeDb({ startIntent, attachPreference: async () => ok(false) });
    expect(await startPayment({ ...base, db, mp: fakeMp() })).toEqual({ ok: true, url: ganador });
  });

  it("el título cuenta el plan, el ciclo y las sucursales adicionales", () => {
    expect(paymentTitle({ planCode: "pro", billingCycle: "yearly", extraBranches: 2 })).toBe("UcoMenu · Plan Pro (anual) + 2 sucursales adicionales");
    expect(paymentTitle({ planCode: "basic", billingCycle: "monthly", extraBranches: 1 })).toBe("UcoMenu · Plan Básico (mensual) + 1 sucursal adicional");
  });
});
