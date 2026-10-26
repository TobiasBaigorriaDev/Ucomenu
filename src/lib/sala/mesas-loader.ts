import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEntitlements } from "@/lib/entitlements";
import { readAllByKey } from "@/lib/paginar";
import type { Database } from "@/lib/supabase/database.types";
import { readBranchView } from "@/lib/sucursales/vista";
import { isLineStatus, sortMesas, summarizeOrder, type MesaCall, type MesaCard, type MesaOrder, type MesasState, type OrderLine } from "./mesas";
import { loadPendingCalls } from "./llamados-loader";

type Db = SupabaseClient<Database>;

/** Ids por pedido en `in (...)` (la lista viaja en la URL). */
const CHUNK = 100;

const chunks = <T>(items: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
};

/**
 * Pedidos ABIERTOS por mesa, resumidos, con el cliente de la PERSONA (RLS: solo ve lo de su organización). Se pide por mesas
 * (`tableIds`) o por sucursales (`branchIds`). Un pedido abierto sin líneas vivas (nada anotado o todo cancelado) no se resume: la
 * mesa se ve libre. Lanza si la base falla. Lecturas paginadas por clave: PostgREST corta cada lectura en 1000 filas sin avisar.
 */
export async function loadOpenOrders(db: Db, orgId: string, scope: { tableIds: readonly string[] } | { branchIds: readonly string[] }): Promise<Map<string, MesaOrder>> {
  const orders: { id: string; table_id: string | null; opened_at: string }[] = [];
  const pieces = "tableIds" in scope ? chunks(scope.tableIds) : chunks(scope.branchIds);
  for (const ids of pieces) {
    const page = await readAllByKey((after, limit) => {
      let query = db.from("orders").select("id, table_id, opened_at").eq("organization_id", orgId).eq("status", "open");
      query = "tableIds" in scope ? query.in("table_id", ids) : query.in("branch_id", ids);
      return (after ? query.gt("id", after) : query).order("id").limit(limit);
    });
    if (page.error) throw new Error(`No se pudieron leer los pedidos: ${page.error.message}`);
    orders.push(...(page.data ?? []));
  }
  if (orders.length === 0) return new Map();

  const lines = new Map<string, OrderLine[]>();
  for (const ids of chunks(orders.map((order) => order.id))) {
    const page = await readAllByKey((after, limit) => {
      const query = db
        .from("order_items")
        .select("id, order_id, status, quantity, unit_price_cents, options_cents")
        .eq("organization_id", orgId)
        .in("order_id", ids);
      return (after ? query.gt("id", after) : query).order("id").limit(limit);
    });
    if (page.error) throw new Error(`No se pudieron leer las líneas de los pedidos: ${page.error.message}`);
    for (const row of page.data ?? []) {
      // Un estado desconocido (un valor que esta pantalla todavía no conoce) no se suma: mejor menos que un total inventado.
      if (!isLineStatus(row.status)) continue;
      const list = lines.get(row.order_id) ?? [];
      list.push({ status: row.status, quantity: row.quantity, unitPriceCents: row.unit_price_cents, optionsCents: Number(row.options_cents) });
      lines.set(row.order_id, list);
    }
  }

  const byTable = new Map<string, MesaOrder>();
  for (const order of orders) {
    if (!order.table_id) continue;
    const summary = summarizeOrder(order.opened_at, lines.get(order.id) ?? []);
    if (summary) byTable.set(order.table_id, summary);
  }
  return byTable;
}

/**
 * Estado de la vista «Mesas»: las mesas activas de las sucursales que la persona mira, con su pedido abierto y sus llamados
 * pendientes (de menos de 30 minutos), y cuántos llamados hay en las sucursales que no mira. Si el plan o la cuenta no permiten
 * pedidos (`orders` en las funciones de `org_entitlements`, que ya contempla la mora), no se consulta nada más: `enabled: false`.
 * Los llamados se leen solo si además rige `waiter_call` (en Pro y Premium van juntos; una vista previa de pedidos en otro plan
 * muestra las mesas sin llamados). Lanza si la base falla.
 */
export async function loadMesas(db: Db, orgId: string, now: Date = new Date()): Promise<MesasState> {
  const serverNow = now.toISOString();

  const ent = await db.rpc("org_entitlements", { p_org: orgId });
  if (ent.error) throw new Error(`No se pudo leer el estado de la cuenta: ${ent.error.message}`);
  const features = parseEntitlements(ent.data)?.features ?? [];
  const enabled = features.includes("orders");
  const callsEnabled = features.includes("waiter_call");

  const branches = await readAllByKey((after, limit) => {
    const query = db.from("branches").select("id, name").eq("organization_id", orgId).eq("is_active", true);
    return (after ? query.gt("id", after) : query).order("id").limit(limit);
  });
  if (branches.error) throw new Error(`No se pudieron leer las sucursales: ${branches.error.message}`);
  const branchRows = branches.data ?? [];
  const multiBranch = branchRows.length > 1;
  const branchList = branchRows.map((branch) => ({ id: branch.id, name: branch.name }));
  const view = multiBranch ? await readBranchView(db, orgId) : [];
  if (!enabled) return { serverNow, enabled: false, multiBranch, branches: branchList, view, othersPending: 0, mesas: [] };

  // Las sucursales que la persona mira (vacío = todas las activas; un id que ya no está activo no cuenta).
  const active = new Set(branchRows.map((branch) => branch.id));
  const mirando = view.length === 0 ? [...active] : view.filter((id) => active.has(id));
  if (mirando.length === 0) return { serverNow, enabled: true, multiBranch, branches: branchList, view, othersPending: 0, mesas: [] };
  const branchName = new Map(branchRows.map((branch) => [branch.id, branch.name]));

  const tables = await readAllByKey((after, limit) => {
    const query = db.from("tables").select("id, label, branch_id").eq("organization_id", orgId).eq("is_active", true).in("branch_id", mirando);
    return (after ? query.gt("id", after) : query).order("id").limit(limit);
  });
  if (tables.error) throw new Error(`No se pudieron leer las mesas: ${tables.error.message}`);
  const tableRows = [...(tables.data ?? [])];

  const pending = callsEnabled ? await loadPendingCalls(db, orgId, active, view, now) : { inView: [], othersPending: 0 };
  const callsByTable = new Map<string, MesaCall[]>();
  for (const call of pending.inView) {
    const list = callsByTable.get(call.table_id) ?? [];
    list.push({ id: call.id, kind: call.kind, createdAt: call.created_at, visitStartedAt: call.visit_started_at });
    callsByTable.set(call.table_id, list);
  }

  // Una mesa dada de baja con un llamado pendiente sigue figurando hasta que el llamado venza (a los 30 minutos): el aviso no se pierde.
  const listed = new Set(tableRows.map((table) => table.id));
  for (const ids of chunks([...callsByTable.keys()].filter((id) => !listed.has(id)))) {
    const extra = await db.from("tables").select("id, label, branch_id").eq("organization_id", orgId).in("id", ids);
    if (extra.error) throw new Error(`No se pudieron leer las mesas: ${extra.error.message}`);
    tableRows.push(...extra.data);
  }

  const orders = await loadOpenOrders(db, orgId, { branchIds: mirando });

  const cards: MesaCard[] = tableRows.map((table) => ({
    tableId: table.id,
    tableLabel: table.label,
    branchName: branchName.get(table.branch_id) ?? "",
    calls: (callsByTable.get(table.id) ?? []).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    order: orders.get(table.id) ?? null,
  }));
  return { serverNow, enabled: true, multiBranch, branches: branchList, view, othersPending: pending.othersPending, mesas: sortMesas(cards) };
}
