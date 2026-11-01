import { NextResponse } from "next/server";
import { readBodyLimited } from "@/lib/analitica/cuerpo";
import { createCobroDb } from "@/lib/cobro/base";
import { settlePaymentById } from "@/lib/cobro/cobrar";
import { verifyMercadoPagoSignature } from "@/lib/cobro/firma";
import { getMercadoPagoClient, mercadoPagoWebhookSecret } from "@/lib/cobro/mercadopago";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Aviso (webhook) de Mercado Pago (ficha cobro-con-link-de-mercado-pago, ADR 0052): lo que puede mover la vigencia de una cuenta.
 * Pública y sin sesión A PROPÓSITO (la llama Mercado Pago): la autoridad es la FIRMA, y aun con firma válida el cuerpo NO se cree:
 * se toma solo el `data.id` firmado de la URL, se vuelve a pedir el pago a la API de Mercado Pago y la base lo registra (idempotente).
 * Sin `MERCADOPAGO_WEBHOOK_SECRET` o sin token no procesa nada (503, para que Mercado Pago reintente cuando esté configurado); con
 * firma inválida, 401. Responde 2xx a lo procesado o ignorado y 500 ante un fallo transitorio (la base o Mercado Pago).
 * Las respuestas no cuentan el motivo del rechazo; el motivo y el resultado quedan en el registro del servidor, sin secretos ni datos
 * del pagador.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
/** Los avisos pesan unos cientos de bytes; este tope solo frena a quien mande basura. */
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const secret = mercadoPagoWebhookSecret();
  if (!secret) {
    console.error("[mercadopago] llegó un aviso pero falta MERCADOPAGO_WEBHOOK_SECRET: no se procesa");
    return NextResponse.json({ received: false }, { status: 503, headers: NO_STORE });
  }

  const body = await readBodyLimited(request, MAX_BODY_BYTES);
  if (body === null) return NextResponse.json({ received: false }, { status: 413, headers: NO_STORE });

  const url = new URL(request.url);
  const dataId = url.searchParams.get("data.id");
  const check = verifyMercadoPagoSignature({
    header: request.headers.get("x-signature"),
    requestId: request.headers.get("x-request-id"),
    dataId,
    secret,
    nowMs: Date.now(),
  });
  if (!check.ok) {
    console.warn(`[mercadopago] aviso rechazado: firma ${check.reason}`);
    return NextResponse.json({ received: false }, { status: 401, headers: NO_STORE });
  }

  // Solo importan los pagos. El tipo viaja en la URL; el cuerpo es opcional y nunca decide nada.
  let type = url.searchParams.get("type");
  if (!type && body) {
    try {
      const parsed: unknown = JSON.parse(body);
      type = typeof parsed === "object" && parsed !== null && typeof (parsed as { type?: unknown }).type === "string" ? (parsed as { type: string }).type : null;
    } catch {
      return NextResponse.json({ received: false }, { status: 400, headers: NO_STORE });
    }
  }
  if (type !== "payment") return NextResponse.json({ received: true, outcome: "ignored_type" }, { headers: NO_STORE });
  if (!dataId) return NextResponse.json({ received: false }, { status: 400, headers: NO_STORE });

  const mp = getMercadoPagoClient();
  if (!mp) {
    console.error("[mercadopago] llegó un aviso pero falta MERCADOPAGO_ACCESS_TOKEN: no se procesa");
    return NextResponse.json({ received: false }, { status: 503, headers: NO_STORE });
  }

  try {
    const outcome = await settlePaymentById(createCobroDb(createAdminClient()), mp, dataId);
    console.info(`[mercadopago] pago ${dataId}: ${outcome}`);
    return NextResponse.json({ received: true, outcome }, { headers: NO_STORE });
  } catch (error) {
    console.error(`[mercadopago] no se pudo procesar el pago ${dataId}: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json({ received: false }, { status: 500, headers: NO_STORE });
  }
}
