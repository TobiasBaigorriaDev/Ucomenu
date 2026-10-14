import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Cliente con la clave de servicio (`service_role`): se salta RLS y puede administrar Auth.
 *
 * Reglas (ficha acceso-del-personal):
 *  - Solo el servidor. La variable NO lleva el prefijo NEXT_PUBLIC_ y este módulo es `server-only`.
 *  - Solo lo usa `src/lib/personnel.ts`, que antes comprueba con el cliente de la persona (RLS)
 *    que quien pide es `owner` de la organización. Nunca se usa para leer datos "en nombre" de nadie
 *    sin esa comprobación.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY: la gestión de personal no está configurada en este entorno.");
  }

  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
