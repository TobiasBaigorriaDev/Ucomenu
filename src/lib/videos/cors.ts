/**
 * Origen que Mux debe permitir para la subida desde el navegador (`cors_origin`). Tiene que ser EXACTAMENTE el de la página
 * (protocolo, host y puerto) o el navegador bloquea el `PUT`. Se toma el `Origin` del pedido solo si es del mismo sitio que el
 * `Host` (nunca uno que mande un tercero); si no, el de `NEXT_PUBLIC_SITE_URL`.
 */
export function uploadCorsOrigin(input: { origin: string | null; host: string | null; siteUrl: string | undefined }): string | null {
  const fromRequest = sameSiteOrigin(input.origin, input.host);
  if (fromRequest) return fromRequest;
  return originOf(input.siteUrl);
}

function originOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function sameSiteOrigin(origin: string | null, host: string | null): string | null {
  const parsed = originOf(origin);
  if (!parsed || !host) return null;
  return new URL(parsed).host === host.trim().toLowerCase() ? parsed : null;
}
