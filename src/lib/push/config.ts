/**
 * Claves VAPID del servidor (identifican a UcoMenu ante los servicios de push). Sin las tres variables el aviso con la
 * pestaña cerrada queda apagado y todo lo demás sigue igual (la sala sondea como siempre).
 *  - VAPID_PUBLIC_KEY: pública; viaja al navegador por la página de la sala (en tiempo de ejecución, no se incrusta al construir).
 *  - VAPID_PRIVATE_KEY: SECRETO de servidor. Nunca a Git, a la imagen ni a una variable NEXT_PUBLIC_*.
 *  - VAPID_SUBJECT: `mailto:` o `https:` de contacto; si falta se usa el correo de contacto o la dirección pública del sitio.
 * Generarlas: `pnpm push:claves`. Puro: se prueba en `push.test.ts`.
 */
export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

type Env = Record<string, string | undefined>;

const PUBLIC_KEY = /^[A-Za-z0-9_-]{87}$/; // punto P-256 sin comprimir (65 bytes) en base64url
const PRIVATE_KEY = /^[A-Za-z0-9_-]{43}$/; // escalar P-256 (32 bytes) en base64url

export function vapidPublicKey(env: Env = process.env): string | null {
  const key = env.VAPID_PUBLIC_KEY?.trim();
  return key && PUBLIC_KEY.test(key) ? key : null;
}

function vapidSubject(env: Env): string | null {
  const explicit = env.VAPID_SUBJECT?.trim();
  if (explicit) return /^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(explicit) ? explicit : null;
  const contact = env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
  if (contact && /^[^\s@]+@[^\s@]+$/.test(contact)) return `mailto:${contact}`;
  const site = env.NEXT_PUBLIC_SITE_URL?.trim();
  return site && site.startsWith("https://") ? site : null;
}

/** Configuración completa para ENVIAR. `null` si falta algo o tiene mal formato. */
export function vapidConfig(env: Env = process.env): VapidConfig | null {
  const publicKey = vapidPublicKey(env);
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = vapidSubject(env);
  if (!publicKey || !privateKey || !PRIVATE_KEY.test(privateKey) || !subject) return null;
  return { publicKey, privateKey, subject };
}
