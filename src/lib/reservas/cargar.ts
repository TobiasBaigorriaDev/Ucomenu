import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { parseReservation, shiftDate, startOfDay, type Reservation, type ReservationTable } from "./reservas";

type Db = SupabaseClient<Database>;

const COLUMNS = "id, branch_id, table_id, table_label, source, status, guest_name, guest_phone, guest_email, party_size, starts_at, ends_at, notes";
/** Una reserva dura hasta 6 horas: para saber qué mesas están ocupadas a una hora del día se miran también las que empezaron antes. */
const LOOKBACK_MS = 6 * 60 * 60 * 1000;
const PAGE_LIMIT = 1000;

export type DayData = {
  /** Las reservas que empiezan ese día en la zona de la sucursal. */
  day: Reservation[];
  /** Esas más las que empezaron hasta 6 horas antes: lo necesario para saber qué mesas están libres. */
  around: Reservation[];
  tables: ReservationTable[];
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
      .gte("starts_at", new Date(from.getTime() - LOOKBACK_MS).toISOString())
      .lt("starts_at", to.toISOString())
      .order("starts_at")
      .order("id")
      .limit(PAGE_LIMIT),
    db.from("tables").select("id, label, branch_id").eq("organization_id", orgId).eq("branch_id", branchId).eq("is_active", true).order("label"),
  ]);
  if (rows.error || tables.error) return null;
  const around = rows.data.flatMap((row) => parseReservation(row) ?? []);
  // Una fila que no se puede leer no se esconde en silencio: si alguna falló, toda la lectura se da por fallida.
  if (around.length !== rows.data.length) return null;
  const day = around.filter((reservation) => Date.parse(reservation.startsAt) >= from.getTime());
  return {
    day,
    around,
    tables: tables.data.map((table) => ({ id: table.id, label: table.label, branchId: table.branch_id })).sort((a, b) => a.label.localeCompare(b.label, "es-AR", { numeric: true })),
  };
}

/** Reservas por confirmar que todavía no pasaron (para el Resumen), o `null` si no se pudo leer. */
export async function loadPendingReservations(db: Db, orgId: string): Promise<number | null> {
  const { count, error } = await db
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("status", "requested")
    .gt("ends_at", new Date().toISOString());
  return error ? null : (count ?? 0);
}
