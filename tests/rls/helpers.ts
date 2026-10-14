import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Utilidades compartidas de las pruebas de RLS contra el Supabase LOCAL.
 * Requisitos: `pnpm db:start` y `pnpm db:reset`. Ver .env.example.
 */

export type Db = SupabaseClient<Database>;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Ids de supabase/seed.sql
export const ORG_CAFE = "10000000-0000-4000-8000-000000000001";
export const ORG_PARRILLA = "20000000-0000-4000-8000-000000000001";
export const ORG_INACTIVA = "30000000-0000-4000-8000-000000000001";
export const BRANCH_CAFE = "11000000-0000-4000-8000-000000000001";
export const BRANCH_PARRILLA = "21000000-0000-4000-8000-000000000001";
export const CATEGORY_CAFETERIA = "12000000-0000-4000-8000-000000000001";
export const CATEGORY_TEMPORADA_INACTIVA = "12000000-0000-4000-8000-000000000003";
export const CATEGORY_PARRILLA = "22000000-0000-4000-8000-000000000001";
export const PRODUCT_ESPRESSO = "13000000-0000-4000-8000-000000000001";
export const PRODUCT_INACTIVO = "13000000-0000-4000-8000-000000000003";
export const PRODUCT_EN_CATEGORIA_INACTIVA = "13000000-0000-4000-8000-000000000005";
export const PRODUCT_EN_ORG_INACTIVA = "33000000-0000-4000-8000-000000000001";

export function client(key: string | undefined): Db {
  if (!url || !key) {
    throw new Error("Faltan variables de entorno de Supabase. Copiá .env.example a .env.local y .env.test.local.");
  }
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const anonClient = () => client(publishableKey);
export const serviceClient = () => client(serviceKey);

export type TestUser = { id: string; db: Db };

/** Crea un usuario real de Auth con sesión iniciada. Hay que borrarlo con `deleteUser`. */
export async function createUser(service: Db, label: string): Promise<TestUser> {
  const email = `rls-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = "contrasena-de-prueba-123";

  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    throw new Error(`No se pudo crear el usuario de prueba: ${created.error?.message}`);
  }

  const db = anonClient();
  const signedIn = await db.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`No se pudo iniciar sesión: ${signedIn.error.message}`);

  return { id: created.data.user.id, db };
}

export async function deleteUser(service: Db, user: TestUser | undefined): Promise<void> {
  if (user) await service.auth.admin.deleteUser(user.id);
}

/** Para las pruebas que llaman a la API REST directamente (p. ej. esquemas no expuestos). */
export const apiUrl = url;
export const apiKey = publishableKey;
