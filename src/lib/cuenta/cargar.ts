import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { HISTORY_PAGE, parseHistory, parsePayments, PAYMENTS_PAGE, type HistoryRow, type PaymentRow } from "./lectura";

type Db = SupabaseClient<Database>;

/** Una página de una lista: `next` es la fecha desde la que pedir las anteriores (`null` si no hay más). `null` entero = no se pudo leer. */
export type Page<T> = { rows: T[]; next: string | null } | null;

/**
 * Pagos e historial de cambios de la organización, para su Dueño (ADR 0021). Con la sesión de la persona: la base vuelve a
 * comprobar que sea Dueño y entrega solo la proyección permitida. Se pide una fila de más para saber si hay otra página.
 * Un fallo de una sección no tira la otra ni la pantalla.
 */
export async function loadOwnerAccount(db: Db, orgId: string, before: { payments?: string; history?: string }) {
  const [payments, history] = await Promise.all([
    db.rpc("owner_payments", { p_org: orgId, p_limit: PAYMENTS_PAGE + 1, ...(before.payments ? { p_before: before.payments } : {}) }),
    db.rpc("owner_account_history", { p_org: orgId, p_limit: HISTORY_PAGE + 1, ...(before.history ? { p_before: before.history } : {}) }),
  ]);

  const page = <T extends { createdAt: string }>(parsed: T[] | null, size: number): Page<T> => {
    if (!parsed) return null;
    const rows = parsed.slice(0, size);
    return { rows, next: parsed.length > size ? rows[rows.length - 1].createdAt : null };
  };
  return {
    payments: payments.error ? null : page<PaymentRow>(parsePayments(payments.data), PAYMENTS_PAGE),
    history: history.error ? null : page<HistoryRow>(parseHistory(history.data), HISTORY_PAGE),
  };
}
