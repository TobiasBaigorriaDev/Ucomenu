import { respondSala } from "@/lib/sala/api";
import { loadSala } from "@/lib/sala/pending";

/**
 * Estado de la sala para el sondeo del panel (`/sala/{slug}`), cada ~3 s. El acceso (sesión, membresía, errores) lo resuelve
 * `respondSala`, compartido con `/sala/{slug}/mesas/estado`.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/sala/[org]/estado">) {
  const { org } = await context.params;
  return respondSala(org, (db, orgId) => loadSala(db, orgId));
}
