import { describe, expect, it } from "vitest";
import { createMercadoPagoClient, isAllowedCheckoutUrl, mercadoPagoConfig, MercadoPagoApiError, parsePayment, resolveApiBase, siteBaseUrl } from "./mercadopago";

const INTENT = "0b9c1c64-3a38-4a43-9d9e-0a2d1e9e0f11";
const CONFIG = { accessToken: "APP_USR-secreto", apiBase: "https://api.mercadopago.com" };

type Call = { url: string; init: RequestInit };
function fakeFetch(responder: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return responder(call);
  };
  return { calls, fetchImpl };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const payment = (extra: Record<string, unknown> = {}) => ({ id: 123456789, status: "approved", external_reference: INTENT, transaction_amount: 29000, currency_id: "ARS", date_approved: "2026-11-02T10:00:00.000-03:00", ...extra });

describe("configuración", () => {
  it("sin token no hay cliente; la API solo se redirige a la propia máquina", () => {
    expect(mercadoPagoConfig({})).toBeNull();
    expect(mercadoPagoConfig({ MERCADOPAGO_ACCESS_TOKEN: "  " })).toBeNull();
    expect(mercadoPagoConfig({ MERCADOPAGO_ACCESS_TOKEN: "t" })).toEqual({ accessToken: "t", apiBase: "https://api.mercadopago.com" });
    expect(resolveApiBase("http://127.0.0.1:4010/algo")).toBe("http://127.0.0.1:4010");
    expect(resolveApiBase("http://localhost:4010")).toBe("http://localhost:4010");
    // Una variable mal puesta no puede mandar el token a otro host.
    expect(resolveApiBase("https://evil.example.com")).toBe("https://api.mercadopago.com");
    expect(resolveApiBase("ftp://localhost")).toBe("https://api.mercadopago.com");
    expect(resolveApiBase("no es una url")).toBe("https://api.mercadopago.com");
  });

  it("la dirección pública debe ser http(s) y se normaliza sin barra final", () => {
    expect(siteBaseUrl({ NEXT_PUBLIC_SITE_URL: "https://ucomenu.com/" })).toBe("https://ucomenu.com");
    expect(siteBaseUrl({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000/panel" })).toBe("http://localhost:3000");
    expect(siteBaseUrl({ NEXT_PUBLIC_SITE_URL: "javascript:alert(1)" })).toBeNull();
    expect(siteBaseUrl({})).toBeNull();
  });

  it("solo se manda al Dueño a Mercado Pago (o a la API de pruebas de esta máquina)", () => {
    const real = "https://api.mercadopago.com";
    expect(isAllowedCheckoutUrl("https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=1", real)).toBe(true);
    expect(isAllowedCheckoutUrl("https://mercadopago.com/x", real)).toBe(true);
    for (const malo of [
      "http://www.mercadopago.com.ar/x",
      "https://evil.com/mercadopago.com.ar",
      "https://mercadopago.com.ar.evil.com/x",
      "https://www.mercadopago.com.ru/x",
      "https://evilmercadopago.com/x",
      "javascript:alert(1)",
      "http://127.0.0.1:4010/x",
      "no es una url",
    ]) {
      expect(isAllowedCheckoutUrl(malo, real), malo).toBe(false);
    }
    expect(isAllowedCheckoutUrl("http://127.0.0.1:4010/checkout", "http://127.0.0.1:4010")).toBe(true);
    expect(isAllowedCheckoutUrl("http://127.0.0.1:9999/checkout", "http://127.0.0.1:4010")).toBe(false);
  });
});

describe("lectura de un pago", () => {
  it("toma el importe en centavos y la referencia en minúsculas", () => {
    expect(parsePayment(payment())).toEqual({
      id: "123456789",
      status: "approved",
      externalReference: INTENT,
      amountCents: 2_900_000,
      currency: "ARS",
      approvedAt: "2026-11-02T10:00:00.000-03:00",
    });
    expect(parsePayment(payment({ external_reference: INTENT.toUpperCase() }))?.externalReference).toBe(INTENT);
    expect(parsePayment(payment({ transaction_amount: 29000.5 }))?.amountCents).toBe(2_900_050);
    expect(parsePayment(payment({ transaction_amount: 0.1 + 0.2 }))?.amountCents).toBe(30);
  });

  it("una referencia que no es de la aplicación queda sin referencia; lo ilegible es null", () => {
    expect(parsePayment(payment({ external_reference: "pedido-77" }))?.externalReference).toBeNull();
    expect(parsePayment(payment({ external_reference: null }))?.externalReference).toBeNull();
    for (const malo of [null, "x", [], {}, payment({ id: "abc" }), payment({ id: "1; drop" }), payment({ status: 1 }), payment({ transaction_amount: "29000" }), payment({ transaction_amount: -5 }), payment({ transaction_amount: 0 }), payment({ transaction_amount: Number.NaN })]) {
      expect(parsePayment(malo), JSON.stringify(malo)).toBeNull();
    }
  });
});

describe("cliente", () => {
  const input = {
    intentId: INTENT,
    title: "UcoMenu · Plan Pro (mensual)",
    amountCents: 2_900_000,
    currency: "ARS",
    expiresAt: new Date("2026-11-05T12:00:00.000Z"),
    notificationUrl: "https://ucomenu.com/api/mercadopago/webhook?source_news=webhooks",
    backUrls: { success: "https://ucomenu.com/p?pago=exito", pending: "https://ucomenu.com/p?pago=pendiente", failure: "https://ucomenu.com/p?pago=fallo" },
  };

  it("crea el link con el importe, la referencia y el vencimiento, y devuelve solo un link de Mercado Pago", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ id: "pref-1", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1" }, 201));
    const result = await createMercadoPagoClient(CONFIG, fetchImpl).createPreference(input);
    expect(result).toEqual({ id: "pref-1", url: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.mercadopago.com/checkout/preferences");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer APP_USR-secreto");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({
      external_reference: INTENT,
      items: [{ id: INTENT, quantity: 1, currency_id: "ARS", unit_price: 29000 }],
      notification_url: input.notificationUrl,
      expires: true,
      expiration_date_to: "2026-11-05T12:00:00.000Z",
      auto_return: "approved",
    });
    // Nada del comprador viaja en el pedido.
    expect(JSON.stringify(body)).not.toMatch(/payer|email/);
  });

  it("sin https en el retorno no pide regreso automático (Mercado Pago lo rechazaría)", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ id: "p", init_point: "http://127.0.0.1:4010/checkout" }));
    const local = { accessToken: "t", apiBase: "http://127.0.0.1:4010" };
    await createMercadoPagoClient(local, fetchImpl).createPreference({ ...input, backUrls: { success: "http://localhost:3000/p", pending: "http://localhost:3000/p", failure: "http://localhost:3000/p" } });
    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty("auto_return");
  });

  it("falla ante un link de otro sitio, una respuesta ilegible o un rechazo, sin mostrar el token", async () => {
    const mp = (response: () => Response) => createMercadoPagoClient(CONFIG, fakeFetch(response).fetchImpl);
    await expect(mp(() => json({ id: "p", init_point: "https://evil.example.com/pagar" })).createPreference(input)).rejects.toThrow(/no es suyo/);
    await expect(mp(() => json({ id: 5 })).createPreference(input)).rejects.toThrow(/ilegible/);
    const rechazo = await mp(() => json({ message: "bad" }, 400)).createPreference(input).catch((e: unknown) => e);
    expect(rechazo).toBeInstanceOf(MercadoPagoApiError);
    expect((rechazo as MercadoPagoApiError).status).toBe(400);
    const red = await createMercadoPagoClient(CONFIG, async () => { throw new Error("ECONNRESET Bearer APP_USR-secreto"); }).createPreference(input).catch((e: unknown) => e);
    expect((red as MercadoPagoApiError).status).toBe(0);
    expect(String((red as Error).message)).not.toContain("APP_USR-secreto");
  });

  it("lee un pago por id (404 = no existe) y busca por referencia ignorando lo ilegible", async () => {
    const { calls, fetchImpl } = fakeFetch(({ url }) => {
      if (url.endsWith("/v1/payments/404")) return json({}, 404);
      if (url.endsWith("/v1/payments/500")) return json({}, 500);
      if (url.includes("/v1/payments/search")) return json({ results: [payment(), { id: "x" }, payment({ id: 2, status: "rejected" })] });
      return json(payment());
    });
    const mp = createMercadoPagoClient(CONFIG, fetchImpl);
    expect((await mp.getPayment("123456789"))?.amountCents).toBe(2_900_000);
    expect(await mp.getPayment("404")).toBeNull();
    await expect(mp.getPayment("500")).rejects.toBeInstanceOf(MercadoPagoApiError);
    // Un id que no es numérico ni se consulta (no se arma una ruta con lo que mande un aviso).
    expect(await mp.getPayment("../../users")).toBeNull();
    expect(calls.map((c) => c.url).some((u) => u.includes(".."))).toBe(false);

    const found = await mp.searchPayments(INTENT);
    expect(found.map((p) => p.id)).toEqual(["123456789", "2"]);
    expect(calls.at(-1)?.url).toContain(`external_reference=${INTENT}`);
    expect(await mp.searchPayments("no-es-uuid")).toEqual([]);
  });
});
