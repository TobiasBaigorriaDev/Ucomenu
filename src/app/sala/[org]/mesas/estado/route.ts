import { respondSala } from "@/lib/sala/api";
import { loadMesas } from "@/lib/sala/mesas-loader";

/** Estado de la vista «Mesas» para su sondeo (`/sala/{slug}/mesas`), cada ~3 s. Mismo acceso que `/sala/{slug}/estado`. */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/sala/[org]/mesas/estado">) {
  const { org } = await context.params;
  return respondSala(org, (db, orgId) => loadMesas(db, orgId));
}
