import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEntitlements, type Entitlements } from "@/lib/entitlements";
import type { Database } from "@/lib/supabase/database.types";
import { sucursalesErrorMessage, sucursalesWriteBlock, type SucursalesError } from "./messages";
import { readAllPages } from "@/lib/paginar";
import { DEFAULT_BRANCH_TIME_ZONE, validateBranchName, validateBranchSlug, validateBranchTimeZone, validateReviewLink } from "./rules";

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

export type Sucursal = {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  /** Enlace de reseñas de Google, o `null` si no tiene. */
  reviewUrl: string | null;
  /** Zona horaria IANA de la sucursal (lista cerrada de `rules.ts`). */
  timeZone: string;
  tables: number;
  activeTables: number;
};

const collator = new Intl.Collator("es-AR", { numeric: true, sensitivity: "base" });

/** Las sucursales de la organización, activas e inactivas (orden natural por nombre), con la cantidad de mesas. */
export async function loadSucursales(db: Db, orgId: string): Promise<Sucursal[]> {
  const [branches, tables] = await Promise.all([
    readAllPages((from, to) => db.from("branches").select("id, slug, name, is_active, google_review_url, timezone").eq("organization_id", orgId).order("id").range(from, to)),
    readAllPages((from, to) => db.from("tables").select("branch_id, is_active").eq("organization_id", orgId).order("id").range(from, to)),
  ]);
  if (branches.error) throw new Error(`No se pudieron leer las sucursales: ${branches.error.message}`);
  if (tables.error) throw new Error(`No se pudieron leer las mesas: ${tables.error.message}`);

  const counts = new Map<string, { tables: number; activeTables: number }>();
  for (const table of tables.data ?? []) {
    const count = counts.get(table.branch_id) ?? { tables: 0, activeTables: 0 };
    count.tables += 1;
    if (table.is_active) count.activeTables += 1;
    counts.set(table.branch_id, count);
  }

  return (branches.data ?? [])
    .map(({ is_active, google_review_url, timezone, ...branch }) => ({
      ...branch,
      isActive: is_active,
      reviewUrl: google_review_url,
      timeZone: timezone || DEFAULT_BRANCH_TIME_ZONE,
      ...(counts.get(branch.id) ?? { tables: 0, activeTables: 0 }),
    }))
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

/**
 * Guarda (o quita, si viene vacío) el enlace de reseñas de Google de una sucursal (ficha enlace-de-resenas-de-google). Solo el
 * Dueño y con la cuenta al día: lo imponen la política UPDATE de `branches` y el privilegio por columna. La base vuelve a
 * validar el host (CHECK); acá se valida antes para dar un mensaje claro.
 */
export async function setBranchReviewLink(db: Db, orgId: string, id: string, rawLink: unknown): Promise<Result> {
  const link = validateReviewLink(rawLink);
  if (!link.ok) return fail(link.problem === "too_long" ? "review_link_too_long" : "review_link_invalid");

  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db
    .from("branches")
    .update({ google_review_url: link.value })
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id, google_review_url");
  if (error) return fail(error.code === CHECK_VIOLATION ? "review_link_invalid" : await writeFailure(db, orgId, error));
  if (data.length === 0) {
    const exists = await db.from("branches").select("id").eq("id", id).eq("organization_id", orgId).maybeSingle();
    if (exists.error) return fail("unexpected");
    return fail(exists.data ? "forbidden" : "not_found");
  }
  return data[0].google_review_url === link.value ? ok(undefined) : fail("unexpected");
}

/**
 * Cambia la zona horaria de una sucursal (ficha zona-horaria-por-sucursal). Solo el Dueño y con la cuenta al día: lo imponen la
 * política UPDATE de `branches` y el privilegio por columna. Rige la hora de las promociones y los pedidos, no la facturación.
 * La base vuelve a validar la zona (CHECK con la misma lista); acá se valida antes para dar un mensaje claro.
 */
export async function setBranchTimeZone(db: Db, orgId: string, id: string, rawZone: unknown): Promise<Result> {
  const zone = validateBranchTimeZone(rawZone);
  if (!zone.ok) return fail("time_zone_invalid");

  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db.from("branches").update({ timezone: zone.value }).eq("id", id).eq("organization_id", orgId).select("id, timezone");
  if (error) return fail(error.code === CHECK_VIOLATION ? "time_zone_invalid" : await writeFailure(db, orgId, error));
  if (data.length === 0) {
    const exists = await db.from("branches").select("id").eq("id", id).eq("organization_id", orgId).maybeSingle();
    if (exists.error) return fail("unexpected");
    return fail(exists.data ? "forbidden" : "not_found");
  }
  return data[0].timezone === zone.value ? ok(undefined) : fail("unexpected");
}

/**
 * Desactiva o reactiva una sucursal (ficha desactivar-sucursales). Solo el Dueño y con la cuenta al día: lo imponen la
 * política UPDATE de `branches` y el privilegio por columna `is_active`. Reactivar respeta el tope de sucursales ACTIVAS
 * del plan (trigger de la base, 53400); desactivar nunca se bloquea por el tope. Desactivar la última activa está permitido
 * (la pantalla avisa antes): la carta pública del local queda «no disponible» hasta reactivar. Las mesas no se tocan.
 */
export async function setBranchActive(db: Db, orgId: string, id: string, active: boolean): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db.from("branches").update({ is_active: active }).eq("id", id).eq("organization_id", orgId).select("id, is_active");
  if (error) return fail(error.code === LIMIT_EXCEEDED && active ? "limit_reactivate" : await writeFailure(db, orgId, error));
  if (data.length === 0) {
    const exists = await db.from("branches").select("id").eq("id", id).eq("organization_id", orgId).maybeSingle();
    if (exists.error) return fail("unexpected");
    return fail(exists.data ? "forbidden" : "not_found");
  }
  return data[0].is_active === active ? ok(undefined) : fail("unexpected");
}
