/**
 * Qué direcciones de servicio de push acepta la app (ADR 0020). El servidor hace un POST a la dirección que cada
 * dispositivo registró: si se aceptara cualquiera, una cuenta del personal podría apuntarlo a un servicio interno (SSRF).
 * Se aceptan solo https y los servicios de los navegadores soportados; la misma lista vive en la base
 * (`private.is_push_endpoint`) y se vuelve a comprobar antes de cada envío. Puro: se prueba en `push.test.ts`.
 */

const ALLOWED_HOSTS: RegExp[] = [
  /^fcm\.googleapis\.com$/, // Chrome y Chromium en Android y escritorio
  /^[a-z0-9-]+\.notify\.windows\.com$/, // Edge (WNS)
  /^([a-z0-9-]+\.)?push\.services\.mozilla\.com$/, // Firefox
  /^([a-z0-9-]+\.)?push\.apple\.com$/, // Safari
];

export const MAX_ENDPOINT_LENGTH = 1000;

export function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ENDPOINT_LENGTH) return false;
  // Sin espacios ni barras invertidas: el analizador de URL las normaliza y se colaría otro destino.
  if (/[\s\\]/.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return false;
  // El texto debe empezar exactamente por «https://host/»: así lo que se valida es lo que se envía.
  if (!value.startsWith(`https://${url.hostname}/`)) return false;
  return ALLOWED_HOSTS.some((pattern) => pattern.test(url.hostname));
}
