import { NextResponse } from "next/server";
import { readBodyLimited } from "@/lib/analitica/cuerpo";
import { recordDishView } from "@/lib/analitica/registrar";
import { createPublicClient } from "@/lib/supabase/public-client";

/**
 * Cuenta una vista de plato desde la carta pública (ficha analitica-basica, ADR 0022). Es una ruta (no una acción del
 * servidor) A PROPÓSITO: las acciones del servidor de una página se ejecutan de a una, y un conteo lento no puede demorar
 * «Llamar al mozo» o «Pedir la cuenta» en `/t/{token}`. Pública y sin sesión: la regla está en `record_dish_view`; acá solo se
 * limita el tamaño y se valida el formato. Nada se guarda en el dispositivo ni se lee de él (sin cookies).
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 512;

export async function POST(request: Request) {
  try {
    // El tope se aplica MIENTRAS se lee (no después): un pedido anónimo enorme o que nunca termina no se queda con la memoria.
    const text = await readBodyLimited(request, MAX_BODY_BYTES);
    if (text === null) return NextResponse.json({ counted: false }, { status: 413, headers: NO_STORE });
    const body: unknown = JSON.parse(text);
    const { branch, product } = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const counted = await recordDishView(createPublicClient(), branch, product);
    return NextResponse.json({ counted }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ counted: false }, { status: 400, headers: NO_STORE });
  }
}
