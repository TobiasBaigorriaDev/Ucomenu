import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getMemberships, lookupCurrentUser } from "@/lib/auth/session";
import { loadKitchen } from "@/lib/cocina/loader";
import type { Database } from "@/lib/supabase/database.types";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Estado de la pantalla de cocina para su sondeo (`/cocina/{slug}`), cada ~3 s. Usa la SESIÓN de la persona (las funciones de la base
 * deciden quién puede), nunca `service_role`, y vuelve a comprobar identidad y membresía en cada pedido:
 *  - sin sesión: 401 (el proxy y esta ruta); Auth caído o lento: 503, NO 401 (la sesión puede estar bien);
 *  - no trabaja en el local, o el local no existe: 404 idéntico (no revela qué locales existen);
 *  - falla la base: 503 (la pantalla muestra «Sin conexión» y reintenta).
 * Nada se guarda en caché.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(_request: Request, context: RouteContext<"/cocina/[org]/estado">) {
  const { org } = await context.params;
  try {
    const lookup = await lookupCurrentUser();
    if (lookup.status === "unavailable") return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
    if (lookup.status === "anonymous") return NextResponse.json({ error: "no_session" }, { status: 401, headers: NO_STORE });

    const membership = (await getMemberships(lookup.user.id)).find((m) => m.org.slug === org);
    if (!membership) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

    const db: SupabaseClient<Database> = await createSessionClient();
    return NextResponse.json(await loadKitchen(db, membership.org.id), { headers: NO_STORE });
  } catch (error) {
    console.error(`La cocina no pudo leer el estado: ${error instanceof Error ? error.message : "error desconocido"}`);
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
