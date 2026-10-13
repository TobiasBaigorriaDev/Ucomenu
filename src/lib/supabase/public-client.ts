import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Cliente de solo lectura para la carta pública. Usa la clave pública (publishable):
 * entra a la base como rol `anon`, así que todo lo que lee pasa por RLS.
 * La clave de servicio NUNCA se usa acá ni llega al navegador.
 */
export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copiá .env.example a .env.local.",
    );
  }

  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
