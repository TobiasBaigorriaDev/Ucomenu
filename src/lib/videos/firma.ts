import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Firma de los webhooks de Mux (ficha videos-mux-parte-b). El encabezado `mux-signature` trae `t=<segundos>,v1=<hex>`: el
 * valor es el HMAC-SHA256, con el secreto del webhook, de `"<t>.<cuerpo crudo>"`. Se rechaza lo que no coincide (comparación en
 * tiempo constante) y lo que está fuera de la tolerancia de tiempo, para que un aviso capturado no se pueda repetir mucho después.
 */

/** Mux recomienda 5 minutos. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureCheck = { ok: true } | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

/** Firma un cuerpo como lo hace Mux (para las pruebas y el servidor de mentira de los E2E). */
export function signMuxPayload(body: string, secret: string, timestampSeconds: number): string {
  const digest = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
}

export function verifyMuxSignature(input: {
  body: string;
  header: string | null | undefined;
  secret: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}): SignatureCheck {
  const header = input.header?.trim();
  if (!header) return { ok: false, reason: "missing" };

  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t" && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    else if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase());
  }
  if (timestamp === null || signatures.length === 0) return { ok: false, reason: "malformed" };

  const expected = createHmac("sha256", input.secret).update(`${timestamp}.${input.body}`).digest();
  const matches = signatures.some((hex) => timingSafeEqual(Buffer.from(hex, "hex"), expected));
  if (!matches) return { ok: false, reason: "mismatch" };

  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(input.nowSeconds - timestamp) > tolerance) return { ok: false, reason: "stale" };
  return { ok: true };
}
