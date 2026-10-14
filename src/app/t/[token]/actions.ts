"use server";

import { headers } from "next/headers";
import { clientKeyFrom } from "@/lib/llamados/client-key";
import { placeCall } from "@/lib/llamados/place-call";
import { callMessage, isCallKind, type CallKind, type CallTone } from "@/lib/llamados/result";
import { createPublicClient } from "@/lib/supabase/public-client";

/**
 * «Llamar al mozo» / «Pedir la cuenta» desde `/t/{token}`. Es una escritura PÚBLICA sin sesión: la autoridad es el
 * token de la mesa y la regla está toda en la función de base. Esta acción solo valida el formato, arma el
 * identificador de cliente (HMAC de la IP, nunca la IP) y traduce el resultado a un mensaje. No usa `service_role`.
 */

export type CallState = {
  kind?: CallKind;
  tone?: CallTone;
  message?: string;
};

export async function createWaiterCallAction(_previous: CallState, formData: FormData): Promise<CallState> {
  const token = formData.get("token");
  const kind = formData.get("kind");
  if (!isCallKind(kind)) return { tone: "error", message: callMessage("waiter", { status: "not_found" }).text };

  const clientKey = clientKeyFrom(await headers());
  const result = await placeCall(createPublicClient(), token, kind, clientKey);
  const { tone, text } = callMessage(kind, result);
  return { kind, tone, message: text };
}
