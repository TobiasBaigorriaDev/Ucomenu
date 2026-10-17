import type { SupabaseClient } from "@supabase/supabase-js";
import { detectImage } from "@/lib/carta/images";
import { guard, writeFailure, type CartaError } from "@/lib/carta/catalog";
import type { Database } from "@/lib/supabase/database.types";
import { isOwnLogoPath, LOGO_BUCKET, MAX_LOGO_BYTES } from "./logos";
import { isPalette } from "./palettes";

type Db = SupabaseClient<Database>;
type Identity = Pick<Database["public"]["Tables"]["organizations"]["Row"], "menu_palette" | "logo_path">;
export type IdentityError = CartaError | "palette_invalid";
export type Result = { ok: true } | { ok: false; error: IdentityError };
const ok = { ok: true } as const;
const fail = (error: IdentityError): Result => ({ ok: false, error });

export async function loadIdentity(db: Db, orgId: string): Promise<Identity> {
  const result = await db.from("organizations").select("menu_palette, logo_path").eq("id", orgId).single();
  if (result.error) throw new Error(`No se pudo leer la apariencia: ${result.error.message}`);
  return result.data;
}

async function save(db: Db, orgId: string, patch: Partial<Identity>): Promise<Result> {
  const result = await db.from("organizations").update(patch).eq("id", orgId).select("id");
  if (result.error) return fail(await writeFailure(db, orgId, result.error));
  if (result.data.length === 0) return fail((await guard(db, orgId)) ?? "forbidden");
  return ok;
}

export async function setPalette(db: Db, orgId: string, value: unknown): Promise<Result> {
  if (!isPalette(value)) return fail("palette_invalid");
  const blocked = await guard(db, orgId);
  return blocked ? fail(blocked) : save(db, orgId, { menu_palette: value });
}

/** La escritura usa la sesión de la persona; RLS exige Dueño de esta organización. */
async function removeObject(db: Db, path: string) {
  const result = await db.storage.from(LOGO_BUCKET).remove([path]);
  if (result.error || result.data.length === 0) {
    console.error(`No se pudo limpiar el logo ${path}: ${result.error?.message ?? "cero archivos eliminados"}`);
  }
}

export async function setLogo(db: Db, orgId: string, file: File | null): Promise<Result> {
  if (!file || file.size === 0) return fail("image_missing");
  if (file.size > MAX_LOGO_BYTES) return fail("image_big");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectImage(bytes);
  if (!kind) return fail("image_type");
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);
  const previous = await loadIdentity(db, orgId);
  const path = `${orgId}/${crypto.randomUUID()}.${kind.ext}`;
  const uploaded = await db.storage.from(LOGO_BUCKET).upload(path, bytes, { contentType: kind.mime, upsert: false });
  if (uploaded.error) return fail((await guard(db, orgId)) ?? "image_failed");
  const saved = await save(db, orgId, { logo_path: path });
  if (!saved.ok) {
    await removeObject(db, path);
    return saved;
  }
  if (previous.logo_path && isOwnLogoPath(previous.logo_path, orgId)) await removeObject(db, previous.logo_path);
  return ok;
}

export async function removeLogo(db: Db, orgId: string): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);
  const previous = await loadIdentity(db, orgId);
  // También se escribe cuando ya es nulo: un cliente sin permiso no recibe un éxito vacío.
  const saved = await save(db, orgId, { logo_path: null });
  if (saved.ok && previous.logo_path && isOwnLogoPath(previous.logo_path, orgId)) await removeObject(db, previous.logo_path);
  return saved;
}
