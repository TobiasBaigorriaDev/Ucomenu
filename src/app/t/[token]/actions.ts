"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { clientKeyFrom } from "@/lib/llamados/client-key";
import { placeCall } from "@/lib/llamados/place-call";
import { callMessage, isCallKind, SESSION_EXPIRED_MESSAGE, type CallKind, type CallTone } from "@/lib/llamados/result";
import { verifyVisitTicket } from "@/lib/llamados/visit-ticket";
import { isToken } from "@/lib/mesas/url";
import { notifyCallPush } from "@/lib/push/notify-call";
import { createPublicClient } from "@/lib/supabase/public-client";

/**
 * «Llamar al mozo» / «Pedir la cuenta» desde `/t/{token}`. Es una escritura PÚBLICA sin sesión: la autoridad es el
 * token de la mesa y la regla está toda en la función de base. Esta acción solo valida el formato, arma el
 * identificador de cliente (HMAC de la IP, nunca la IP), comprueba el ticket de visita (que la pestaña no sea vieja:
 * ficha ticket-de-visita) y traduce el resultado a un mensaje. La escritura no usa `service_role`; el aviso por Web Push
 * posterior (`after()`) sí, solo para dos funciones de base (ADR 0020).
 */

export type CallState = {
  kind?: CallKind;
  tone?: CallTone;
  message?: string;
  /** El ticket de visita venció: la barra pasa a pedir que se escanee el QR de nuevo. */
  expired?: boolean;
};

export async function createWaiterCallAction(_previous: CallState, formData: FormData): Promise<CallState> {
  const token = formData.get("token");
  const kind = formData.get("kind");
  if (!isCallKind(kind)) return { tone: "error", message: callMessage("waiter", { status: "not_found" }).text };

  // Sin un ticket vigente atado a ESTA mesa no se llega a la base: la pestaña quedó abierta de una visita anterior.
  const ticket = isToken(token) ? verifyVisitTicket(token, formData.get("ticket")) : null;
  if (ticket && !ticket.ok) return { kind, tone: "error", message: SESSION_EXPIRED_MESSAGE, expired: true };

  const clientKey = clientKeyFrom(await headers());
  const result = await placeCall(createPublicClient(), token, kind, clientKey, ticket?.issuedAt ?? null);
  // Un llamado nuevo avisa por Web Push a los dispositivos del personal (con la pestaña cerrada). Va en `after()`: no
  // demora la respuesta del comensal y, si falla, solo queda el sondeo de la sala como siempre (ADR 0020).
  if (result.status === "created" && isToken(token)) after(() => notifyCallPush(token, kind));
  const { tone, text } = callMessage(kind, result);
  // La cuenta de la mesa ya se atendió después de este ticket: igual que un ticket vencido, hay que escanear de nuevo.
  return { kind, tone, message: text, ...(result.status === "session_closed" ? { expired: true } : {}) };
}
