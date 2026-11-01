/**
 * Cliente mínimo de la API de Mercado Pago (ficha cobro-con-link-de-mercado-pago, ADR 0052). Tres llamadas, con `fetch`: no hay
 * dependencia nueva. El token de acceso (`MERCADOPAGO_ACCESS_TOKEN`) vive solo en el servidor y nunca sale en un mensaje de error.
 */

export type MercadoPagoPayment = {
  id: string;
  status: string;
  /** El id de la intención de pago (lo mandamos al crear la preferencia). */
  externalReference: string | null;
  /** Lo que pagó el comprador, en centavos (`transaction_amount`, sin intereses de cuotas). */
  amountCents: number;
  currency: string | null;
  approvedAt: string | null;
};

export type CreatePreferenceInput = {
  intentId: string;
  title: string;
  amountCents: number;
  currency: string;
  expiresAt: Date;
  notificationUrl: string;
  backUrls: { success: string; pending: string; failure: string };
};

export interface MercadoPagoClient {
  /** Crea el link de pago (Checkout Pro). `url` es adonde se manda al Dueño. */
  createPreference(input: CreatePreferenceInput): Promise<{ id: string; url: string }>;
  /** El pago tal como lo ve Mercado Pago, o `null` si no existe (404). */
  getPayment(paymentId: string): Promise<MercadoPagoPayment | null>;
  /** Los pagos de una referencia externa (la intención), del más nuevo al más viejo. */
  searchPayments(externalReference: string): Promise<MercadoPagoPayment[]>;
}

/** Un fallo de la API de Mercado Pago (o de la red, con `status` 0). */
export class MercadoPagoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MercadoPagoApiError";
  }
}

export type MercadoPagoConfig = { accessToken: string; apiBase: string };

const DEFAULT_API_BASE = "https://api.mercadopago.com";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const REQUEST_TIMEOUT_MS = 15_000;
const PAYMENT_ID = /^[0-9]{1,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dónde está la API. Solo el valor por defecto, salvo que `MERCADOPAGO_API_URL` apunte a la PROPIA máquina (pruebas con un servidor de
 * mentira): así el token no puede enviarse a otro host por una variable mal puesta o manipulada.
 */
export function resolveApiBase(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_API_BASE;
  try {
    const url = new URL(value);
    if ((url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTS.has(url.hostname)) return url.origin;
  } catch {
    // cae al valor por defecto
  }
  return DEFAULT_API_BASE;
}

/** La configuración de Mercado Pago del servidor, o `null` si falta el token. */
export function mercadoPagoConfig(env: Record<string, string | undefined> = process.env): MercadoPagoConfig | null {
  const accessToken = env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!accessToken) return null;
  return { accessToken, apiBase: resolveApiBase(env.MERCADOPAGO_API_URL) };
}

/** El secreto de firma de los avisos, o `null` si falta (sin él no se procesa ningún aviso). */
export function mercadoPagoWebhookSecret(env: Record<string, string | undefined> = process.env): string | null {
  return env.MERCADOPAGO_WEBHOOK_SECRET?.trim() || null;
}

/**
 * La dirección pública de la app sin barra final, o `null` si falta o no es http(s). De ahí salen el aviso y el retorno.
 *
 * Ojo con cómo llega el valor: `NEXT_PUBLIC_SITE_URL` es un `ARG` del Dockerfile, o sea que existe SOLO al construir la imagen, y Next
 * la incrusta reemplazando la forma LITERAL `process.env.NEXT_PUBLIC_SITE_URL`; en el contenedor ya no es una variable de entorno. Leerla
 * solo por acceso dinámico (`env.NEXT_PUBLIC_SITE_URL`) devolvería `undefined` en staging y producción y «Pagar» no aparecería nunca.
 * Por eso, con el entorno real, se prueba la variable de ejecución (dev, pruebas) y, si no hay, el valor incrustado al construir.
 */
export function siteBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = (env.NEXT_PUBLIC_SITE_URL ?? (env === process.env ? process.env.NEXT_PUBLIC_SITE_URL : undefined))?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** ¿Es una dirección a la que se puede mandar al Dueño? Solo Mercado Pago (o la propia máquina cuando la API es la de pruebas). */
export function isAllowedCheckoutUrl(raw: string, apiBase: string): boolean {
  try {
    const url = new URL(raw);
    // Lista cerrada de hosts (nada de comodines por país: un dominio de tercer nivel de otro país no es de Mercado Pago).
    if (url.protocol === "https:" && /^(www\.)?mercadopago\.(com|com\.ar)$/.test(url.hostname)) return true;
    return apiBase !== DEFAULT_API_BASE && LOOPBACK_HOSTS.has(url.hostname) && url.origin === new URL(apiBase).origin;
  } catch {
    return false;
  }
}

/** Lee un pago de la respuesta de la API; `null` si no tiene la forma esperada (no se adivina nada). */
export function parsePayment(raw: unknown): MercadoPagoPayment | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as Record<string, unknown>;
  const id = typeof data.id === "number" || typeof data.id === "string" ? String(data.id) : "";
  if (!PAYMENT_ID.test(id) || typeof data.status !== "string") return null;
  const amount = typeof data.transaction_amount === "number" ? data.transaction_amount : Number.NaN;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) return null;
  const reference = typeof data.external_reference === "string" && UUID.test(data.external_reference) ? data.external_reference.toLowerCase() : null;
  return {
    id,
    status: data.status,
    externalReference: reference,
    // Mercado Pago informa pesos con hasta dos decimales: se redondea al centavo y la base compara contra la intención.
    amountCents: Math.round(amount * 100),
    currency: typeof data.currency_id === "string" ? data.currency_id : null,
    approvedAt: typeof data.date_approved === "string" ? data.date_approved : null,
  };
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function createMercadoPagoClient(config: MercadoPagoConfig, fetchImpl: FetchLike = fetch): MercadoPagoClient {
  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    try {
      return await fetchImpl(`${config.apiBase}${path}`, {
        method,
        headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // Solo el motivo de la red: nunca el pedido ni el encabezado con el token.
      throw new MercadoPagoApiError(`Mercado Pago no respondió: ${error instanceof Error ? error.name : "error"}`, 0);
    }
  }

  return {
    async createPreference(input) {
      const https = input.backUrls.success.startsWith("https://");
      const response = await call("POST", "/checkout/preferences", {
        items: [
          {
            id: input.intentId,
            title: input.title.slice(0, 120),
            quantity: 1,
            currency_id: input.currency,
            unit_price: input.amountCents / 100,
          },
        ],
        external_reference: input.intentId,
        notification_url: input.notificationUrl,
        back_urls: input.backUrls,
        // Mercado Pago solo acepta el regreso automático con direcciones https.
        ...(https ? { auto_return: "approved" } : {}),
        expires: true,
        expiration_date_to: input.expiresAt.toISOString(),
        statement_descriptor: "UCOMENU",
      });
      if (!response.ok) throw new MercadoPagoApiError(`Mercado Pago rechazó crear el link (${response.status})`, response.status);
      const json: unknown = await response.json().catch(() => null);
      const data = typeof json === "object" && json !== null ? (json as { id?: unknown; init_point?: unknown }) : {};
      if (typeof data.id !== "string" || typeof data.init_point !== "string") {
        throw new MercadoPagoApiError("Mercado Pago devolvió un link ilegible", response.status);
      }
      if (!isAllowedCheckoutUrl(data.init_point, config.apiBase)) {
        throw new MercadoPagoApiError("Mercado Pago devolvió un link de un sitio que no es suyo", response.status);
      }
      return { id: data.id, url: data.init_point };
    },

    async getPayment(paymentId) {
      if (!PAYMENT_ID.test(paymentId)) return null;
      const response = await call("GET", `/v1/payments/${paymentId}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new MercadoPagoApiError(`Mercado Pago rechazó leer el pago (${response.status})`, response.status);
      return parsePayment(await response.json().catch(() => null));
    },

    async searchPayments(externalReference) {
      if (!UUID.test(externalReference)) return [];
      const query = new URLSearchParams({ external_reference: externalReference, sort: "date_created", criteria: "desc", limit: "20" });
      const response = await call("GET", `/v1/payments/search?${query.toString()}`);
      if (!response.ok) throw new MercadoPagoApiError(`Mercado Pago rechazó buscar pagos (${response.status})`, response.status);
      const json: unknown = await response.json().catch(() => null);
      const results = typeof json === "object" && json !== null ? (json as { results?: unknown }).results : undefined;
      if (!Array.isArray(results)) return [];
      return results.map(parsePayment).filter((payment): payment is MercadoPagoPayment => payment !== null);
    },
  };
}

/** El cliente de Mercado Pago del servidor, o `null` si no está configurado. */
export function getMercadoPagoClient(): MercadoPagoClient | null {
  const config = mercadoPagoConfig();
  return config ? createMercadoPagoClient(config) : null;
}
