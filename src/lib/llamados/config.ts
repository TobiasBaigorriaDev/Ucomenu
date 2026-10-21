import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEntitlements, type Entitlements } from "@/lib/entitlements";
import { sortByLabel } from "@/lib/mesas/labels";
import { readAllByKey } from "@/lib/paginar";
import type { Database } from "@/lib/supabase/database.types";
import { configErrorMessage, configWriteBlock, type ConfigError } from "./config-messages";
import { muteUntil, parseCooldown, parseMuteMinutes } from "./config-rules";

/**
 * Configuración del llamado (ficha configuracion-del-llamado): silenciar una mesa y el cooldown por sucursal.
 * Todo con el cliente de la PERSONA (rol `authenticated`, RLS): quién puede escribir, el rango del cooldown y el tope
 * de 24 horas del silencio viven en la base. Este módulo no da por hecho un guardado que la base descartó: un UPDATE
 * bloqueado por RLS afecta 0 filas SIN error, así que toda escritura pide las filas de vuelta.
 */

type Db = SupabaseClient<Database>;

export type Result<T = void> = { ok: true; data: T } | { ok: false; error: ConfigError };

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: ConfigError): Result<never> => ({ ok: false, error });

export { configErrorMessage };
export type { ConfigError };

const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";
const INVALID_PARAMETER = "22023"; // el silencio pasa del tope de 24 horas

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export type ConfigTable = { id: string; label: string; is_active: boolean; muted_until: string | null };
export type ConfigBranch = { id: string; name: string; cooldown: number; tables: ConfigTable[] };

/** Las sucursales ACTIVAS de la organización con su cooldown y sus mesas (orden natural por nombre). */
export async function loadLlamadoConfig(db: Db, orgId: string): Promise<ConfigBranch[]> {
  // Por páginas y con orden estable: PostgREST corta cada lectura en 1000 filas sin avisar (las mesas inactivas no tienen tope).
  const [branches, tables] = await Promise.all([
    readAllByKey((after, limit) => {
      const query = db.from("branches").select("id, name, waiter_call_cooldown_seconds").eq("organization_id", orgId).eq("is_active", true);
      return (after ? query.gt("id", after) : query).order("id").limit(limit);
    }),
    readAllByKey((after, limit) => {
      const query = db.from("tables").select("id, branch_id, label, is_active, muted_until").eq("organization_id", orgId);
      return (after ? query.gt("id", after) : query).order("id").limit(limit);
    }),
  ]);
  if (branches.error) throw new Error(`No se pudieron leer las sucursales: ${branches.error.message}`);
  if (tables.error) throw new Error(`No se pudieron leer las mesas: ${tables.error.message}`);

  const byBranch = new Map<string, ConfigTable[]>();
  for (const table of tables.data ?? []) {
    const group = byBranch.get(table.branch_id);
    if (group) group.push(table);
    else byBranch.set(table.branch_id, [table]);
  }
  // Las sucursales se leen por clave (id): se muestran por nombre.
  return [...(branches.data ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name, "es") || a.id.localeCompare(b.id))
    .map((branch) => ({
      id: branch.id,
      name: branch.name,
      cooldown: branch.waiter_call_cooldown_seconds,
      tables: sortByLabel(byBranch.get(branch.id) ?? []),
    }));
}

// ---------------------------------------------------------------------------
// Apoyo
// ---------------------------------------------------------------------------

async function entitlementsOf(db: Db, orgId: string): Promise<Entitlements | null> {
  const { data, error } = await db.rpc("org_entitlements", { p_org: orgId });
  return error ? null : parseEntitlements(data);
}

/** Corta antes de escribir si la cuenta está en solo lectura o suspendida (la base también lo impediría). */
async function guard(db: Db, orgId: string): Promise<ConfigError | null> {
  return configWriteBlock(await entitlementsOf(db, orgId));
}

/**
 * Una escritura devolvió 0 filas: o el recurso no existe en esta organización, o la base la bloqueó. Se distingue
 * leyendo; si existe y la cuenta está al día, la causa es el permiso (p. ej. el Staff y las sucursales).
 */
async function explainZeroRows(db: Db, orgId: string, table: "tables" | "branches", id: string): Promise<ConfigError> {
  const { data, error } = await db.from(table).select("id").eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (error) return "unexpected";
  if (!data) return "not_found";
  return (await guard(db, orgId)) ?? "forbidden";
}

async function writeFailure(db: Db, orgId: string, error: { code?: string }): Promise<ConfigError> {
  switch (error.code) {
    case INSUFFICIENT_PRIVILEGE:
      return (await guard(db, orgId)) ?? "forbidden";
    case INVALID_PARAMETER:
      return "mute_invalid";
    case CHECK_VIOLATION:
      return "cooldown_invalid";
    default:
      return "unexpected";
  }
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

/** Silencia una mesa por una de las duraciones ofrecidas. */
export async function muteTable(db: Db, orgId: string, tableId: string, rawMinutes: unknown, now: Date = new Date()): Promise<Result> {
  const minutes = parseMuteMinutes(rawMinutes);
  if (minutes === null) return fail("mute_invalid");
  return setMutedUntil(db, orgId, tableId, muteUntil(minutes, now));
}

/** Quita el silencio de una mesa. */
export async function unmuteTable(db: Db, orgId: string, tableId: string): Promise<Result> {
  return setMutedUntil(db, orgId, tableId, null);
}

async function setMutedUntil(db: Db, orgId: string, tableId: string, until: string | null): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db
    .from("tables")
    .update({ muted_until: until })
    .eq("id", tableId)
    .eq("organization_id", orgId)
    .select("id, muted_until");
  if (error) return fail(await writeFailure(db, orgId, error));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, "tables", tableId));
  return ok(undefined);
}

/** Cambia el tiempo mínimo entre dos llamados del mismo tipo desde una mesa de la sucursal (solo el Dueño, lo decide la base). */
export async function setBranchCooldown(db: Db, orgId: string, branchId: string, rawSeconds: unknown): Promise<Result<{ seconds: number }>> {
  const parsed = parseCooldown(rawSeconds);
  if (!parsed.ok) return fail(parsed.problem === "blank" ? "cooldown_blank" : "cooldown_invalid");

  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db
    .from("branches")
    .update({ waiter_call_cooldown_seconds: parsed.seconds })
    .eq("id", branchId)
    .eq("organization_id", orgId)
    .select("id, waiter_call_cooldown_seconds");
  if (error) return fail(await writeFailure(db, orgId, error));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, "branches", branchId));
  return ok({ seconds: data[0].waiter_call_cooldown_seconds });
}
