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
 * Carta pública de ejemplo que abren el botón y el QR de «Probalo vos». En local y en staging es la demo del seed; en producción
 * hay que crear ese local de ejemplo y apuntar acá con NEXT_PUBLIC_DEMO_CARTA_PATH.
 */
export const DEMO_CARTA_PATH = process.env.NEXT_PUBLIC_DEMO_CARTA_PATH ?? "/m/cafe-ejemplo/centro";

/** Dirección pública de la app: base del QR de la demo (el mismo criterio que los QR de las mesas). */
export const SITIO_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ucomenu.com").replace(/\/$/, "");

export const DEMO_CARTA_URL = `${SITIO_URL}${DEMO_CARTA_PATH}`;
