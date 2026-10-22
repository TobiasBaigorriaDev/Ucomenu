import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEntitlements, type Entitlements } from "@/lib/entitlements";
import { readAllByKey } from "@/lib/paginar";
import type { Database } from "@/lib/supabase/database.types";
import { parseTitle, VIDEO_COLUMNS, type VideoRow } from "./estado";
import { videoErrorFromDb, writeBlock, type VideoError } from "./mensajes";

/**
 * Gestión de videos desde el panel (ficha videos-del-panel-base). Todo con el cliente de la PERSONA (rol `authenticated`,
 * RLS): membresía, cuenta al día, plan y cupo viven en la base. Este módulo no los reemplaza: los muestra con mensajes claros y NO da
 * por hecho un guardado que la base descartó. Un UPDATE bloqueado por RLS afecta 0 filas SIN error, así que toda
 * escritura pide de vuelta las filas afectadas (`.select()`) y trata «0 filas» como un fallo con su causa.
 */

type Db = SupabaseClient<Database>;

export type VideoResult<T = void> = { ok: true; data: T } | { ok: false; error: VideoError };
const ok = <T>(data: T): VideoResult<T> => ({ ok: true, data });
const fail = (error: VideoError): VideoResult<never> => ({ ok: false, error });

export type ProductOption = { id: string; name: string };

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Los videos del local en el orden en que se ven. Hay a lo sumo 50 por organización (tope técnico de la base). */
export async function loadVideos(db: Db, orgId: string): Promise<VideoRow[]> {
  const { data, error } = await db
    .from("menu_videos")
    .select(VIDEO_COLUMNS)
    .eq("organization_id", orgId)
    .order("sort_order")
    .order("created_at")
    .order("id")
    .limit(100);
  if (error) throw new Error(`No se pudieron leer los videos: ${error.message}`);
  return data as VideoRow[];
}

/** Los platos del local, para enlazar un video («Ver plato»). Por páginas: PostgREST corta cada lectura en 1000 filas. */
export async function loadProductOptions(db: Db, orgId: string): Promise<ProductOption[]> {
  const { data, error } = await readAllByKey((after, limit) => {
    const query = db.from("products").select("id, name").eq("organization_id", orgId);
    return (after ? query.gt("id", after) : query).order("id").limit(limit);
  });
  if (error) throw new Error(`No se pudieron leer los platos: ${error.message}`);
  return (data ?? []).sort((a, b) => a.name.localeCompare(b.name, "es"));
}

// ---------------------------------------------------------------------------
// Apoyo
// ---------------------------------------------------------------------------

async function entitlementsOf(db: Db, orgId: string): Promise<Entitlements | null> {
  const { data, error } = await db.rpc("org_entitlements", { p_org: orgId });
  return error ? null : parseEntitlements(data);
}

/** Corta antes de escribir si la cuenta está en solo lectura o suspendida (la base también lo impediría). */
async function guard(db: Db, orgId: string): Promise<VideoError | null> {
  return writeBlock(await entitlementsOf(db, orgId));
}

/** Una escritura devolvió 0 filas: o el video no existe en este local, o la base lo bloqueó. Se distingue leyendo. */
async function explainZeroRows(db: Db, orgId: string, id: string): Promise<VideoError> {
  const { data, error } = await db.from("menu_videos").select("id").eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (error) return "unexpected";
  return data ? (await guard(db, orgId)) ?? "forbidden" : "not_found";
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/** Cambia el nombre y el plato enlazado (`productId` vacío = sin enlace). */
export async function updateVideo(
  db: Db,
  orgId: string,
  id: string,
  values: { title: unknown; productId: string | null },
): Promise<VideoResult> {
  const title = parseTitle(values.title);
  if (!title.ok) return fail(title.problem === "blank" ? "title_blank" : "title_too_long");
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db
    .from("menu_videos")
    .update({ title: title.title, product_id: values.productId })
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id");
  if (error) return fail(videoErrorFromDb(error, "title"));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, id));
  return ok(undefined);
}

/** Publica o despublica. La base valida que esté procesado, el plan y el cupo. */
export async function setVideoPublished(db: Db, orgId: string, id: string, published: boolean): Promise<VideoResult> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db
    .from("menu_videos")
    .update({ status: published ? "published" : "draft" })
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id");
  if (error) return fail(videoErrorFromDb(error, "publish"));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, id));
  return ok(undefined);
}

/**
 * Primer paso del borrado: el video pasa a «deleting» (estado terminal: sale de los publicados y del cupo). La persona no tiene
 * `DELETE`; el segundo paso (`borrado.ts`) borra el asset en Mux y la fila con la clave de servicio. Repetirlo es seguro.
 */
export async function requestVideoDeletion(db: Db, orgId: string, id: string): Promise<VideoResult> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db
    .from("menu_videos")
    .update({ status: "deleting" })
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id");
  if (error) return fail(videoErrorFromDb(error));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, id));
  return ok(undefined);
}
