"use server";

import { headers } from "next/headers";
import { clientKeyFrom } from "@/lib/llamados/client-key";
import { placeCall } from "@/lib/llamados/place-call";
import { callMessage, isCallKind, SESSION_EXPIRED_MESSAGE, type CallKind, type CallTone } from "@/lib/llamados/result";
import { verifyVisitTicket } from "@/lib/llamados/visit-ticket";
import { isToken } from "@/lib/mesas/url";
import { createPublicClient } from "@/lib/supabase/public-client";

/**
 * «Llamar al mozo» / «Pedir la cuenta» desde `/t/{token}`. Es una escritura PÚBLICA sin sesión: la autoridad es el
 * token de la mesa y la regla está toda en la función de base. Esta acción solo valida el formato, arma el
 * identificador de cliente (HMAC de la IP, nunca la IP), comprueba el ticket de visita (que la pestaña no sea vieja:
 * ficha ticket-de-visita) y traduce el resultado a un mensaje. No usa `service_role`.
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
  const { tone, text } = callMessage(kind, result);
  return { kind, tone, message: text };
}
