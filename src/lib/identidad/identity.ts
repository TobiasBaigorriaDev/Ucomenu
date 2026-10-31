import type { SupabaseClient } from "@supabase/supabase-js";
import { detectImage } from "@/lib/carta/images";
import { guard, parseSwap, writeFailure, type CartaError, type Swap } from "@/lib/carta/catalog";
import type { Database } from "@/lib/supabase/database.types";
import { isOwnLogoPath, LOGO_BUCKET, MAX_LOGO_BYTES } from "./logos";
import { isAmbient } from "./ambientes";
import { isDensity, isShape } from "./formas";
import { isLayout } from "./layouts";
import { isPalette } from "./palettes";
import { isDay, isTheme, NO_THEME } from "./temas";
import { isFont } from "./tipografias";
import { validateHours, validateInstagram, validateTagline, validateWhatsapp, type TextProblem } from "./voz";

type Db = SupabaseClient<Database>;
const IDENTITY_COLUMNS = "menu_palette, menu_layout, menu_theme, menu_theme_from, menu_theme_until, logo_path, menu_font, menu_shape, menu_density, menu_ambient, menu_tagline, opening_hours, instagram_handle, whatsapp_number, cover_path" as const;
type Identity = Pick<Database["public"]["Tables"]["organizations"]["Row"], "menu_palette" | "menu_layout" | "menu_theme" | "menu_theme_from" | "menu_theme_until" | "logo_path" | "menu_font" | "menu_shape" | "menu_density" | "menu_ambient" | "menu_tagline" | "opening_hours" | "instagram_handle" | "whatsapp_number" | "cover_path">;
export type VoiceError = "tagline_invalid" | "tagline_too_long" | "hours_invalid" | "hours_too_long" | "instagram_invalid" | "instagram_too_long" | "whatsapp_invalid" | "whatsapp_too_long";
export type IdentityError = CartaError | "palette_invalid" | "layout_invalid" | "theme_invalid" | "theme_dates_invalid" | "font_invalid" | "shape_invalid" | "density_invalid" | "ambient_invalid" | VoiceError;
/** `filesComplete: false` = el logo saliente quedó sin borrar de Storage (registrado en el log); el vigente no se toca. Solo lo informan setLogo y removeLogo. */
export type Result = { ok: true; filesComplete?: boolean } | { ok: false; error: IdentityError };
const ok = { ok: true } as const;
const done = (filesComplete: boolean): Result => ({ ok: true, filesComplete });
const fail = (error: IdentityError): Result => ({ ok: false, error });

export async function loadIdentity(db: Db, orgId: string): Promise<Identity> {
  const result = await db.from("organizations").select(IDENTITY_COLUMNS).eq("id", orgId).single();
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

export async function setLayout(db: Db, orgId: string, value: unknown): Promise<Result> {
  if (!isLayout(value)) return fail("layout_invalid");
  const blocked = await guard(db, orgId);
  return blocked ? fail(blocked) : save(db, orgId, { menu_layout: value });
}

export async function setFont(db: Db, orgId: string, value: unknown): Promise<Result> {
  if (!isFont(value)) return fail("font_invalid");
  const blocked = await guard(db, orgId);
  return blocked ? fail(blocked) : save(db, orgId, { menu_font: value });
}

/** Forma (esquinas y bordes) y densidad se guardan juntas: son un solo formulario y una sola vista previa. */
export async function setShape(db: Db, orgId: string, shape: unknown, density: unknown): Promise<Result> {
  if (!isShape(shape)) return fail("shape_invalid");
  if (!isDensity(density)) return fail("density_invalid");
  const blocked = await guard(db, orgId);
  return blocked ? fail(blocked) : save(db, orgId, { menu_shape: shape, menu_density: density });
}

/**
 * Guarda de una vez las seis opciones de estilo (paleta, estilo de carta, tipografía, forma, densidad y ambientación): lo que el panel
 * muestra en la vista previa es lo que se publica, en UNA escritura (o todo o nada). Cada valor se valida contra su catálogo cerrado.
 */
export async function setStyle(
  db: Db,
  orgId: string,
  input: { palette: unknown; layout: unknown; font: unknown; shape: unknown; density: unknown; ambient: unknown },
): Promise<Result> {
  if (!isPalette(input.palette)) return fail("palette_invalid");
  if (!isLayout(input.layout)) return fail("layout_invalid");
  if (!isFont(input.font)) return fail("font_invalid");
  if (!isShape(input.shape)) return fail("shape_invalid");
  if (!isDensity(input.density)) return fail("density_invalid");
  if (!isAmbient(input.ambient)) return fail("ambient_invalid");
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);
  return save(db, orgId, { menu_palette: input.palette, menu_layout: input.layout, menu_font: input.font, menu_shape: input.shape, menu_density: input.density, menu_ambient: input.ambient });
}

export async function setAmbient(db: Db, orgId: string, value: unknown): Promise<Result> {
  if (!isAmbient(value)) return fail("ambient_invalid");
  const blocked = await guard(db, orgId);
  return blocked ? fail(blocked) : save(db, orgId, { menu_ambient: value });
}

const textError = (field: "tagline" | "hours" | "instagram" | "whatsapp", problem: TextProblem): VoiceError => `${field}_${problem}`;

/**
 * Guarda la voz del local (lema, horarios, Instagram, WhatsApp). Cada campo vacío se quita. Se guardan identificadores validados,
 * nunca direcciones: el servidor arma los enlaces al mostrarlos (ver `voz.ts`).
 */
export async function setVoice(db: Db, orgId: string, input: { tagline: unknown; hours: unknown; instagram: unknown; whatsapp: unknown }): Promise<Result> {
  const tagline = validateTagline(input.tagline);
  if (!tagline.ok) return fail(textError("tagline", tagline.problem));
  const hours = validateHours(input.hours);
  if (!hours.ok) return fail(textError("hours", hours.problem));
  const instagram = validateInstagram(input.instagram);
  if (!instagram.ok) return fail(textError("instagram", instagram.problem));
  const whatsapp = validateWhatsapp(input.whatsapp);
  if (!whatsapp.ok) return fail(textError("whatsapp", whatsapp.problem));
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);
  return save(db, orgId, { menu_tagline: tagline.value, opening_hours: hours.value, instagram_handle: instagram.value, whatsapp_number: whatsapp.value });
}

/**
 * Guarda el tema de fecha especial y su ventana. `theme` es `ninguno` o un tema conocido; `from` / `until` son fechas del
 * calendario (`AAAA-MM-DD`) o vacías, con `until >= from`. Sin tema se borran las fechas: no quedan restos de un tema anterior.
 */
export async function setTheme(db: Db, orgId: string, theme: unknown, from: unknown, until: unknown): Promise<Result> {
  if (theme !== NO_THEME && !isTheme(theme)) return fail("theme_invalid");
  const day = (value: unknown): string | null | undefined => (value === null || value === undefined || value === "" ? null : isDay(value) ? value : undefined);
  const start = day(from);
  const end = day(until);
  if (start === undefined || end === undefined || (start && end && end < start)) return fail("theme_dates_invalid");
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);
  const none = theme === NO_THEME;
  return save(db, orgId, { menu_theme: theme as string, menu_theme_from: none ? null : start, menu_theme_until: none ? null : end });
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

/** Los dos archivos gráficos de la marca comparten bucket y mecánica; cada uno tiene su columna y su función de reemplazo. */
type Asset = { rpc: "replace_organization_logo" | "replace_organization_cover"; column: "logo_path" | "cover_path"; label: string };
const LOGO: Asset = { rpc: "replace_organization_logo", column: "logo_path", label: "logo" };
const COVER: Asset = { rpc: "replace_organization_cover", column: "cover_path", label: "portada" };

/**
 * Cambia el archivo (`path`) o lo quita (`null`) con UNA llamada que bloquea la fila de la organización y devuelve la referencia
 * que dejó de usarse (`replace_organization_logo` / `replace_organization_cover`). Se borra esa ruta exacta: con dos reemplazos
 * simultáneos cada uno borra lo que ÉL desplazó, nunca el archivo vigente ni la subida del otro. También se escribe al quitar un
 * archivo que ya es nulo: un cliente sin permiso no recibe un éxito vacío.
 */
async function swapAsset(db: Db, orgId: string, asset: Asset, path: string | null): Promise<Swap> {
  // `p_path` admite NULL en la base (quita el archivo); el tipo generado no distingue argumentos opcionales.
  return parseSwap(await db.rpc(asset.rpc, { p_org: orgId, p_path: path as string }));
}

async function afterSwap(db: Db, orgId: string, asset: Asset, swap: Swap, uploadedPath: string | null): Promise<Result> {
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
      // Pudo haberse aplicado: se mira el estado real. Si ya apunta al archivo nuevo se da por hecho (el saliente no se conoce).
      const now = await loadIdentity(db, orgId).catch(() => null);
      if (now?.[asset.column] === uploadedPath) {
        console.error(`El archivo ${uploadedPath} (${asset.label}) quedó aplicado pero no se pudo saber cuál reemplazó: el anterior pudo quedar sin borrar.`);
        return done(false);
      }
      console.error(`No se pudo confirmar si el archivo ${uploadedPath} (${asset.label}) quedó aplicado: no se borra por las dudas.`);
    }
    return fail("uncertain");
  }
  const outgoing = swap.previous;
  if (outgoing && outgoing !== uploadedPath && isOwnLogoPath(outgoing, orgId)) {
    return done(await removeObject(db, outgoing));
  }
  return done(true);
}

async function setAsset(db: Db, orgId: string, asset: Asset, file: File | null): Promise<Result> {
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
  return afterSwap(db, orgId, asset, await swapAsset(db, orgId, asset, path), path);
}

async function removeAsset(db: Db, orgId: string, asset: Asset): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);
  return afterSwap(db, orgId, asset, await swapAsset(db, orgId, asset, null), null);
}

export const setLogo = (db: Db, orgId: string, file: File | null): Promise<Result> => setAsset(db, orgId, LOGO, file);
export const removeLogo = (db: Db, orgId: string): Promise<Result> => removeAsset(db, orgId, LOGO);
/** La portada (foto de ambiente de la cabecera, ADR 0050) vive en el mismo bucket que el logo, bajo `{org}/{uuid}.{ext}`. */
export const setCover = (db: Db, orgId: string, file: File | null): Promise<Result> => setAsset(db, orgId, COVER, file);
export const removeCover = (db: Db, orgId: string): Promise<Result> => removeAsset(db, orgId, COVER);
