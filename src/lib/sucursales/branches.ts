import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEntitlements, type Entitlements } from "@/lib/entitlements";
import type { Database } from "@/lib/supabase/database.types";
import { sucursalesErrorMessage, sucursalesWriteBlock, type SucursalesError } from "./messages";
import { validateBranchName, validateBranchSlug } from "./rules";

/**
 * Gestión de sucursales (ficha gestion-de-sucursales). Todo con el cliente de la PERSONA (rol `authenticated`, RLS):
 * quién puede escribir (solo el Dueño), que la cuenta esté al día y el tope de sucursales del plan viven en la base
 * (migración gestion_de_sucursales + ADR 0006). Este módulo los muestra con mensajes claros y NO da por hecho un guardado
 * que la base descartó: un UPDATE bloqueado por RLS afecta 0 filas SIN error, así que toda escritura pide las filas de vuelta.
 */

type Db = SupabaseClient<Database>;

export type Result<T = void> = { ok: true; data: T } | { ok: false; error: SucursalesError };

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: SucursalesError): Result<never> => ({ ok: false, error });

export { sucursalesErrorMessage };
export type { SucursalesError };

const LIMIT_EXCEEDED = "53400";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const INSUFFICIENT_PRIVILEGE = "42501";

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export type Sucursal = { id: string; slug: string; name: string; tables: number; activeTables: number };

const collator = new Intl.Collator("es-AR", { numeric: true, sensitivity: "base" });

/** Las sucursales de la organización (orden natural por nombre) con la cantidad de mesas. */
export async function loadSucursales(db: Db, orgId: string): Promise<Sucursal[]> {
  const [branches, tables] = await Promise.all([
    db.from("branches").select("id, slug, name").eq("organization_id", orgId),
    db.from("tables").select("branch_id, is_active").eq("organization_id", orgId),
  ]);
  if (branches.error) throw new Error(`No se pudieron leer las sucursales: ${branches.error.message}`);
  if (tables.error) throw new Error(`No se pudieron leer las mesas: ${tables.error.message}`);

  return branches.data
    .map((branch) => {
      const own = tables.data.filter((table) => table.branch_id === branch.id);
      return { ...branch, tables: own.length, activeTables: own.filter((table) => table.is_active).length };
    })
    .sort((a, b) => collator.compare(a.name, b.name));
}

// ---------------------------------------------------------------------------
// Apoyo
// ---------------------------------------------------------------------------

async function entitlementsOf(db: Db, orgId: string): Promise<Entitlements | null> {
  const { data, error } = await db.rpc("org_entitlements", { p_org: orgId });
  return error ? null : parseEntitlements(data);
}

/** Corta antes de escribir si la cuenta está en solo lectura o suspendida (la base también lo impediría). */
async function guard(db: Db, orgId: string): Promise<SucursalesError | null> {
  return sucursalesWriteBlock(await entitlementsOf(db, orgId));
}

/** Traduce el error de una escritura. El RLS rechazado (42501) se confirma leyendo el estado de la cuenta. */
async function writeFailure(db: Db, orgId: string, error: { code?: string; message?: string }): Promise<SucursalesError> {
  switch (error.code) {
    case LIMIT_EXCEEDED:
      return "limit";
    case UNIQUE_VIOLATION:
      return "slug_duplicate";
    case CHECK_VIOLATION:
      return error.message?.includes("slug") ? "slug_invalid" : "name_too_long";
    case INSUFFICIENT_PRIVILEGE:
      return (await guard(db, orgId)) ?? "forbidden";
    default:
      return "unexpected";
  }
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

export async function createBranch(db: Db, orgId: string, input: { name: string; slug: string }): Promise<Result<{ id: string }>> {
  const name = validateBranchName(input.name);
  if (!name.ok) return fail(name.problem === "blank" ? "name_blank" : "name_too_long");
  const slug = validateBranchSlug(input.slug);
  if (!slug.ok) return fail(slug.problem === "blank" ? "slug_blank" : "slug_invalid");

  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db
    .from("branches")
    .insert({ organization_id: orgId, slug: slug.value, name: name.value })
    .select("id")
    .single();
  if (error) return fail(await writeFailure(db, orgId, error));
  return ok({ id: data.id });
}

export async function renameBranch(db: Db, orgId: string, id: string, rawName: string): Promise<Result> {
  const name = validateBranchName(rawName);
  if (!name.ok) return fail(name.problem === "blank" ? "name_blank" : "name_too_long");

  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db.from("branches").update({ name: name.value }).eq("id", id).eq("organization_id", orgId).select("id");
  if (error) return fail(await writeFailure(db, orgId, error));
  if (data.length === 0) {
    // 0 filas: o la sucursal no es de esta organización, o la base la bloqueó (rol o cuenta). Se distingue leyendo.
    const exists = await db.from("branches").select("id").eq("id", id).eq("organization_id", orgId).maybeSingle();
    if (exists.error) return fail("unexpected");
    return fail(exists.data ? "forbidden" : "not_found");
  }
  return ok(undefined);
}
