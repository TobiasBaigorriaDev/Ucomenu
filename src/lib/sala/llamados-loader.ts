import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllByKey } from "@/lib/paginar";
import type { Database } from "@/lib/supabase/database.types";
import { splitByView } from "@/lib/sucursales/vista";
import { EXPIRY_MS, type CallKind } from "./types";

type Db = SupabaseClient<Database>;

export type PendingRow = {
  id: string;
  kind: CallKind;
  table_id: string;
  branch_id: string;
  created_at: string;
  visit_started_at: string | null;
};

/**
 * Llamados pendientes de menos de 30 minutos (ADR 0010: el vencimiento es derivado) de las sucursales ACTIVAS y de un tipo conocido,
 * con el cliente de la PERSONA (RLS). Los de la vista de la persona vuelven en `inView`; de los demás solo se cuenta la cantidad
 * (`othersPending`: no suenan ni se anuncian, la persona eligió no mirarlos). Lo usan la lista de llamados del cartel (`loadSala`) y
 * la pantalla Mesas (`loadMesas`). Lanza si la base falla.
 */
export async function loadPendingCalls(
  db: Db,
  orgId: string,
  activeBranchIds: ReadonlySet<string>,
  view: readonly string[],
  now: Date,
): Promise<{ inView: PendingRow[]; othersPending: number }> {
  const since = new Date(now.getTime() - EXPIRY_MS).toISOString();
  // Por páginas y por clave (id): los pendientes de 30 minutos de varias sucursales pueden pasar de 1000 y PostgREST corta cada
  // lectura sin avisar. Por clave, un llamado atendido a mitad de lectura no corre las páginas ni esconde otro.
  const pending = await readAllByKey((after, limit) => {
    const query = db
      .from("waiter_calls")
      .select("id, kind, table_id, branch_id, created_at, visit_started_at")
      .eq("organization_id", orgId)
      .eq("status", "pending")
      .gt("created_at", since);
    return (after ? query.gt("id", after) : query).order("id").limit(limit);
  });
  if (pending.error) throw new Error(`No se pudieron leer los llamados: ${pending.error.message}`);

  const known = (pending.data ?? []).flatMap((call): PendingRow[] =>
    (call.kind === "waiter" || call.kind === "bill") && activeBranchIds.has(call.branch_id) ? [{ ...call, kind: call.kind }] : [],
  );
  const { shown, others } = splitByView(known.map((call) => ({ call, branchId: call.branch_id })), view);
  return { inView: shown.map(({ call }) => call), othersPending: others.length };
}
