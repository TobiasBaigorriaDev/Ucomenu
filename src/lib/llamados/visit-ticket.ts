import { createHmac, timingSafeEqual } from "node:crypto";
import { clientSecret } from "./client-key";

/**
 * Ticket de visita (ficha ticket-de-visita): el servidor lo firma cuando alguien abre `/t/{token}` y los botones de
 * llamado lo mandan de vuelta. Pasado el plazo, la acción responde «la sesión venció» y hay que escanear el QR de
 * nuevo. Así una pestaña que quedó abierta cuando el comensal se fue deja de poder avisar.
 *
 * Recargar NO lo renueva (ADR 0044, enmienda 2): la visita vive en la URL (`?v=`, ver `visita.ts`); escanear la emite y recargar la reutiliza,
 * así que tras un cobro o un «Reiniciar QR» la pestaña vieja pide escanear de nuevo. Lo que sigue sin resolver: quien escribe la URL a mano sin `v`
 * es, para el servidor, un escaneo. Y se valida en la app, no en la base: quien llame a la función de base directo se lo salta (mismo criterio que el
 * límite por cliente, ADR 0010). Para esos casos la sala muestra cuánto hacía que había escaneado.
 *
 * Es sin estado: `<segundos de emisión>.<HMAC-SHA256(secreto, "visit:" + token + ":" + segundos)>` truncado a 32 hex.
 * Va atado al token de la mesa (un ticket de otra mesa no sirve). Usa el mismo secreto de servidor que el
 * identificador de cliente (`WAITER_CALL_CLIENT_SECRET`); sin él, uno efímero por proceso (en producción hay que
 * definirlo, o los tickets no valdrían entre instancias ni tras un reinicio).
 */

/** Cuánto dura un ticket: una comida larga con sobremesa. Pasado esto hay que volver a escanear. */
export const VISIT_TTL_MS = 3 * 60 * 60 * 1000;
/** Tolerancia por si el reloj de otra instancia del servidor va un poco adelantado. */
const FUTURE_TOLERANCE_MS = 60 * 1000;

const SHAPE = /^(\d{1,12})\.([0-9a-f]{32})$/;

const sign = (token: string, issuedSeconds: number, secret: string): string =>
  createHmac("sha256", secret).update(`visit:${token}:${issuedSeconds}`).digest("hex").slice(0, 32);

/** Emite un ticket para la mesa de `token`, válido desde `nowMs`. */
export function issueVisitTicket(token: string, nowMs: number = Date.now(), secret: string = clientSecret()): string {
  const issued = Math.floor(nowMs / 1000);
  return `${issued}.${sign(token, issued, secret)}`;
}

export type TicketCheck =
  | { ok: true; issuedAt: Date }
  | { ok: false; reason: "missing" | "malformed" | "forged" | "expired" | "future" };

/**
 * Comprueba un ticket. Falla cerrado: lo que no se puede leer o verificar es inválido. El comensal recibe el mismo
 * mensaje para todos los motivos (no se le explica qué falló); el motivo existe para las pruebas y el registro.
 */
export function verifyVisitTicket(
  token: string,
  ticket: unknown,
  nowMs: number = Date.now(),
  secret: string = clientSecret(),
  ttlMs: number = VISIT_TTL_MS,
): TicketCheck {
  if (ticket === null || ticket === undefined || ticket === "") return { ok: false, reason: "missing" };
  if (typeof ticket !== "string") return { ok: false, reason: "malformed" };
  const match = SHAPE.exec(ticket);
  if (!match) return { ok: false, reason: "malformed" };

  const issued = Number(match[1]);
  const expected = Buffer.from(sign(token, issued, secret));
  const given = Buffer.from(match[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "forged" };

  const issuedMs = issued * 1000;
  if (issuedMs > nowMs + FUTURE_TOLERANCE_MS) return { ok: false, reason: "future" };
  if (nowMs - issuedMs >= ttlMs) return { ok: false, reason: "expired" };
  return { ok: true, issuedAt: new Date(issuedMs) };
}
