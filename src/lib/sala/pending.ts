import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEntitlements } from "@/lib/entitlements";
import { readAllPages } from "@/lib/paginar";
import type { Database } from "@/lib/supabase/database.types";
import { asUuid } from "@/lib/carta/validation";
import { EXPIRY_MS, sortOldestFirst, type SalaCall, type SalaState } from "./types";

type Db = SupabaseClient<Database>;

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
  const branches = await readAllPages((from, to) =>
    db.from("branches").select("id, name").eq("organization_id", orgId).eq("is_active", true).order("id").range(from, to),
  );
  if (branches.error) throw new Error(`No se pudieron leer las sucursales: ${branches.error.message}`);
  const branchRows = branches.data ?? [];
  const multiBranch = branchRows.length > 1;

  if (!enabled) return { serverNow, enabled: false, multiBranch, calls: [] };

  const since = new Date(now.getTime() - EXPIRY_MS).toISOString();
  // Por páginas y con orden total (antigüedad, id): los pendientes de 30 minutos de varias sucursales pueden pasar de 1000 y
  // PostgREST corta cada lectura sin avisar. Es una foto por sondeo: un llamado atendido a mitad de lectura puede correr una
  // página y esconder otro hasta el sondeo siguiente (3 s); nunca se muestra uno de más.
  const pending = await readAllPages((from, to) =>
    db
      .from("waiter_calls")
      .select("id, kind, table_id, branch_id, created_at, visit_started_at")
      .eq("organization_id", orgId)
      .eq("status", "pending")
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (pending.error) throw new Error(`No se pudieron leer los llamados: ${pending.error.message}`);
  const pendingRows = pending.data ?? [];

  // `in (...)` va en la URL: se pide de a TABLE_CHUNK ids (cada pedido devuelve a lo sumo ese tanto de filas).
  const tableIds = [...new Set(pendingRows.map((call) => call.table_id))];
  const tableLabel = new Map<string, string>();
  for (let i = 0; i < tableIds.length; i += TABLE_CHUNK) {
    const chunk = await db.from("tables").select("id, label").eq("organization_id", orgId).in("id", tableIds.slice(i, i + TABLE_CHUNK));
    if (chunk.error) throw new Error(`No se pudieron leer las mesas: ${chunk.error.message}`);
    for (const table of chunk.data) tableLabel.set(table.id, table.label);
  }
  const branchName = new Map(branchRows.map((branch) => [branch.id, branch.name]));

  const calls: SalaCall[] = pendingRows.flatMap((call) => {
    if (call.kind !== "waiter" && call.kind !== "bill") return [];
    if (!branchName.has(call.branch_id)) return [];
    return [
      {
        id: call.id,
        kind: call.kind,
        tableLabel: tableLabel.get(call.table_id) ?? "Mesa",
        branchName: branchName.get(call.branch_id) ?? "",
        createdAt: call.created_at,
        visitStartedAt: call.visit_started_at,
      },
    ];
  });

  return { serverNow, enabled: true, multiBranch, calls: sortOldestFirst(calls) };
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
