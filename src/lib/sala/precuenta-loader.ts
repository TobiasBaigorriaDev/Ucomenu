import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllByKey } from "@/lib/paginar";
import type { Database } from "@/lib/supabase/database.types";
import type { AnotarLine } from "./anotar";
import { loadOrderLines } from "./anotar-loader";

type Db = SupabaseClient<Database>;

export type PrecuentaData = {
  orderId: string;
  status: "open" | "closed" | "void";
  /** La mesa, si todavía existe (si se borró, el pedido conserva su etiqueta). */
  tableId: string | null;
  tableLabel: string;
  branchName: string;
  /** Zona horaria de la sucursal (la hora de la precuenta es la del local). */
  timeZone: string;
  multiBranch: boolean;
  closedAt: string | null;
  lines: AnotarLine[];
};

const isStatus = (value: string): value is PrecuentaData["status"] => value === "open" || value === "closed" || value === "void";

/**
 * Lo que necesita la precuenta de UN pedido (abierto, cerrado o anulado) con el cliente de la PERSONA (RLS: solo ve lo de su organización).
 * `null` si el pedido no existe o no es de ese local. Lanza si la base falla.
 */
export async function loadPrecuenta(db: Db, orgId: string, orderId: string): Promise<PrecuentaData | null> {
  const order = await db
    .from("orders")
    .select("id, status, table_id, table_label, branch_id, closed_at")
    .eq("organization_id", orgId)
    .eq("id", orderId)
    .maybeSingle();
  if (order.error) throw new Error(`No se pudo leer el pedido: ${order.error.message}`);
  if (!order.data || !isStatus(order.data.status)) return null;
  const { branch_id: branchId, status } = order.data;

  const branches = await readAllByKey((after, limit) => {
    const query = db.from("branches").select("id, name, timezone, is_active").eq("organization_id", orgId);
    return (after ? query.gt("id", after) : query).order("id").limit(limit);
  });
  if (branches.error) throw new Error(`No se pudieron leer las sucursales: ${branches.error.message}`);
  const branch = (branches.data ?? []).find((row) => row.id === branchId);
  if (!branch) return null;

  return {
    orderId: order.data.id,
    status,
    tableId: order.data.table_id,
    tableLabel: order.data.table_label,
    branchName: branch.name,
    timeZone: branch.timezone,
    multiBranch: (branches.data ?? []).filter((row) => row.is_active).length > 1,
    closedAt: order.data.closed_at,
    lines: await loadOrderLines(db, orgId, order.data.id),
  };
}
