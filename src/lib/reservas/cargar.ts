import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { parseReservation, shiftDate, startOfDay, type Reservation, type ReservationTable } from "./reservas";

type Db = SupabaseClient<Database>;

const COLUMNS = "id, branch_id, table_id, table_label, source, status, guest_name, guest_phone, guest_email, party_size, starts_at, ends_at, notes";
/**
 * Una reserva dura hasta 6 horas: dos reservas se pisan si una empieza antes de que la otra termine, así que para saber qué mesas están
 * ocupadas a cualquier hora del día se miran las que empiezan hasta 6 horas antes del día y hasta 6 horas después (revisión de Codex).
 */
const LOOKAROUND_MS = 6 * 60 * 60 * 1000;
export const PAGE_LIMIT = 1000;

export type DayData = {
  /** Las reservas que empiezan ese día en la zona de la sucursal. */
  day: Reservation[];
  /** Esas más las que empiezan hasta 6 horas antes o después: lo necesario para saber qué mesas están libres de punta a punta del día. */
  around: Reservation[];
  tables: ReservationTable[];
  /** La lectura llegó al tope de filas: la lista y las mesas libres pueden estar incompletas (la pantalla lo avisa). */
  truncated: boolean;
  /** Con la lectura cortada, el inicio de la última fila leída: lo que no se leyó empieza ahí o después (`null` si no se cortó). */
  firstUnloadedStart: string | null;
};

/**
 * Las reservas de un día de una sucursal y sus mesas activas, con la sesión de la persona (RLS: solo Dueño y Staff de la organización).
 * Una lectura que falla es `null`: la pantalla lo dice y no muestra una lista vacía como si no hubiera reservas.
 */
export async function loadDay(db: Db, orgId: string, branchId: string, date: string, timeZone: string): Promise<DayData | null> {
  const from = startOfDay(date, timeZone);
  const to = startOfDay(shiftDate(date, 1), timeZone);
  const [rows, tables] = await Promise.all([
    db
      .from("reservations")
      .select(COLUMNS)
      .eq("organization_id", orgId)
      .eq("branch_id", branchId)
      .gte("starts_at", new Date(from.getTime() - LOOKAROUND_MS).toISOString())
      .lt("starts_at", new Date(to.getTime() + LOOKAROUND_MS).toISOString())
      .order("starts_at")
      .order("id")
      .limit(PAGE_LIMIT),
    db.from("tables").select("id, label, branch_id").eq("organization_id", orgId).eq("branch_id", branchId).eq("is_active", true).order("label"),
  ]);
  if (rows.error || tables.error) return null;
  const around = rows.data.flatMap((row) => parseReservation(row) ?? []);
  // Una fila que no se puede leer no se esconde en silencio: si alguna falló, toda la lectura se da por fallida.
  if (around.length !== rows.data.length) return null;
  const day = around.filter((reservation) => Date.parse(reservation.startsAt) >= from.getTime() && Date.parse(reservation.startsAt) < to.getTime());
  return {
    day,
    truncated: rows.data.length >= PAGE_LIMIT,
    firstUnloadedStart: null,
    around,
    tables: tables.data.map((table) => ({ id: table.id, label: table.label, branchId: table.branch_id })).sort((a, b) => a.label.localeCompare(b.label, "es-AR", { numeric: true })),
  };
}

export const UPCOMING_LIMIT = 300;

/**
 * Todas las reservas próximas de una sucursal: las que siguen vivas (por confirmar o confirmadas) y todavía no terminaron, de la más
 * cercana a la más lejana. También lee las que ya están sentadas y no terminaron, que no se listan pero ocupan su mesa. Con la
 * sesión de la persona (RLS). `null` si la lectura falla. Si hay más que `UPCOMING_LIMIT`, `truncated` y `firstUnloadedStart` dicen
 * hasta dónde se leyó.
 */
export async function loadUpcoming(db: Db, orgId: string, branchId: string): Promise<DayData | null> {
  const [rows, tables] = await Promise.all([
    db
      .from("reservations")
      .select(COLUMNS)
      .eq("organization_id", orgId)
      .eq("branch_id", branchId)
      .in("status", ["pending_email", "requested", "confirmed", "seated"])
      .gt("ends_at", new Date().toISOString())
      .order("starts_at")
      .order("id")
      .limit(UPCOMING_LIMIT),
    db.from("tables").select("id, label, branch_id").eq("organization_id", orgId).eq("branch_id", branchId).eq("is_active", true).order("label"),
  ]);
  if (rows.error || tables.error) return null;
  const around = rows.data.flatMap((row) => parseReservation(row) ?? []);
  if (around.length !== rows.data.length) return null;
  const truncated = rows.data.length >= UPCOMING_LIMIT;
  return {
    day: around.filter((reservation) => reservation.status !== "seated"),
    around,
    truncated,
    firstUnloadedStart: truncated ? around[around.length - 1].startsAt : null,
    tables: tables.data.map((table) => ({ id: table.id, label: table.label, branchId: table.branch_id })).sort((a, b) => a.label.localeCompare(b.label, "es-AR", { numeric: true })),
  };
}

/**
 * Reservas por confirmar que todavía no pasaron (para el Resumen), o `null` si no se pudo leer. `assigned` son las sucursales asignadas a
 * quien mira (vacío = todas): el Staff con sucursales asignadas solo cuenta las que ve en su pantalla de Reservas.
 */
export async function loadPendingReservations(db: Db, orgId: string, assigned: readonly string[] = []): Promise<number | null> {
  let query = db
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("status", "requested")
    .gt("ends_at", new Date().toISOString());
  if (assigned.length > 0) query = query.in("branch_id", [...assigned]);
  const { count, error } = await query;
  return error ? null : (count ?? 0);
}
