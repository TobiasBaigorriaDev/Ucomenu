import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getMemberships, lookupCurrentUser } from "@/lib/auth/session";
import type { Database } from "@/lib/supabase/database.types";
import { createSessionClient } from "@/lib/supabase/server";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Respuesta de una ruta de consulta de la Sala (`/sala/{slug}/estado`, `/sala/{slug}/mesas/estado`). Usa la SESIÓN de la persona
 * (RLS), nunca `service_role`, y vuelve a comprobar identidad y membresía en cada pedido (el proxy solo mira que haya sesión):
 *  - sin sesión o con una sesión que Auth rechaza: 401 (la pantalla pide ingresar de nuevo);
 *  - Auth caído o lento (red, 5xx): 503, NO 401: la sesión puede estar bien y la pantalla tiene que seguir reintentando;
 *  - no es Dueño ni Personal del local (tampoco el cocinero), o el local no existe: 404 idéntico (no revela qué locales existen);
 *  - falla la base (también al leer la identidad o las membresías): 503 (la pantalla muestra «Sin conexión» y reintenta).
 * Nada se guarda en caché.
 */
export async function respondSala(slug: string, load: (db: SupabaseClient<Database>, orgId: string) => Promise<unknown>): Promise<NextResponse> {
  try {
    const lookup = await lookupCurrentUser();
    if (lookup.status === "unavailable") return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
    if (lookup.status === "anonymous") return NextResponse.json({ error: "no_session" }, { status: 401, headers: NO_STORE });
    const user = lookup.user;

    // Si falla la consulta de membresías (base caída con Auth en pie) lanza: cae al 503, no a un 500 sin JSON.
    const membership = (await getMemberships(user.id)).find((m) => m.org.slug === slug);
    // El cocinero no usa la Sala: misma respuesta que para quien no es del local.
    if (!membership || membership.role === "cook") return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

    const state = await load(await createSessionClient(), membership.org.id);
    return NextResponse.json(state, { headers: NO_STORE });
  } catch (error) {
    console.error(`La sala no pudo leer el estado: ${error instanceof Error ? error.message : "error desconocido"}`);
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
