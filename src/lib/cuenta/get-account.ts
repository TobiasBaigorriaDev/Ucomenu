import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { isToken } from "@/lib/mesas/url";
import { parseAccount, type AccountResult } from "./account";

type Db = SupabaseClient<Database>;

/**
 * Pide la cuenta de la mesa a la base (`get_table_account`). Solo la ejecuta `service_role` (ADR 0038, 0044): el cliente que llega es el
 * de servicio, armado por la acción de servidor tras verificar el ticket de visita. `ticketAt` es la emisión del ticket (la base la compara con
 * el inicio del turno). Un token imposible no llega a la base. Cualquier error de red o de la base es `error` para el comensal y se
 * registra SIN token, ticket ni datos.
 */
export async function getTableAccount(db: Db, token: unknown, ticketAt: Date): Promise<AccountResult> {
  if (!isToken(token)) return { status: "expired" };
  try {
    const { data, error } = await db.rpc("get_table_account", { p_token: token, p_ticket_at: ticketAt.toISOString() });
    if (error) {
      console.error(`get_table_account falló (${error.code ?? "sin código"}): ${error.message}`);
      return { status: "error" };
    }
    return parseAccount(data);
  } catch (error) {
    console.error(`get_table_account falló: ${error instanceof Error ? error.message : "error desconocido"}`);
    return { status: "error" };
  }
}
