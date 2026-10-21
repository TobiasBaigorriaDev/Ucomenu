import type { SupabaseClient } from "@supabase/supabase-js";
import { detectImage } from "@/lib/carta/images";
import { guard, parseSwap, writeFailure, type CartaError, type Swap } from "@/lib/carta/catalog";
import type { Database } from "@/lib/supabase/database.types";
import { isOwnLogoPath, LOGO_BUCKET, MAX_LOGO_BYTES } from "./logos";
import { isPalette } from "./palettes";

type Db = SupabaseClient<Database>;
type Identity = Pick<Database["public"]["Tables"]["organizations"]["Row"], "menu_palette" | "logo_path">;
export type IdentityError = CartaError | "palette_invalid";
/** `filesComplete: false` = el logo saliente quedó sin borrar de Storage (registrado en el log); el vigente no se toca. Solo lo informan setLogo y removeLogo. */
export type Result = { ok: true; filesComplete?: boolean } | { ok: false; error: IdentityError };
const ok = { ok: true } as const;
const done = (filesComplete: boolean): Result => ({ ok: true, filesComplete });
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

/** La escritura usa la sesión de la persona; RLS exige Dueño de esta organización. Devuelve `false` si el archivo quedó sin borrar. */
async function removeObject(db: Db, path: string): Promise<boolean> {
  try {
    const result = await db.storage.from(LOGO_BUCKET).remove([path]);
    if (!result.error && result.data.length > 0) return true;
    console.error(`No se pudo limpiar el logo ${path}: ${result.error?.message ?? "cero archivos eliminados"}`);
  } catch (error) {
    console.error(`No se pudo limpiar el logo ${path}: ${String(error)}`);
  }
  return false;
}

/**
 * Cambia el logo (`path`) o lo quita (`null`) con UNA llamada que bloquea la fila de la organización y devuelve la referencia
 * que dejó de usarse (`replace_organization_logo`). Se borra esa ruta exacta: con dos reemplazos simultáneos cada uno borra lo
 * que ÉL desplazó, nunca el logo vigente ni la subida del otro. También se escribe al quitar un logo que ya es nulo: un cliente
 * sin permiso no recibe un éxito vacío.
 */
async function swapLogo(db: Db, orgId: string, path: string | null): Promise<Swap> {
  // `p_path` admite NULL en la base (quita el logo); el tipo generado no distingue argumentos opcionales.
  return parseSwap(await db.rpc("replace_organization_logo", { p_org: orgId, p_path: path as string }));
}

async function afterSwap(db: Db, orgId: string, swap: Swap, uploadedPath: string | null): Promise<Result> {
  if (swap.kind === "none") {
    if (uploadedPath) await removeObject(db, uploadedPath);
    return fail((await guard(db, orgId)) ?? "forbidden");
  }
  if (swap.kind === "rejected") {
    if (uploadedPath) await removeObject(db, uploadedPath);
    return fail(await writeFailure(db, orgId, swap.error));
  }
  if (swap.kind === "uncertain") {
    if (uploadedPath) {
      // Pudo haberse aplicado: se mira el estado real. Si ya apunta al logo nuevo se da por hecho (el saliente no se conoce).
      const now = await loadIdentity(db, orgId).catch(() => null);
      if (now?.logo_path === uploadedPath) {
        console.error(`El logo ${uploadedPath} quedó aplicado pero no se pudo saber cuál reemplazó: el anterior pudo quedar sin borrar.`);
        return done(false);
      }
      console.error(`No se pudo confirmar si el logo ${uploadedPath} quedó aplicado: no se borra por las dudas.`);
    }
    return fail("uncertain");
  }
  const outgoing = swap.previous;
  if (outgoing && outgoing !== uploadedPath && isOwnLogoPath(outgoing, orgId)) {
    return done(await removeObject(db, outgoing));
  }
  return done(true);
}

export async function setLogo(db: Db, orgId: string, file: File | null): Promise<Result> {
  if (!file || file.size === 0) return fail("image_missing");
  if (file.size > MAX_LOGO_BYTES) return fail("image_big");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectImage(bytes);
  if (!kind) return fail("image_type");
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);
  const path = `${orgId}/${crypto.randomUUID()}.${kind.ext}`;
  const uploaded = await db.storage.from(LOGO_BUCKET).upload(path, bytes, { contentType: kind.mime, upsert: false });
  if (uploaded.error) return fail((await guard(db, orgId)) ?? "image_failed");
  return afterSwap(db, orgId, await swapLogo(db, orgId, path), path);
}

export async function removeLogo(db: Db, orgId: string): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);
  return afterSwap(db, orgId, await swapLogo(db, orgId, null), null);
}
