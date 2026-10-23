import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Feed público de videos (ficha feed-de-videos, ADR 0031). La autoridad sobre QUÉ se puede ver es la política de lectura pública
 * de la base (publicado + listo + feed vigente en el plan y la cuenta): estas funciones solo piden lo que la base entrega, con
 * el cliente anónimo y SIN caché (plan, mora y baja tienen que ocultar los videos en el acto).
 */

type Db = SupabaseClient<Database>;

/** Lo que el feed necesita de un video; son columnas públicas (`anon` no lee ninguna otra). */
export type PublicVideo = {
  id: string;
  product_id: string | null;
  title: string;
  mux_playback_id: string;
  duration_seconds: number | null;
  like_count: number;
};

const PUBLIC_COLUMNS = "id, product_id, title, mux_playback_id, duration_seconds, like_count";

/** Hay a lo sumo 50 videos por organización (tope técnico), y publicados, 10 en Premium: una página alcanza. */
const FEED_LIMIT = 50;

/** Los videos publicados de una organización, en el orden del feed. Lanza si la base falla. */
export async function loadPublishedVideos(db: Db, orgId: string): Promise<PublicVideo[]> {
  const { data, error } = await db
    .from("menu_videos")
    .select(PUBLIC_COLUMNS)
    .eq("organization_id", orgId)
    .order("sort_order")
    .order("created_at")
    .order("id")
    .limit(FEED_LIMIT);
  if (error) throw new Error(`No se pudieron leer los videos: ${error.message}`);
  return (data ?? []).filter((row): row is PublicVideo => typeof row.mux_playback_id === "string");
}

/**
 * ¿Hay videos publicados? Para mostrar (o no) el acceso desde la carta. Nunca rompe la carta: si la base falla, `false`
 * (la carta sigue sin el enlace).
 */
export async function hasPublishedVideos(db: Db, orgId: string): Promise<boolean> {
  try {
    const { data, error } = await db.from("menu_videos").select("id").eq("organization_id", orgId).limit(1);
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/** La URL HLS de Mux de un playback público. */
export const hlsUrl = (playbackId: string): string => `https://stream.mux.com/${encodeURIComponent(playbackId)}.m3u8`;

/** El póster (un cuadro del video) que sirve Mux, a un ancho razonable para el teléfono. */
export const posterUrl = (playbackId: string, width = 720): string =>
  `https://image.mux.com/${encodeURIComponent(playbackId)}/thumbnail.jpg?width=${width}&time=1`;

/** Dónde está el feed de una sucursal. */
export const videosHref = (orgSlug: string, branchSlug: string): string => `/m/${orgSlug}/${branchSlug}/videos`;

/**
 * Qué videos se preparan (se les asocia su stream): el que se está viendo y el siguiente. Los demás muestran solo el póster, así
 * el feed no baja video de más ni mantiene varios decodificadores abiertos en el teléfono.
 */
export function slidesToPrepare(active: number, count: number): number[] {
  if (count <= 0 || !Number.isInteger(active) || active < 0 || active >= count) return [];
  return active + 1 < count ? [active, active + 1] : [active];
}

/** El video al que se llega con una flecha (sin pasar de los extremos). */
export function neighbor(active: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, active + direction));
}
