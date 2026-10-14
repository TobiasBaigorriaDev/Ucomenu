import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { sessionCookieOptions } from "./cookie-options";
import type { Database } from "./database.types";

/**
 * Cliente de Supabase con la sesión de la persona (cookies). Entra a la base con su rol
 * `authenticated`, así que todo lo que lee o escribe pasa por RLS. Crear uno por pedido.
 */
export async function createSessionClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copiá .env.example a .env.local.",
    );
  }

  const store = await cookies();

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, sessionCookieOptions(options));
          }
        } catch {
          // Desde un Server Component no se pueden escribir cookies: la renovación la hace `proxy.ts`.
        }
      },
    },
  });
}
