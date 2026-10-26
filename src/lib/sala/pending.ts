import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEntitlements } from "@/lib/entitlements";
import { readAllByKey } from "@/lib/paginar";
import type { Database } from "@/lib/supabase/database.types";
import { asUuid } from "@/lib/carta/validation";
import { readBranchView } from "@/lib/sucursales/vista";
import type { MesaOrder } from "./mesas";
import { loadPendingCalls } from "./llamados-loader";
import { loadOpenOrders } from "./mesas-loader";
import { EXPIRY_MS, sortOldestFirst, type SalaCall, type SalaState } from "./types";

type Db = SupabaseClient<Database>;

const accountEntry = (order: MesaOrder | undefined) => (order ? { account: { totalCents: order.totalCents, dishes: order.dishes } } : {});

/** Ids por pedido al buscar las mesas de los llamados (la lista viaja en la URL). */
const TABLE_CHUNK = 100;

/**
 * Estado de la sala de una organización, con el cliente de la PERSONA (RLS: solo ve lo de su organización).
 * Si el plan o la cuenta no permiten el llamado (`features` de `org_entitlements`, que ya contempla la mora), no se
 * consulta nada: `enabled: false`. Los pendientes de 30 minutos o más no se listan (el vencimiento es derivado,
 * ADR 0010). Lanza si la base falla: la ruta lo traduce a un error y la pantalla reintenta.
 */
export async function loadSala(db: Db, orgId: string, now: Date = new Date()): Promise<SalaState> {
  const serverNow = now.toISOString();

  const ent = await db.rpc("org_entitlements", { p_org: orgId });
  if (ent.error) throw new Error(`No se pudo leer el estado de la cuenta: ${ent.error.message}`);
  const enabled = parseEntitlements(ent.data)?.features.includes("waiter_call") === true;

  // Solo las sucursales activas: una desactivada sale de la Sala (sus llamados pendientes no se borran; vencen solos a los 30 minutos).
  const branches = await readAllByKey((after, limit) => {
    const query = db.from("branches").select("id, name").eq("organization_id", orgId).eq("is_active", true);
    return (after ? query.gt("id", after) : query).order("id").limit(limit);
  });
  if (branches.error) throw new Error(`No se pudieron leer las sucursales: ${branches.error.message}`);
  const branchRows = branches.data ?? [];
  const multiBranch = branchRows.length > 1;
  const branchList = branchRows.map((branch) => ({ id: branch.id, name: branch.name }));
  // Lo que mira esta persona (vacío = todas). Si la lectura falla, la sala falla: no se filtra «a ciegas».
  const view = multiBranch ? await readBranchView(db, orgId) : [];

  if (!enabled) return { serverNow, enabled: false, multiBranch, branches: branchList, view, othersPending: 0, calls: [] };

  // Los pendientes de las sucursales activas que la persona mira se muestran; de los demás solo se cuenta la cantidad.
  const branchName = new Map(branchRows.map((branch) => [branch.id, branch.name]));
  const { inView, othersPending } = await loadPendingCalls(db, orgId, new Set(branchName.keys()), view, now);

  // `in (...)` va en la URL: se pide de a TABLE_CHUNK ids (cada pedido devuelve a lo sumo ese tanto de filas).
  const tableIds = [...new Set(inView.map((call) => call.table_id))];
  const tableLabel = new Map<string, string>();
  for (let i = 0; i < tableIds.length; i += TABLE_CHUNK) {
    const chunk = await db.from("tables").select("id, label").eq("organization_id", orgId).in("id", tableIds.slice(i, i + TABLE_CHUNK));
    if (chunk.error) throw new Error(`No se pudieron leer las mesas: ${chunk.error.message}`);
    for (const table of chunk.data) tableLabel.set(table.id, table.label);
  }

  // «Pide la cuenta» muestra al mozo el total del pedido abierto de esa mesa (ADR 0041). Si esa lectura falla, el llamado se muestra igual,
  // sin total: lo que importa de la sala es que el aviso llegue.
  const billTables = [...new Set(inView.filter((call) => call.kind === "bill").map((call) => call.table_id))];
  const accounts = await loadOpenOrders(db, orgId, { tableIds: billTables }).catch(() => new Map<string, MesaOrder>());

  const calls: SalaCall[] = inView.map((call) => ({
    id: call.id,
    kind: call.kind,
    tableLabel: tableLabel.get(call.table_id) ?? "Mesa",
    branchName: branchName.get(call.branch_id) ?? "",
    createdAt: call.created_at,
    visitStartedAt: call.visit_started_at,
    // Solo viaja en un «Pide la cuenta» con pedido: el resto de los llamados conserva exactamente su forma de siempre.
    ...(call.kind === "bill" ? accountEntry(accounts.get(call.table_id)) : {}),
  }));

  return { serverNow, enabled: true, multiBranch, branches: branchList, view, othersPending, calls: sortOldestFirst(calls) };
}

export type AttendResult =
  | { status: "attended" }
  | { status: "already_attended" } // otra persona (o una pantalla anterior) ya lo atendió
  | { status: "expired" }
  | { status: "unavailable" } // la base no lo dejó: plan o cuenta (el módulo está apagado)
  | { status: "not_found" };

/**
 * Marca un llamado como atendido. Un UPDATE bloqueado por RLS afecta 0 filas SIN error, así que se pide la fila de
 * vuelta y, si no hubo cambio, se lee el estado actual para decir la verdad (ya atendido, vencido o bloqueado).
 * La hora y la persona las pone la base (trigger): acá solo se manda `status`. Un pendiente de 30 minutos o más la
 * política tampoco lo deja atender (vencimiento derivado, ADR 0010): se informa como vencido aunque su `status` siga
 * siendo `pending` hasta que la función pública lo marque.
 */
export async function attendCall(db: Db, orgId: string, callId: unknown, now: Date = new Date()): Promise<AttendResult> {
  const id = asUuid(callId);
  if (!id) return { status: "not_found" };

  const updated = await db
    .from("waiter_calls")
    .update({ status: "attended" })
    .eq("id", id)
    .eq("organization_id", orgId)
    .eq("status", "pending")
    .select("id");
  if (updated.error) {
    // 42501 aparece si la persona no tiene permiso sobre la columna: nunca debería, pero no se confunde con «atendido».
    return { status: "unavailable" };
  }
  if (updated.data.length > 0) return { status: "attended" };

  const current = await db
    .from("waiter_calls")
    .select("status, created_at")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (current.error || !current.data) return { status: "not_found" };
  if (current.data.status === "attended") return { status: "already_attended" };
  if (current.data.status === "expired") return { status: "expired" };
  if (current.data.status === "pending" && now.getTime() - Date.parse(current.data.created_at) >= EXPIRY_MS) {
    return { status: "expired" };
  }
  return { status: "unavailable" };
}
