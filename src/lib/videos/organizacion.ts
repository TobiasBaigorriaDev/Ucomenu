import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { MuxClient } from "./mux";

type Db = SupabaseClient<Database>;

/** Lo que una organización tiene en Mux: el asset de cada video o, si todavía no lo tiene, su subida abierta. */
export type MuxItem = { assetId: string | null; uploadId: string | null };

/** Resultado de limpiar Mux al borrar una organización. */
export type MuxCleanup = { removed: number; complete: boolean };

/**
 * Los identificadores de Mux de TODOS los videos de la organización (también los borradores y los que se estaban borrando). Se
 * leen ANTES del borrado definitivo: después las filas ya no existen y no habría cómo saber qué assets limpiar. `null` si no se
 * pudo leer (el borrado se frena: mejor no borrar que dejar assets perdidos).
 */
export async function collectOrganizationMux(admin: Db, orgId: string): Promise<MuxItem[] | null> {
  // Hay a lo sumo 50 videos por organización (tope técnico de la base).
  const { data, error } = await admin.from("menu_videos").select("mux_asset_id, mux_upload_id").eq("organization_id", orgId).limit(200);
  if (error || !data) return null;
  return data
    .filter((row) => row.mux_asset_id !== null || row.mux_upload_id !== null)
    .map((row) => ({ assetId: row.mux_asset_id, uploadId: row.mux_upload_id }));
}

/**
 * Borra en Mux los assets (y cancela las subidas abiertas) de una organización YA borrada. Nunca lanza: si algo falla devuelve
 * `complete: false` y deja en el registro del servidor el id de cada asset o subida que quedó, junto con el de la organización,
 * para limpiarlo a mano.
 */
export async function removeOrganizationMux(mux: MuxClient | null, orgId: string, items: MuxItem[]): Promise<MuxCleanup> {
  if (items.length === 0) return { removed: 0, complete: true };
  let removed = 0;
  let complete = true;
  for (const item of items) {
    const label = item.assetId ? `asset ${item.assetId}` : `subida ${item.uploadId}`;
    try {
      if (!mux) throw new Error("Mux no está configurado en este servidor");
      if (item.assetId) await mux.deleteAsset(item.assetId);
      else if (item.uploadId) await mux.cancelUpload(item.uploadId);
      removed += 1;
    } catch (error) {
      complete = false;
      console.error(`[admin] ${label} de Mux sin borrar tras el borrado de la organización ${orgId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { removed, complete };
}
