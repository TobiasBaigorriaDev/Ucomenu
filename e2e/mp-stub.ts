import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * Un Mercado Pago de mentira para los E2E (ficha cobro-con-link-de-mercado-pago, ADR 0052): el servidor de pruebas apunta a él con
 * `MERCADOPAGO_API_URL` (la app solo acepta una URL de la propia máquina), así ninguna prueba toca el Mercado Pago real ni cobra nada.
 * Implementa lo que usa el cliente —crear una preferencia, leer un pago y buscar pagos por referencia— más la página de «checkout»
 * a la que se manda al Dueño, y anota cada llamada. Las pruebas cargan los pagos que quieren que «exista» por `/__payments`: el
 * aviso (webhook) se manda firmado desde la prueba, como lo mandaría Mercado Pago. Lo levanta `e2e/global-setup.ts` una sola vez.
 */

export const MP_STUB_PORT = Number(process.env.MP_STUB_PORT ?? 4012);
export const MP_STUB_URL = `http://127.0.0.1:${MP_STUB_PORT}`;

/** Credenciales de pruebas: el servidor de E2E las usa en lugar de las reales de `.env.local`. */
export const E2E_MP = {
  accessToken: "e2e-mp-access-token",
  webhookSecret: "e2e-mp-webhook-secret-0123456789",
} as const;

export type MpPreference = { id: string; body: Record<string, unknown> };

function send(response: ServerResponse, status: number, body?: unknown, type = "application/json") {
  response.writeHead(status, body === undefined ? {} : { "Content-Type": type });
  response.end(body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function startMpStub(): Promise<{ close: () => Promise<void> }> {
  const preferences = new Map<string, MpPreference>();
  const payments = new Map<string, Record<string, unknown>>();
  let counter = 0;
  const expectedAuth = `Bearer ${E2E_MP.accessToken}`;

  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", MP_STUB_URL);
    const path = url.pathname;
    const method = request.method ?? "GET";

    // Control para las pruebas (sin credenciales).
    const preferenceOf = /^\/__preferences\/([^/]+)$/.exec(path);
    if (preferenceOf && method === "GET") {
      const found = preferences.get(decodeURIComponent(preferenceOf[1]));
      return found ? send(response, 200, found) : send(response, 404, { error: "no existe" });
    }
    if (path === "/__payments" && method === "POST") {
      const payment = JSON.parse((await readBody(request)) || "{}") as Record<string, unknown>;
      payments.set(String(payment.id), payment);
      return send(response, 201, payment);
    }

    // La página a la que se manda al Dueño (la real es de Mercado Pago; acá basta con que exista).
    if (/^\/checkout\/[^/]+$/.test(path) && method === "GET") {
      return send(response, 200, "<!doctype html><title>Checkout simulado</title><h1>Checkout simulado</h1>", "text/html; charset=utf-8");
    }

    // La API de Mercado Pago exige las credenciales.
    if (request.headers.authorization !== expectedAuth) return send(response, 401, { message: "invalid access token" });

    if (path === "/checkout/preferences" && method === "POST") {
      const body = JSON.parse((await readBody(request)) || "{}") as Record<string, unknown>;
      counter += 1;
      const id = `pref-stub-${counter}-${Math.random().toString(36).slice(2, 8)}`;
      preferences.set(id, { id, body });
      return send(response, 201, { id, init_point: `${MP_STUB_URL}/checkout/${id}` });
    }

    if (path === "/v1/payments/search" && method === "GET") {
      const reference = url.searchParams.get("external_reference");
      return send(response, 200, { results: [...payments.values()].filter((payment) => payment.external_reference === reference) });
    }

    const paymentOf = /^\/v1\/payments\/(\d+)$/.exec(path);
    if (paymentOf && method === "GET") {
      const found = payments.get(paymentOf[1]);
      return found ? send(response, 200, found) : send(response, 404, { message: "Payment not found" });
    }

    return send(response, 404, { error: "no existe" });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(MP_STUB_PORT, "127.0.0.1", () => {
      resolve({ close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

// ---------------------------------------------------------------------------
// Para las pruebas: consultar y controlar el servidor de mentira desde el proceso de la prueba.
// ---------------------------------------------------------------------------

export async function stubPreference(preferenceId: string): Promise<MpPreference> {
  const response = await fetch(`${MP_STUB_URL}/__preferences/${encodeURIComponent(preferenceId)}`);
  if (!response.ok) throw new Error(`El Mercado Pago de mentira no conoce la preferencia ${preferenceId}`);
  return (await response.json()) as MpPreference;
}

/** Hace que «exista» un pago en el Mercado Pago de mentira. */
export async function stubPayment(payment: { id: string; externalReference: string; amountCents: number; status?: string; currency?: string }): Promise<void> {
  const response = await fetch(`${MP_STUB_URL}/__payments`, {
    method: "POST",
    body: JSON.stringify({
      id: payment.id,
      status: payment.status ?? "approved",
      external_reference: payment.externalReference,
      transaction_amount: payment.amountCents / 100,
      currency_id: payment.currency ?? "ARS",
      date_approved: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error("No se pudo cargar el pago en el Mercado Pago de mentira");
}
