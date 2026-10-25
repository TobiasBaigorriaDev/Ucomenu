"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import type { AccountResult } from "@/lib/cuenta/account";
import { getTableAccount } from "@/lib/cuenta/get-account";
import { BASE_LANG, isLang, type Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import { clientKeyFrom } from "@/lib/llamados/client-key";
import { placeCall } from "@/lib/llamados/place-call";
import { callMessage, isCallKind, type CallKind, type CallTone } from "@/lib/llamados/result";
import { verifyVisitTicket } from "@/lib/llamados/visit-ticket";
import { isToken } from "@/lib/mesas/url";
import { notifyCallPush } from "@/lib/push/notify-call";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * «Llamar al mozo» / «Pedir la cuenta» desde `/t/{token}`. Es una escritura PÚBLICA sin sesión: la autoridad es el
 * token de la mesa y la regla está toda en la función de base. Esta acción solo valida el formato, arma el
 * identificador de cliente (HMAC de la IP, nunca la IP), comprueba el ticket de visita (que la pestaña no sea vieja:
 * ficha ticket-de-visita) y traduce el resultado a un mensaje. La escritura llama a la base con `service_role`:
 * `create_waiter_call` solo la ejecuta esa clave (ADR 0038), así que esta acción es la única puerta y nadie puede omitir el ticket
 * ni la clave de cliente. El aviso por Web Push posterior (`after()`) también la usa, solo para dos funciones de base (ADR 0020).
 */

export type CallState = {
  kind?: CallKind;
  tone?: CallTone;
  message?: string;
  /** El ticket de visita venció: la barra pasa a pedir que se escanee el QR de nuevo. */
  expired?: boolean;
  /** Hay un «Pedir la cuenta» reciente de la mesa (recién creado, ya pendiente o en espera): la barra ofrece «Ver mi cuenta». */
  account?: boolean;
};

export async function createWaiterCallAction(_previous: CallState, formData: FormData): Promise<CallState> {
  const token = formData.get("token");
  const kind = formData.get("kind");
  // Solo cambia el idioma de los mensajes; un valor desconocido es el español.
  const rawLang = formData.get("lang");
  const lang: Lang = isLang(rawLang) ? rawLang : BASE_LANG;
  if (!isCallKind(kind)) return { tone: "error", message: callMessage("waiter", { status: "not_found" }, lang).text };

  // Sin un ticket vigente atado a ESTA mesa no se llega a la base: la pestaña quedó abierta de una visita anterior.
  const ticket = isToken(token) ? verifyVisitTicket(token, formData.get("ticket")) : null;
  if (ticket && !ticket.ok) return { kind, tone: "error", message: TEXTOS[lang].call.expired, expired: true };

  const clientKey = clientKeyFrom(await headers());
  const result = await placeCall(createAdminClient(), token, kind, clientKey, ticket?.issuedAt ?? null);
  // Un llamado nuevo avisa por Web Push a los dispositivos del personal (con la pestaña cerrada). Va en `after()`: no
  // demora la respuesta del comensal y, si falla, solo queda el sondeo de la sala como siempre (ADR 0020).
  if (result.status === "created" && isToken(token)) after(() => notifyCallPush(token, kind));
  const { tone, text } = callMessage(kind, result, lang);
  // La cuenta de la mesa ya se atendió después de este ticket: igual que un ticket vencido, hay que escanear de nuevo.
  const hasBill = kind === "bill" && (result.status === "created" || result.status === "already_pending" || result.status === "cooldown");
  return { kind, tone, message: text, ...(result.status === "session_closed" ? { expired: true } : {}), ...(hasBill ? { account: true } : {}) };
}

/**
 * «Ver mi cuenta» desde `/t/{token}` (ficha cuenta-del-comensal, ADR 0044). Es la ÚNICA lectura de pedidos para un anónimo. Esta acción solo
 * comprueba la forma del token y el ticket de visita (HMAC, atado a la mesa) y lee con `service_role`: la base decide si hay cuenta que
 * mostrar (ticket del turno vigente y «Pedir la cuenta» dentro del turno) y solo devuelve platos, importes y total. Un ticket inválido o
 * vencido es «escaneá de nuevo», sin decir por qué. No hay límite propio por conexión: sin ticket válido no se llega a la base y cada
 * lectura es de un solo pedido; si apareciera abuso, el límite se suma acá con la clave de conexión de los llamados.
 */
export async function viewAccountAction(token: unknown, ticket: unknown): Promise<AccountResult> {
  if (!isToken(token)) return { status: "expired" };
  const check = verifyVisitTicket(token, ticket);
  if (!check.ok) return { status: "expired" };
  return getTableAccount(createAdminClient(), token, check.issuedAt);
}
