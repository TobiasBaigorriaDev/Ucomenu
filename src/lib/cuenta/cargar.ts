import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { PlanCatalogPrice } from "./precio";
import { formatCursor, HISTORY_PAGE, parseHistory, parsePayments, PAYMENTS_PAGE, type Cursor, type HistoryRow, type PaymentRow } from "./lectura";

type Db = SupabaseClient<Database>;

/** Una página de una lista: `next` es el cursor (fecha e id de la última fila) desde el que pedir las anteriores (`null` si no hay más). `null` entero = no se pudo leer. */
export type Page<T> = { rows: T[]; next: string | null } | null;

/**
 * Pagos e historial de cambios de la organización, para su Dueño (ADR 0021). Con la sesión de la persona: la base vuelve a
 * comprobar que sea Dueño y entrega solo la proyección permitida. Se pide una fila de más para saber si hay otra página.
 * Un fallo de una sección no tira la otra ni la pantalla.
 */
export async function loadOwnerAccount(db: Db, orgId: string, before: { payments?: Cursor; history?: Cursor }) {
  const [payments, history] = await Promise.all([
    db.rpc("owner_payments", {
      p_org: orgId,
      p_limit: PAYMENTS_PAGE + 1,
      ...(before.payments ? { p_before: before.payments.before, p_before_id: before.payments.beforeId } : {}),
    }),
    db.rpc("owner_account_history", {
      p_org: orgId,
      p_limit: HISTORY_PAGE + 1,
      ...(before.history ? { p_before: before.history.before, p_before_id: before.history.beforeId } : {}),
    }),
  ]);

  const page = <T extends { createdAt: string; id: string }>(parsed: T[] | null, size: number): Page<T> => {
    if (!parsed) return null;
    const rows = parsed.slice(0, size);
    return { rows, next: parsed.length > size ? formatCursor(rows[rows.length - 1]) : null };
  };
  return {
    payments: payments.error ? null : page<PaymentRow>(parsePayments(payments.data), PAYMENTS_PAGE),
    history: history.error ? null : page<HistoryRow>(parseHistory(history.data), HISTORY_PAGE),
  };
}

/** Precio de lista del plan en el catálogo (centavos de su moneda, hoy pesos), o `null` si no se puede leer. La tabla `plans` es de lectura con sesión. */
export async function loadPlanPrice(db: Db, planCode: string): Promise<PlanCatalogPrice | null> {
  const { data, error } = await db.from("plans").select("monthly_price_cents, yearly_price_cents, price_currency").eq("code", planCode).maybeSingle();
  if (error || !data) return null;
  return { monthlyCents: data.monthly_price_cents, yearlyCents: data.yearly_price_cents, currency: data.price_currency };
}
