import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { ALTA_PENDING, BRANCH_PRICE_FIELD, type AltaPending } from "./alta-campos";
import { setProductBranchPrice } from "./availability";
import { fail, ok, PRICE_ERROR, setProductImage, type CartaError, type Result } from "./catalog";
import { detectImage, MAX_IMAGE_BYTES } from "./images";
import { createGroup, createOption, parseGroup, parseOption } from "./options";
import { MAX_GROUPS_PER_PRODUCT, MAX_OPTIONS_PER_GROUP } from "./options-rules";
import { parsePrice } from "./price";
import { asUuid } from "./validation";

/**
 * Alta unificada de un plato: además de los datos, el mismo formulario trae la foto, las variantes y adicionales y el precio propio de
 * cada sucursal (ficha alta-unificada-de-platos). Todo lo que se puede comprobar sin escribir se comprueba ANTES de crear el plato
 * (`parseAltaExtras`): un dato inválido no deja un plato a medias. Después de crearlo, cada pieza se escribe por separado
 * (`saveAltaExtras`) y lo que falle se informa como pendiente, sin volver a crear el plato: se completa desde su editor.
 */

type Db = SupabaseClient<Database>;

export type AltaGroup = { name: string; min: string; max: string; options: { name: string; delta: string }[] };
export type AltaExtras = {
  photo: File | null;
  groups: AltaGroup[];
  /** Precio propio por sucursal, en centavos; solo las sucursales donde el plato se muestra. */
  branchPrices: { branchId: string; cents: number }[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Lee el campo `groups` (JSON que arma el formulario). Una forma que no es la esperada es un error, no se adivina. */
function readGroups(raw: FormDataEntryValue | null): Result<AltaGroup[]> {
  if (raw === null || raw === "") return ok([]);
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    return fail("unexpected");
  }
  if (!Array.isArray(parsed)) return fail("unexpected");
  if (parsed.length > MAX_GROUPS_PER_PRODUCT) return fail("group_cap");

  const groups: AltaGroup[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.min !== "string" || typeof entry.max !== "string" || !Array.isArray(entry.options)) {
      return fail("unexpected");
    }
    if (entry.options.length > MAX_OPTIONS_PER_GROUP) return fail("option_cap");
    const options: AltaGroup["options"] = [];
    for (const option of entry.options) {
      if (!isRecord(option) || typeof option.name !== "string" || typeof option.delta !== "string") return fail("unexpected");
      options.push({ name: option.name, delta: option.delta });
    }
    groups.push({ name: entry.name, min: entry.min, max: entry.max, options });
  }
  return ok(groups);
}

/**
 * Valida todo lo accesorio del alta sin escribir nada. `shown` son las sucursales marcadas: el precio de una que no se muestra se
 * descarta. Un precio de sucursal en blanco significa «usar el precio general».
 */
export async function parseAltaExtras(formData: FormData, shown: ReadonlySet<string>): Promise<Result<AltaExtras>> {
  const photoEntry = formData.get("photo");
  const photo = photoEntry instanceof File && photoEntry.size > 0 ? photoEntry : null;
  if (photo) {
    if (photo.size > MAX_IMAGE_BYTES) return fail("image_big");
    if (!detectImage(new Uint8Array(await photo.slice(0, 16).arrayBuffer()))) return fail("image_type");
  }

  const groups = readGroups(formData.get("groups"));
  if (!groups.ok) return groups;
  for (const group of groups.data) {
    const checked = parseGroup(group);
    if (!checked.ok) return checked;
    for (const option of group.options) {
      const optionChecked = parseOption(option);
      if (!optionChecked.ok) return optionChecked;
    }
  }

  const branchPrices: AltaExtras["branchPrices"] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith(BRANCH_PRICE_FIELD) || typeof value !== "string" || value.trim() === "") continue;
    const branchId = asUuid(key.slice(BRANCH_PRICE_FIELD.length));
    if (!branchId || !shown.has(branchId)) continue;
    const price = parsePrice(value);
    if (!price.ok) return fail(PRICE_ERROR[price.problem]);
    branchPrices.push({ branchId, cents: price.cents });
  }

  return ok({ photo, groups: groups.data, branchPrices });
}

/**
 * Escribe lo accesorio de un plato ya creado. Cada pieza es independiente: si una falla, las demás se intentan igual y se devuelve
 * cuáles quedaron sin guardar. Nunca vuelve a crear el plato.
 */
export async function saveAltaExtras(db: Db, orgId: string, productId: string, extras: AltaExtras): Promise<AltaPending[]> {
  const pending = new Set<AltaPending>();
  const failed = (error: CartaError, piece: AltaPending) => {
    console.error(`Alta de plato: no se pudo guardar ${piece} (${error}).`);
    pending.add(piece);
  };

  if (extras.photo) {
    const result = await setProductImage(db, orgId, productId, extras.photo).catch(() => null);
    if (!result?.ok) failed(result?.error ?? "unexpected", "foto");
  }

  for (const group of extras.groups) {
    const created = await createGroup(db, orgId, productId, group).catch(() => null);
    if (!created?.ok) {
      failed(created?.error ?? "unexpected", "opciones");
      continue;
    }
    for (const option of group.options) {
      const result = await createOption(db, orgId, created.data.id, option).catch(() => null);
      if (!result?.ok) failed(result?.error ?? "unexpected", "opciones");
    }
  }

  for (const { branchId, cents } of extras.branchPrices) {
    const result = await setProductBranchPrice(db, orgId, productId, branchId, cents).catch(() => null);
    if (!result?.ok) failed(result?.error ?? "unexpected", "precios");
  }

  return ALTA_PENDING.filter((piece) => pending.has(piece));
}
