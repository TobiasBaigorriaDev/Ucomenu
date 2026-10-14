import { NextResponse } from "next/server";
import { getCurrentUser, getMemberships } from "@/lib/auth/session";
import { loadSala } from "@/lib/sala/pending";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Estado de la sala para el sondeo del panel (`/sala/{slug}`), cada ~3 s. Usa la SESIÓN de la persona (RLS), nunca
 * `service_role`, y vuelve a comprobar identidad y membresía en cada pedido (el proxy solo mira que haya sesión):
 *  - sin sesión válida: 401;
 *  - no es miembro del local, o el local no existe: 404 idéntico (no revela qué locales existen);
 *  - falla la base (también al leer la identidad o las membresías): 503 (la pantalla muestra «Sin conexión» y reintenta).
 * Nada se guarda en caché.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(_request: Request, context: RouteContext<"/sala/[org]/estado">) {
  const { org } = await context.params;

  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "no_session" }, { status: 401, headers: NO_STORE });

    // Si falla la consulta de membresías (base caída con Auth en pie) lanza: cae al 503, no a un 500 sin JSON.
    const membership = (await getMemberships(user.id)).find((m) => m.org.slug === org);
    if (!membership) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

    const state = await loadSala(await createSessionClient(), membership.org.id);
    return NextResponse.json(state, { headers: NO_STORE });
  } catch (error) {
    console.error(`La sala no pudo leer el estado: ${error instanceof Error ? error.message : "error desconocido"}`);
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
