import { NextResponse } from "next/server";
import { readBodyLimited } from "@/lib/analitica/cuerpo";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleMuxEvent, parseMuxEvent } from "@/lib/videos/eventos";
import { verifyMuxSignature } from "@/lib/videos/firma";
import { getMuxClient, webhookSecret } from "@/lib/videos/mux";

/**
 * Webhook de Mux Video (ficha videos-mux-parte-b, ADR 0031): lo único que cambia el estado de procesamiento de un video.
 * Pública y sin sesión A PROPÓSITO (la llama Mux): la autoridad es la FIRMA. Sin `MUX_WEBHOOK_SECRET` no procesa nada (503);
 * con firma inválida o fuera de tiempo, tampoco (401). El cuerpo se lee con tope mientras llega. Responde 2xx a lo procesado
 * o ignorado y 500 ante un fallo transitorio (la base o Mux), para que Mux reintente: aplicar un evento es idempotente.
 * Las respuestas no cuentan nada del motivo.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
/** Los avisos de Mux pesan unos pocos KB; este tope solo frena a quien mande basura. */
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: Request) {
  const secret = webhookSecret();
  if (!secret) return NextResponse.json({ received: false }, { status: 503, headers: NO_STORE });

  const body = await readBodyLimited(request, MAX_BODY_BYTES);
  if (body === null) return NextResponse.json({ received: false }, { status: 413, headers: NO_STORE });

  const check = verifyMuxSignature({
    body,
    header: request.headers.get("mux-signature"),
    secret,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!check.ok) return NextResponse.json({ received: false }, { status: 401, headers: NO_STORE });

  const event = parseMuxEvent(body);
  if (!event) return NextResponse.json({ received: false }, { status: 400, headers: NO_STORE });

  try {
    const outcome = await handleMuxEvent(createAdminClient(), getMuxClient(), event);
    return NextResponse.json({ received: true, outcome }, { headers: NO_STORE });
  } catch (error) {
    console.error(`[mux] no se pudo procesar ${event.type}: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json({ received: false }, { status: 500, headers: NO_STORE });
  }
}
