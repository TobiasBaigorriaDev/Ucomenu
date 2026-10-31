import type { MetadataRoute } from "next";

/**
 * ¿La dirección pública es la definitiva? Solo entonces el sitio se deja indexar: staging (`*.fly.dev`), `localhost` y los dominios de
 * prueba piden que no se los indexe (revisión de preparación para producción, hallazgo I3: staging contiene una portada y cartas de
 * ejemplo que no deben competir con `ucomenu.com`).
 */
export function esSitioDeProduccion(siteUrl: string | undefined): boolean {
  if (!siteUrl) return false;
  try {
    const url = new URL(siteUrl);
    if (url.protocol !== "https:") return false;
    return !/(^|\.)(fly\.dev|localhost|local|test|example)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/** Zonas que nunca se indexan: paneles con sesión y las mesas (`/t/{token}`, enlace de un QR físico, no una página pública). */
export const RUTAS_PRIVADAS = ["/panel/", "/sala/", "/cocina/", "/admin/", "/cuenta", "/login", "/t/"] as const;

export function reglasRobots(siteUrl: string | undefined): MetadataRoute.Robots {
  if (!esSitioDeProduccion(siteUrl)) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: [...RUTAS_PRIVADAS] } };
}
