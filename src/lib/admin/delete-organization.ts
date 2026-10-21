import type { SupabaseClient } from "@supabase/supabase-js";
import { IMAGE_BUCKET } from "@/lib/carta/images";
import { LOGO_BUCKET } from "@/lib/identidad/logos";
import type { Database } from "@/lib/supabase/database.types";
import { fail, isPlatformAdmin, ok, type AdminContext, type Result } from "./organizations";
import { dbFailure, findOrgId } from "./subscriptions";
import { parseReason, parseSlug } from "./validation";

/**
 * Borrado definitivo de una organización (nivel C, ficha borrado-de-organizaciones, ADR 0028).
 *
 * Mismo patrón que las demás acciones de SuperAdmin (ADR 0013): la identidad se prueba con la sesión de la PERSONA antes de
 * usar la clave de servicio, y el borrado es UNA función de base (`admin_delete_organization`) que vuelve a comprobar al
 * actor, exige la baja auditada de 30 días, purga el historial de precios, borra y audita en la misma transacción. La base
 * es la autoridad: esto solo valida antes para dar un mensaje claro y, DESPUÉS de confirmar la transacción, borra los
 * archivos de Storage (que la base no puede borrar).
 */

/** Días que tiene que llevar de baja una organización para poder borrarla (ADR 0026; lo exige la base). */
export const DELETION_WAIT_DAYS = 30;
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Desde cuándo se puede borrar una organización dada de baja el `deactivatedAt` (ISO): 30 días después. `null` si no hay
 * baja auditada (activa, reactivada o puesta de baja a mano): no se puede borrar hasta darla de baja de verdad.
 */
export function deletionAvailableAt(deactivatedAt: string | null): Date | null {
  if (!deactivatedAt) return null;
  const at = new Date(deactivatedAt);
  return Number.isNaN(at.getTime()) ? null : new Date(at.getTime() + DELETION_WAIT_DAYS * DIA_MS);
}

/** ¿Pasó el plazo? Solo orienta la pantalla (muestra o no el formulario); la base decide de verdad. */
export function canDeleteNow(deactivatedAt: string | null, now: Date): boolean {
  const available = deletionAvailableAt(deactivatedAt);
  return available !== null && available.getTime() <= now.getTime();
}

type Db = SupabaseClient<Database>;

/** Resultado de borrar los archivos de Storage de la organización. */
export type FilesCleanup = { removed: number; complete: boolean };

const BUCKETS = [IMAGE_BUCKET, LOGO_BUCKET] as const;
const PAGE = 100;
/** `product-images` guarda `{org}/{plato}/{archivo}`: una carpeta de más que el logo. Tope por si algo se enloquece. */
const MAX_DEPTH = 4;

/** Rutas de todos los archivos bajo `prefix` (recorre carpetas). Lanza si Storage falla. */
async function listFiles(db: Db, bucket: string, prefix: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) throw new Error(`carpeta demasiado profunda: ${prefix}`);
  const files: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(error.message);
    for (const entry of data) {
      const path = `${prefix}/${entry.name}`;
      // Una carpeta no tiene id ni metadatos; un archivo sí.
      if (entry.id === null || entry.id === undefined) files.push(...(await listFiles(db, bucket, path, depth + 1)));
      else files.push(path);
    }
    if (data.length < PAGE) return files;
  }
}

/**
 * Borra los archivos de Storage de una organización YA borrada (`product-images/{org}/…` y `organization-logos/{org}/…`).
 * Nunca lanza: si algo falla devuelve `complete: false` y deja el aviso en el registro del servidor con el id de la
 * organización (que sobrevive en la auditoría) para poder repetir la limpieza.
 */
export async function removeOrganizationFiles(db: Db, orgId: string): Promise<FilesCleanup> {
  let removed = 0;
  let complete = true;
  for (const bucket of BUCKETS) {
    try {
      const paths = await listFiles(db, bucket, orgId);
      for (let i = 0; i < paths.length; i += PAGE) {
        const chunk = paths.slice(i, i + PAGE);
        const { data, error } = await db.storage.from(bucket).remove(chunk);
        if (error) throw new Error(error.message);
        removed += data.length;
        if (data.length < chunk.length) complete = false;
      }
    } catch (error) {
      complete = false;
      console.error(`[admin] archivos de Storage sin borrar tras el borrado de la organización ${orgId} (${bucket}): ${String(error)}`);
    }
  }
  return { removed, complete };
}

export type DeleteOrganizationInput = {
  slug: unknown;
  /** El identificador escrito por la persona para confirmar. */
  confirmSlug: unknown;
  reason: unknown;
};

export type DeletedOrganization = { slug: string; priceHistoryPurged: number; paymentsKept: number; files: FilesCleanup };

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/**
 * Borra una organización dada de baja hace 30 días o más. Irreversible: los archivos y las filas no vuelven (solo el respaldo
 * de docs/operacion.md). Los pagos se conservan (ADR 0027).
 */
export async function deleteOrganization(ctx: AdminContext, input: DeleteOrganizationInput): Promise<Result<DeletedOrganization>> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");
  const slug = parseSlug(input.slug);
  if (!slug) return fail("org_not_found");
  // La confirmación es el identificador EXACTO (la base lo vuelve a comprobar): sin mayúsculas ni variantes.
  if (typeof input.confirmSlug !== "string" || input.confirmSlug.trim() !== slug) return fail("slug_mismatch");
  const reason = parseReason(input.reason);
  if (!reason) return fail("invalid_reason");
  const org = await findOrgId(ctx, slug);
  if (!org.ok) return org;

  const { data, error } = await ctx.admin.rpc("admin_delete_organization", {
    p_actor: ctx.actorId,
    p_org: org.data,
    p_slug: slug,
    p_reason: reason,
  });
  if (error) return dbFailure(error);

  // La transacción se confirmó: la organización ya no existe. Recién ahora se limpian los archivos (si se hubiera hecho antes
  // y la base fallara, una organización que sigue existiendo habría perdido sus fotos).
  const summary = typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
  const files = await removeOrganizationFiles(ctx.admin, org.data);
  return ok({
    slug,
    priceHistoryPurged: count((summary as Record<string, unknown>).price_history_purged),
    paymentsKept: count((summary as Record<string, unknown>).payments_kept),
    files,
  });
}
