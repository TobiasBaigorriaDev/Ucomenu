import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

/**
 * ¿La visita (el ticket de la URL) sigue vigente en el turno de la mesa? (`visit_in_turn`, solo `service_role`, ADR 0038 y 0044; `db` crea el cliente de servicio dentro del `try`, como `placeCall`.) Solo decide si
 * la página ofrece los botones de llamado: la AUTORIDAD es `create_waiter_call`, que rechaza igual una visita terminada. Por eso **falla abierto**: si la
 * base no responde, falta la clave de servicio o la respuesta es rara, se ofrecen los botones (y la acción volverá a comprobar). Un error se registra SIN token ni ticket.
 */
export async function visitInTurn(db: () => Db, token: string, issuedAt: Date): Promise<boolean> {
  try {
    const { data, error } = await db().rpc("visit_in_turn", { p_token: token, p_ticket_at: issuedAt.toISOString() });
    if (error) {
      console.error(`visit_in_turn falló (${error.code ?? "sin código"}): ${error.message}`);
      return true;
    }
    return data !== false;
  } catch (error) {
    console.error(`visit_in_turn falló: ${error instanceof Error ? error.message : "error desconocido"}`);
    return true;
  }
}
