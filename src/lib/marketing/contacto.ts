/**
 * Datos de contacto y de demostración de la portada (`/`). Un solo lugar: el número de WhatsApp y el mensaje no se repiten
 * en los componentes. Ficha: agile/cambios/portada-ucomenu.md.
 */

/** Número de WhatsApp de UcoMenu en formato internacional, sin «+» ni espacios (54 = Argentina, 9 = celular). */
export const WHATSAPP_NUMERO = "5492622230125";

export const WHATSAPP_MENSAJE = "Hola, quiero probar UcoMenu 14 días gratis con mi local.";

/** Enlace de WhatsApp con el mensaje prellenado. */
export function whatsappUrl(mensaje: string = WHATSAPP_MENSAJE): string {
  return `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(mensaje)}`;
}

/**
 * Carta pública de ejemplo que abren los botones y los QR. Por decisión del usuario se usa Aurelia de staging;
 * NEXT_PUBLIC_DEMO_CARTA_PATH permite apuntar a otra carta (ruta local o URL absoluta) al construir.
 */
export const DEMO_CARTA_PATH = process.env.NEXT_PUBLIC_DEMO_CARTA_PATH || "https://ucomenu-staging.fly.dev/m/aurelia/centro";

/** Dirección pública de la app: base del QR de la demo (el mismo criterio que los QR de las mesas). */
export const SITIO_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ucomenu.com").replace(/\/$/, "");

export const DEMO_CARTA_URL = new URL(DEMO_CARTA_PATH, `${SITIO_URL}/`).toString();
