import { isAllowedPushEndpoint } from "./endpoint";

/**
 * Lee la suscripción que manda el navegador (`PushSubscription.toJSON()`). Cualquier forma inesperada es `null`:
 * la base vuelve a validar, pero un dato roto no llega ni a la llamada. Puro: se prueba en `push.test.ts`.
 */
export type ParsedSubscription = { endpoint: string; p256dh: string; auth: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export const P256DH_PATTERN = /^[A-Za-z0-9_-]{86,88}$/;
export const AUTH_PATTERN = /^[A-Za-z0-9_-]{22,24}$/;

export function parseSubscription(raw: unknown): ParsedSubscription | null {
  if (!isRecord(raw) || !isRecord(raw.keys)) return null;
  const { endpoint } = raw;
  const { p256dh, auth } = raw.keys;
  if (!isAllowedPushEndpoint(endpoint)) return null;
  if (typeof p256dh !== "string" || !P256DH_PATTERN.test(p256dh)) return null;
  if (typeof auth !== "string" || !AUTH_PATTERN.test(auth)) return null;
  return { endpoint, p256dh, auth };
}
