/** Dirección pública que codifica el QR de una mesa: `{base}/t/{token}`. Puro: se prueba en `mesas.test.ts`. */

export const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export const isToken = (value: unknown): value is string => typeof value === "string" && TOKEN_PATTERN.test(value);

export function tableUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}/t/${token}`;
}

const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * Base del QR: `NEXT_PUBLIC_SITE_URL` si está definida y es una URL http(s); si no, el host y el protocolo
 * del pedido. Nunca viene de un parámetro de la URL. Devuelve `null` si no se puede determinar con seguridad.
 */
export function resolveBaseUrl(
  headers: { get(name: string): string | null },
  siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
): string | null {
  if (siteUrl && siteUrl.trim() !== "") {
    try {
      const url = new URL(siteUrl.trim());
      return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
    } catch {
      return null;
    }
  }

  // Detrás de un proxy puede llegar una lista («a.com, b.com»): vale el primero.
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim();
  if (!HOST.test(host)) return null;
  const forwarded = (headers.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  const protocol = forwarded === "http" || forwarded === "https" ? forwarded : LOCAL_HOST.test(host) ? "http" : "https";
  return `${protocol}://${host}`;
}
