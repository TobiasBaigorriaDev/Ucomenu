import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { purgePriceHistoryWhere } from "./purge-price-history";

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
export const ORG_MOROSA = "40000000-0000-4000-8000-000000000001";
export const BRANCH_CAFE = "11000000-0000-4000-8000-000000000001";
export const BRANCH_PARRILLA = "21000000-0000-4000-8000-000000000001";
export const CATEGORY_CAFETERIA = "12000000-0000-4000-8000-000000000001";
export const CATEGORY_TEMPORADA_INACTIVA = "12000000-0000-4000-8000-000000000003";
export const CATEGORY_PARRILLA = "22000000-0000-4000-8000-000000000001";
export const PRODUCT_ESPRESSO = "13000000-0000-4000-8000-000000000001";
export const PRODUCT_INACTIVO = "13000000-0000-4000-8000-000000000003";
export const PRODUCT_EN_CATEGORIA_INACTIVA = "13000000-0000-4000-8000-000000000005";
export const PRODUCT_EN_ORG_INACTIVA = "33000000-0000-4000-8000-000000000001";
export const PRODUCT_EN_ORG_MOROSA = "43000000-0000-4000-8000-000000000001";

// Usuarios de ejemplo del seed (contraseña pública de desarrollo).
export const SEED_PASSWORD = "ucomenu-dev-2026";
export const SEED_USERS = {
  duenoCafe: { id: "a0000000-0000-4000-8000-000000000001", email: "dueno@cafe-ejemplo.test" },
  mozoCafe: { id: "a0000000-0000-4000-8000-000000000002", email: "mozo@cafe-ejemplo.test" },
  duenoParrilla: { id: "a0000000-0000-4000-8000-000000000003", email: "dueno@parrilla-demo.test" },
  mozoParrilla: { id: "a0000000-0000-4000-8000-000000000004", email: "mozo@parrilla-demo.test" },
  duenoMoroso: { id: "a0000000-0000-4000-8000-000000000005", email: "dueno@resto-moroso.test" },
  mozoMoroso: { id: "a0000000-0000-4000-8000-000000000006", email: "mozo@resto-moroso.test" },
  multi: { id: "a0000000-0000-4000-8000-000000000007", email: "multi@ucomenu.test" },
} as const;
/** Ids de los usuarios del seed que pertenecen a cada organización del seed. */
export const SEED_MEMBERS_CAFE = [SEED_USERS.duenoCafe.id, SEED_USERS.mozoCafe.id, SEED_USERS.multi.id];

export function client(key: string | undefined): Db {
  if (!url || !key) {
    throw new Error("Faltan variables de entorno de Supabase. Copiá .env.example a .env.local y .env.test.local.");
  }
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const anonClient = () => client(publishableKey);
export const serviceClient = () => client(serviceKey);

export const TEST_PASSWORD = "contrasena-de-prueba-123";
export type TestUser = { id: string; email: string; db: Db };

/** Crea un usuario real de Auth con sesión iniciada. Hay que borrarlo con `deleteUser`. */
export async function createUser(service: Db, label: string): Promise<TestUser> {
  const email = `rls-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = TEST_PASSWORD;

  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    throw new Error(`No se pudo crear el usuario de prueba: ${created.error?.message}`);
  }

  const db = anonClient();
  const signedIn = await db.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`No se pudo iniciar sesión: ${signedIn.error.message}`);

  return { id: created.data.user.id, email, db };
}

export async function deleteUser(service: Db, user: TestUser | undefined): Promise<void> {
  if (user) await service.auth.admin.deleteUser(user.id);
}

/** Para las pruebas que llaman a la API REST directamente (p. ej. esquemas no expuestos). */
export const apiUrl = url;
export const apiKey = publishableKey;

/**
 * SQL directo contra el Postgres local (para lo que la API REST no puede: catálogo, funciones internas).
 * Corre dentro del contenedor de Supabase (`project_id` de supabase/config.toml). Solo para pruebas.
 * `SUPABASE_DB_CONTAINER` apunta a otra instancia local (p. ej. una aislada para un worktree).
 */
const dbContainer = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";

export function sql(query: string): string[][] {
  let out: string;
  try {
    out = execFileSync("docker", ["exec", dbContainer, "psql", "-U", "postgres", "-At", "-F", "|", "-c", query], {
      encoding: "utf8",
    });
  } catch (error) {
    throw new Error(`No se pudo consultar el contenedor ${dbContainer}. ¿Está encendido (pnpm db:start)? ${String(error)}`);
  }
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split("|"));
}

export type PlanCode = "basic" | "pro" | "premium";

const HORA_MS = 60 * 60 * 1000;
export const DIA_MS = 24 * HORA_MS;

/** Una organización de prueba (la prueba de 14 días se crea sola por trigger). Borrarla con `deleteOrg`. */
export async function createOrg(service: Db, slug: string, plan: PlanCode = "basic"): Promise<string> {
  const org = await service.from("organizations").insert({ slug, name: slug }).select("id").single();
  if (org.error) throw new Error(`No se pudo crear la organización ${slug}: ${org.error.message}`);
  await setSubscription(service, org.data.id, { plan });
  return org.data.id;
}

/**
 * Limpieza de PRUEBAS: borra el historial de precios de una organización de prueba. Una organización con
 * historial no se puede borrar (ON DELETE RESTRICT) y ni la API ni service_role pueden borrarlo (solo se agrega):
 * se hace como dueño de la tabla, apagando un momento el trigger de solo-agregado en una sola transacción.
 */
export function purgePriceHistory(orgId: string): void {
  purgePriceHistoryWhere(`organization_id = '${orgId}'`);
}

export async function deleteOrg(service: Db, orgId: string | undefined): Promise<void> {
  if (!orgId) return;
  purgePriceHistory(orgId);
  // Con varias bajas concurrentes un borrado puede fallar de forma transitoria: se reintenta y, si no se logra, se avisa
  // (antes el error se perdía y quedaba un resto que rompía la corrida siguiente).
  for (let intento = 1; intento <= 3; intento++) {
    const { error } = await service.from("organizations").delete().eq("id", orgId);
    if (!error) return;
    if (intento === 3) console.warn(`No se pudo borrar la organización de prueba ${orgId}: ${error.message}`);
    else await new Promise((resolve) => setTimeout(resolve, 200 * intento));
  }
}

/**
 * Fija plan y fin del período relativo a AHORA: `finEnMs` positivo = vence en el futuro,
 * negativo = vencido hace tanto. Deja una sola fecha (current_period_end) para que sea el fin efectivo.
 */
export async function setSubscription(
  service: Db,
  orgId: string,
  cambios: { plan?: PlanCode; finEnMs?: number },
): Promise<void> {
  const update: { plan_code?: string; current_period_end?: string; trial_ends_at?: string | null } = {};
  if (cambios.plan) update.plan_code = cambios.plan;
  if (cambios.finEnMs !== undefined) {
    update.current_period_end = new Date(Date.now() + cambios.finEnMs).toISOString();
    update.trial_ends_at = null;
  }
  const { error } = await service.from("subscriptions").update(update).eq("organization_id", orgId);
  if (error) throw new Error(`No se pudo actualizar la suscripción: ${error.message}`);
}

export async function addMembership(service: Db, user: TestUser, orgId: string, role: "owner" | "staff"): Promise<void> {
  const { error } = await service.from("memberships").insert({ user_id: user.id, organization_id: orgId, role });
  if (error) throw new Error(`No se pudo crear la membresía: ${error.message}`);
}

export async function createCategory(service: Db, orgId: string, name = "tt-categoria"): Promise<string> {
  const { data, error } = await service.from("categories").insert({ organization_id: orgId, name }).select("id").single();
  if (error) throw new Error(`No se pudo crear la categoría: ${error.message}`);
  return data.id;
}

/** Inserta `cantidad` platos de una sola vez (un único INSERT). */
export async function insertProducts(
  service: Db,
  orgId: string,
  categoryId: string,
  cantidad: number,
  isActive = true,
  prefijo = "tt-plato",
) {
  const filas = Array.from({ length: cantidad }, (_, i) => ({
    organization_id: orgId,
    category_id: categoryId,
    name: `${prefijo}-${i + 1}`,
    price_cents: 1000,
    is_active: isActive,
  }));
  return service.from("products").insert(filas);
}
