import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { isToken } from "@/lib/mesas/url";
import { isCallKind, parseCallResult, type CallResult } from "./result";

type Db = SupabaseClient<Database>;

/**
 * Pide un llamado a la base (`create_waiter_call`, la única puerta de escritura). Entra con el cliente `anon`:
 * no hace falta (ni se usa) la clave de servicio. Un token o un tipo imposibles no llegan a la base. Cualquier
 * error de red o de la base es «no disponible» para el comensal y se registra SIN IP, token ni identificador.
 * `visitStartedAt` (cuándo abrió la carta, del ticket de visita) es solo informativo para la sala.
 */
export async function placeCall(
  db: Db,
  token: unknown,
  kind: unknown,
  clientKey: string | null,
  visitStartedAt: Date | null = null,
): Promise<CallResult> {
  if (!isToken(token) || !isCallKind(kind)) return { status: "not_found" };

  try {
    const { data, error } = await db.rpc("create_waiter_call", {
      p_token: token,
      p_kind: kind,
      ...(clientKey ? { p_client: clientKey } : {}),
      ...(visitStartedAt ? { p_visit_started_at: visitStartedAt.toISOString() } : {}),
    });
    if (error) {
      console.error(`create_waiter_call falló (${error.code ?? "sin código"}): ${error.message}`);
      return { status: "unavailable" };
    }
    return parseCallResult(data);
  } catch (error) {
    console.error(`create_waiter_call falló: ${error instanceof Error ? error.message : "error desconocido"}`);
    return { status: "unavailable" };
  }
}
