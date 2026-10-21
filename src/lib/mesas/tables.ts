import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEntitlements, type Entitlements } from "@/lib/entitlements";
import type { Database } from "@/lib/supabase/database.types";
import { sortByLabel, validateLabel } from "./labels";
import { mesasErrorMessage, mesasWriteBlock, type MesasError } from "./messages";
import { isToken } from "./url";

/**
 * Gestión de mesas (ficha mesas-y-qr). Todo con el cliente de la PERSONA (rol `authenticated`, RLS): la
 * autorización de fondo —membresía, cuenta al día, tope de mesas activas por sucursal y regeneración del token—
 * vive en la base. Este módulo la muestra con mensajes claros y NO da por hecho un guardado que la base descartó:
 * un UPDATE bloqueado por RLS afecta 0 filas SIN error, así que toda escritura pide las filas de vuelta.
 */

type Db = SupabaseClient<Database>;

export type Result<T = void> = { ok: true; data: T } | { ok: false; error: MesasError };

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: MesasError): Result<never> => ({ ok: false, error });

export { mesasErrorMessage };
export type { MesasError };

type PgError = { code?: string; message?: string } | null;

const LIMIT_EXCEEDED = "53400";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const INSUFFICIENT_PRIVILEGE = "42501";

/** Valor que se manda para «tocar» la columna: la base lo descarta y genera el token nuevo (migración tables_and_qr). */
const REGENERATE = "regenerar";

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export type Mesa = { id: string; branch_id: string; label: string; qr_token: string; is_active: boolean };
export type BranchWithTables = { id: string; slug: string; name: string; tables: Mesa[] };

const TABLE_COLUMNS = "id, branch_id, label, qr_token, is_active";

/** Las sucursales ACTIVAS de la organización con sus mesas (orden natural por nombre). Las inactivas conservan sus mesas pero no se gestionan acá. */
export async function loadMesas(db: Db, orgId: string): Promise<BranchWithTables[]> {
  const [branches, tables] = await Promise.all([
    db.from("branches").select("id, slug, name").eq("organization_id", orgId).eq("is_active", true).order("name"),
    db.from("tables").select(TABLE_COLUMNS).eq("organization_id", orgId),
  ]);
  if (branches.error) throw new Error(`No se pudieron leer las sucursales: ${branches.error.message}`);
  if (tables.error) throw new Error(`No se pudieron leer las mesas: ${tables.error.message}`);

  return branches.data.map((branch) => ({
    ...branch,
    tables: sortByLabel(tables.data.filter((table) => table.branch_id === branch.id)),
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
async function guard(db: Db, orgId: string): Promise<MesasError | null> {
  return mesasWriteBlock(await entitlementsOf(db, orgId));
}

/** Una escritura devolvió 0 filas: o la mesa no existe en esta organización, o la base la bloqueó. Se distingue leyendo. */
async function explainZeroRows(db: Db, orgId: string, id: string): Promise<MesasError> {
  const { data, error } = await db.from("tables").select("id").eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (error) return "unexpected";
  if (!data) return "not_found";
  return (await guard(db, orgId)) ?? "unexpected";
}

/** Traduce el error de una escritura. El RLS rechazado (42501) se confirma leyendo el estado de la cuenta. */
async function writeFailure(db: Db, orgId: string, error: NonNullable<PgError>): Promise<MesasError> {
  switch (error.code) {
    case LIMIT_EXCEEDED:
      return "limit";
    case UNIQUE_VIOLATION:
      return "label_duplicate";
    case FOREIGN_KEY_VIOLATION:
      return "branch_invalid";
    case INSUFFICIENT_PRIVILEGE:
      return (await guard(db, orgId)) ?? "forbidden";
    default:
      return "unexpected";
  }
}

function parseLabel(raw: string): Result<string> {
  const label = validateLabel(raw);
  if (label.ok) return ok(label.value);
  return fail(label.problem === "blank" ? "label_blank" : "label_too_long");
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

export async function createTable(
  db: Db,
  orgId: string,
  input: { branchId: string; label: string; active?: boolean },
): Promise<Result<{ id: string }>> {
  const label = parseLabel(input.label);
  if (!label.ok) return label;

  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const branch = await db.from("branches").select("id").eq("id", input.branchId).eq("organization_id", orgId).eq("is_active", true).maybeSingle();
  if (branch.error) return fail("unexpected");
  if (!branch.data) return fail("branch_invalid");

  const { data, error } = await db
    .from("tables")
    .insert({ organization_id: orgId, branch_id: input.branchId, label: label.data, is_active: input.active ?? true })
    .select("id")
    .single();
  if (error) return fail(await writeFailure(db, orgId, error));
  return ok({ id: data.id });
}

export async function renameTable(db: Db, orgId: string, id: string, rawLabel: string): Promise<Result> {
  const label = parseLabel(rawLabel);
  if (!label.ok) return label;

  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db.from("tables").update({ label: label.data }).eq("id", id).eq("organization_id", orgId).select("id");
  if (error) return fail(await writeFailure(db, orgId, error));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, id));
  return ok(undefined);
}

export async function setTableActive(db: Db, orgId: string, id: string, active: boolean): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db.from("tables").update({ is_active: active }).eq("id", id).eq("organization_id", orgId).select("id");
  if (error) return fail(await writeFailure(db, orgId, error));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, id));
  return ok(undefined);
}

/**
 * Borra una mesa para siempre: su QR deja de resolver y sus llamados se van con ella (cascada, ficha borrado-de-mesas).
 * Un `DELETE` bloqueado por RLS afecta 0 filas sin error, por eso se piden las filas de vuelta.
 */
export async function deleteTable(db: Db, orgId: string, id: string): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db.from("tables").delete().eq("id", id).eq("organization_id", orgId).select("id");
  if (error) return fail(await writeFailure(db, orgId, error));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, id));
  return ok(undefined);
}

/** Regenera el QR: el token anterior deja de resolver. Comprueba que el token realmente cambió. */
export async function regenerateTableQr(db: Db, orgId: string, id: string): Promise<Result<{ token: string }>> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const before = await db.from("tables").select("qr_token").eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (before.error) return fail("unexpected");
  if (!before.data) return fail("not_found");

  const { data, error } = await db
    .from("tables")
    .update({ qr_token: REGENERATE })
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("qr_token");
  if (error) return fail(await writeFailure(db, orgId, error));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, id));

  const token = data[0].qr_token;
  if (!isToken(token) || token === before.data.qr_token) return fail("unexpected");
  return ok({ token });
}

// ---------------------------------------------------------------------------
// Entrada pública
// ---------------------------------------------------------------------------

export type ResolvedTable = {
  orgSlug: string;
  orgName: string;
  branchSlug: string;
  tableLabel: string;
  tableActive: boolean;
  status: "available" | "suspended" | "inactive"; // inactive = la sucursal está desactivada (ficha desactivar-sucursales)
  /** La base informa que se puede llamar al mozo desde esta mesa (mesa activa, no silenciada, plan y cuenta al día). */
  callsEnabled: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Lee la respuesta de `resolve_table_qr`. Cualquier forma inesperada es «no existe» (falla cerrado). */
export function parseResolvedTable(raw: unknown): ResolvedTable | null {
  if (!isRecord(raw)) return null;
  const { org_slug, org_name, branch_slug, table_label, table_active, status, calls_enabled } = raw;
  if (
    typeof org_slug !== "string" ||
    typeof org_name !== "string" ||
    typeof branch_slug !== "string" ||
    typeof table_label !== "string" ||
    typeof table_active !== "boolean" ||
    typeof calls_enabled !== "boolean" ||
    (status !== "available" && status !== "suspended" && status !== "inactive")
  ) {
    return null;
  }
  return { orgSlug: org_slug, orgName: org_name, branchSlug: branch_slug, tableLabel: table_label, tableActive: table_active, status, callsEnabled: calls_enabled };
}
