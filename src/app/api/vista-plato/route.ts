import { NextResponse } from "next/server";
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
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return NextResponse.json({ counted: false }, { status: 413, headers: NO_STORE });
    const body: unknown = JSON.parse(text);
    const { branch, product } = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const counted = await recordDishView(createPublicClient(), branch, product);
    return NextResponse.json({ counted }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ counted: false }, { status: 400, headers: NO_STORE });
  }
}
