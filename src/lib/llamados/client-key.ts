import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";

/**
 * Identificador de cliente para el límite por frecuencia del llamado (ADR 0010).
 *
 * La IP del comensal NUNCA se guarda ni se registra: el servidor calcula un HMAC-SHA256 de la IP con un secreto de
 * servidor y manda a la base solo los primeros 32 caracteres hexadecimales. Sin el secreto el valor no se puede
 * revertir recorriendo el espacio de IPv4. Es una defensa de segunda línea: quien llame a la API directo puede
 * elegir ese valor (decisión del usuario, ADR 0010); el tope duro está por mesa en la base.
 */

/** Secreto efímero por proceso para cuando `WAITER_CALL_CLIENT_SECRET` no está definida (desarrollo y pruebas). */
const ephemeralSecret = randomBytes(32).toString("hex");

export const CLIENT_KEY_PATTERN = /^[0-9a-f]{32}$/;

/** `WAITER_CALL_CLIENT_SECRET` si está definida; si no, un secreto efímero (el límite vale solo dentro de cada proceso). */
export function clientSecret(env: Record<string, string | undefined> = process.env): string {
  const configured = env.WAITER_CALL_CLIENT_SECRET?.trim();
  return configured && configured.length >= 16 ? configured : ephemeralSecret;
}

export function clientKeyFromIp(ip: string, secret: string = clientSecret()): string {
  return createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32);
}

/**
 * IP del comensal según las cabeceras del pedido: la primera de `x-forwarded-for` (el cliente, si el *proxy* de
 * entrada la reescribe) o `x-real-ip`. Solo se acepta una IP válida; cualquier otra cosa es `null` (sin límite por
 * cliente, pero siguen rigiendo el cooldown y el pendiente único de la base).
 */
export function clientIpFrom(headers: { get(name: string): string | null }): string | null {
  const forwarded = (headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const candidate = forwarded || (headers.get("x-real-ip") ?? "").trim();
  return candidate !== "" && isIP(candidate) !== 0 ? candidate : null;
}

/** Identificador de cliente del pedido, o `null` si no hay una IP utilizable. */
export function clientKeyFrom(headers: { get(name: string): string | null }, secret?: string): string | null {
  const ip = clientIpFrom(headers);
  return ip ? clientKeyFromIp(ip, secret) : null;
}
