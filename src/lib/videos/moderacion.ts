import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { writeBlock } from "./mensajes";
import { entitlementsOf } from "./videos";

/**
 * Moderación de comentarios desde el panel (ficha comentarios-del-feed, ADR 0031). Todo con el cliente de la PERSONA (rol
 * `authenticated`, RLS): membresía y cuenta viven en la base. Este módulo no las reemplaza: las muestra con mensajes claros y NO da por
 * hecho un cambio que la base descartó (un UPDATE bloqueado por RLS afecta 0 filas SIN error, así que se pide de vuelta la fila).
 *
 * Regla de fondo: **aprobar** exige la cuenta al día (que escribe); **rechazar o retirar** nunca se bloquea por mora.
 */

type Db = SupabaseClient<Database>;

export type CommentStatus = "pending" | "approved" | "rejected";

/** Días que se conserva un comentario rechazado antes de que la purga lo borre (por defecto de `purge_video_comments`). */
export const REJECTED_RETENTION_DAYS = 7;
/** Días que espera un comentario sin moderar antes de que la purga lo borre. */
export const PENDING_RETENTION_DAYS = 30;
/** Pendientes por organización antes de que los comensales no puedan enviar más (mismo tope que la base). */
export const PENDING_CAP = 100;
/** Filas que muestra cada lista. */
export const LIST_LIMIT = 50;

export type ModerationComment = {
  id: string;
  video_id: string;
  alias: string | null;
  body: string;
  status: CommentStatus;
  created_at: string;
  moderated_at: string | null;
};

/** Las columnas que Dueño y Staff pueden leer: la clave de conexión (`rate_key`) no se les concede. */
const COLUMNS = "id, video_id, alias, body, status, created_at, moderated_at";

export type ModerationList = { rows: ModerationComment[]; total: number };

/**
 * Una lista de la cola: los pendientes del más viejo al más nuevo (el que más espera, primero); los demás, del más nuevo al más viejo.
 * Trae hasta `LIST_LIMIT` y el total real. Lanza si la base falla.
 */
export async function loadModerationList(db: Db, orgId: string, status: CommentStatus): Promise<ModerationList> {
  const { data, error, count } = await db
    .from("video_comments")
    .select(COLUMNS, { count: "exact" })
    .eq("organization_id", orgId)
    .eq("status", status)
    .order(status === "rejected" ? "moderated_at" : "created_at", { ascending: status === "pending" })
    .order("id")
    .limit(LIST_LIMIT);
  if (error) throw new Error(`No se pudieron leer los comentarios: ${error.message}`);
  return { rows: (data ?? []) as ModerationComment[], total: count ?? data?.length ?? 0 };
}

export type ModerationError = "blocked_read_only" | "blocked_suspended" | "forbidden" | "not_found" | "uncertain" | "unexpected";
export type ModerationResult = { ok: true } | { ok: false; error: ModerationError };

const MESSAGE: Record<ModerationError, string> = {
  blocked_read_only: "Tu cuenta está en solo lectura: no se pueden aprobar comentarios hasta regularizar el pago. Sí podés rechazarlos o retirarlos.",
  blocked_suspended: "La cuenta está suspendida: no se pueden aprobar comentarios hasta regularizar el pago. Sí podés rechazarlos o retirarlos.",
  forbidden: "No tenés permiso para moderar los comentarios de este local.",
  not_found: "No encontramos ese comentario. Puede que ya se haya borrado: recargá la página.",
  uncertain: "No pudimos confirmar si el cambio se guardó. Recargá la página y mirá cómo quedó antes de repetirlo.",
  unexpected: "No se pudo completar la acción. Probá de nuevo en unos minutos.",
};

export const moderationMessage = (error: ModerationError): string => MESSAGE[error];

const SQL_INSUFFICIENT_PRIVILEGE = "42501";

/**
 * Aprueba o rechaza un comentario (también retira uno publicado y recupera uno rechazado). Aprobar corta antes de escribir si la
 * cuenta no escribe (la base también lo impide); rechazar no mira la cuenta.
 */
export async function moderateComment(db: Db, orgId: string, id: string, status: "approved" | "rejected"): Promise<ModerationResult> {
  if (status === "approved") {
    const blocked = writeBlock(await entitlementsOf(db, orgId));
    if (blocked === "blocked_read_only" || blocked === "blocked_suspended") return { ok: false, error: blocked };
    if (blocked) return { ok: false, error: "unexpected" };
  }

  const { data, error } = await db.from("video_comments").update({ status }).eq("id", id).eq("organization_id", orgId).select("id");
  if (error) {
    if (!error.code) return { ok: false, error: "uncertain" }; // sin código es la red: el cambio pudo quedar hecho
    if (error.code === SQL_INSUFFICIENT_PRIVILEGE) {
      // Aprobar con la cuenta que cambió de estado entre la lectura y la escritura.
      return { ok: false, error: status === "approved" ? await blockedOrForbidden(db, orgId) : "forbidden" };
    }
    return { ok: false, error: "unexpected" };
  }
  return data.length > 0 ? { ok: true } : { ok: false, error: "not_found" };
}

async function blockedOrForbidden(db: Db, orgId: string): Promise<ModerationError> {
  const blocked = writeBlock(await entitlementsOf(db, orgId));
  return blocked === "blocked_read_only" || blocked === "blocked_suspended" ? blocked : "forbidden";
}
