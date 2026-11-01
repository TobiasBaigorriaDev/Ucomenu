import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Firma de los avisos (webhooks) de Mercado Pago (ficha cobro-con-link-de-mercado-pago, ADR 0052). El encabezado `x-signature` trae
 * `ts=<milisegundos>,v1=<hex>`: el valor es el HMAC-SHA256, con la clave secreta de la aplicación, del texto
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` (el `data.id` sale de la URL del aviso; el que falte se omite del texto).
 * Se rechaza lo que no coincide (comparación en tiempo constante) y lo que está muy fuera de tiempo.
 *
 * La ventana es ancha A PROPÓSITO (un día): repetir un aviso viejo es inofensivo porque el servidor nunca confía en el cuerpo, vuelve a
 * pedirle el pago a la API de Mercado Pago y registrarlo es idempotente; en cambio una ventana corta rechazaría los reintentos de Mercado
 * Pago de un aviso que tardó en entregarse.
 */

export const SIGNATURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/**
 * El `ts` del encabezado no tiene una unidad confirmada: la documentación de Mercado Pago lo llama milisegundos y su SDK de Node lo
 * trata como segundos. El HMAC se calcula con el texto tal cual llega, así que la unidad solo importa para la ventana de tiempo: un
 * valor menor a 10^12 (en milisegundos sería antes de 2001) son segundos. Equivocarse acá rechazaría TODOS los avisos válidos.
 */
export function tsToMilliseconds(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

/** El texto que se firma. Mercado Pago pide el `data.id` en minúsculas cuando es alfanumérico. */
export function signatureManifest(input: { dataId: string | null | undefined; requestId: string | null | undefined; ts: string }): string {
  let manifest = "";
  if (input.dataId) manifest += `id:${input.dataId.toLowerCase()};`;
  if (input.requestId) manifest += `request-id:${input.requestId};`;
  manifest += `ts:${input.ts};`;
  return manifest;
}

/** Firma un aviso como lo hace Mercado Pago (para las pruebas y el servidor de mentira de los E2E). */
export function signMercadoPagoNotification(
  input: { dataId: string | null; requestId: string | null; ts: number },
  secret: string,
): string {
  const digest = createHmac("sha256", secret).update(signatureManifest({ ...input, ts: String(input.ts) })).digest("hex");
  return `ts=${input.ts},v1=${digest}`;
}

export function verifyMercadoPagoSignature(input: {
  header: string | null | undefined;
  requestId: string | null | undefined;
  dataId: string | null | undefined;
  secret: string;
  nowMs: number;
  toleranceMs?: number;
}): SignatureCheck {
  const header = input.header?.trim();
  if (!header) return { ok: false, reason: "missing" };

  let ts: string | null = null;
  let signature: string | null = null;
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "ts" && /^\d{1,16}$/.test(value)) ts = value;
    else if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) signature = value.toLowerCase();
  }
  if (ts === null || signature === null) return { ok: false, reason: "malformed" };

  const expected = createHmac("sha256", input.secret)
    .update(signatureManifest({ dataId: input.dataId, requestId: input.requestId, ts }))
    .digest();
  if (!timingSafeEqual(Buffer.from(signature, "hex"), expected)) return { ok: false, reason: "mismatch" };

  const tolerance = input.toleranceMs ?? SIGNATURE_TOLERANCE_MS;
  if (Math.abs(input.nowMs - tsToMilliseconds(Number(ts))) > tolerance) return { ok: false, reason: "stale" };
  return { ok: true };
}
