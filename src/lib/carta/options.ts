import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  applyOrder,
  explainZeroRows,
  fail,
  guard,
  loadProduct,
  ok,
  writeFailure,
  type CartaError,
  type Result,
} from "./catalog";
import { changesFor, moveWithin, nextSortOrder, sortForDisplay, type Direction } from "./ordering";
import { parseChoices, parseDelta, type ChoicesProblem } from "./options-rules";
import { validateName } from "./validation";

/**
 * Variantes y adicionales de un plato (ficha variantes-y-adicionales). Mismas reglas que el resto de la carta: se
 * escribe con el cliente de la PERSONA (RLS), la autorización de fondo vive en la base (membresía y cuenta al día) y un
 * UPDATE bloqueado afecta 0 filas SIN error, así que toda escritura pide de vuelta las filas y no da por hecho un guardado
 * que la base descartó.
 */

type Db = SupabaseClient<Database>;

const PROGRAM_LIMIT_EXCEEDED = "54000"; // topes técnicos de grupos y opciones
const FOREIGN_KEY_VIOLATION = "23503";

const CHOICES_ERROR: Record<ChoicesProblem, CartaError> = {
  invalid: "choices_invalid",
  min_over_max: "choices_min_over_max",
  max_range: "choices_max_range",
};

const DELTA_ERROR = { invalid: "price_invalid", too_many_decimals: "price_decimals", too_big: "price_big" } as const;

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export type CartaOption = {
  id: string;
  group_id: string;
  name: string;
  price_delta_cents: number;
  sort_order: number;
  is_active: boolean;
};

export type CartaOptionGroup = {
  id: string;
  product_id: string;
  name: string;
  min_choices: number;
  max_choices: number;
  sort_order: number;
  is_active: boolean;
  options: CartaOption[];
};

/** Los grupos de un plato con sus opciones, incluido lo inactivo, en el orden en que se ve. */
export async function loadProductOptions(db: Db, orgId: string, productId: string): Promise<CartaOptionGroup[]> {
  const groups = await db
    .from("option_groups")
    .select("id, product_id, name, min_choices, max_choices, sort_order, is_active")
    .eq("organization_id", orgId)
    .eq("product_id", productId);
  if (groups.error) throw new Error(`No se pudieron leer los grupos de opciones: ${groups.error.message}`);
  if (groups.data.length === 0) return [];

  const options = await db
    .from("options")
    .select("id, group_id, name, price_delta_cents, sort_order, is_active")
    .eq("organization_id", orgId)
    .in(
      "group_id",
      groups.data.map((group) => group.id),
    );
  if (options.error) throw new Error(`No se pudieron leer las opciones: ${options.error.message}`);

  return sortForDisplay(groups.data).map((group) => ({
    ...group,
    options: sortForDisplay(options.data.filter((option) => option.group_id === group.id)),
  }));
}

async function loadGroup(db: Db, orgId: string, groupId: string) {
  const { data, error } = await db
    .from("option_groups")
    .select("id, product_id")
    .eq("id", groupId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el grupo: ${error.message}`);
  return data;
}

/** Errores propios de estas tablas antes de caer en el mapeo común de la carta. */
async function optionsWriteFailure(
  db: Db,
  orgId: string,
  error: { code?: string; message?: string },
  cap: "group_cap" | "option_cap",
): Promise<CartaError> {
  if (error.code === PROGRAM_LIMIT_EXCEEDED) return cap;
  if (error.code === FOREIGN_KEY_VIOLATION) return "not_found"; // el plato o el grupo no es de esta organización
  return writeFailure(db, orgId, error);
}

// ---------------------------------------------------------------------------
// Grupos
// ---------------------------------------------------------------------------

export type GroupInput = { name: string; min: string; max: string };

function parseGroup(input: GroupInput): Result<{ name: string; min_choices: number; max_choices: number }> {
  const name = validateName(input.name);
  if (!name.ok) return fail(name.problem === "blank" ? "name_blank" : "name_too_long");
  const choices = parseChoices(input.min, input.max);
  if (!choices.ok) return fail(CHOICES_ERROR[choices.problem]);
  return ok({ name: name.value, min_choices: choices.min, max_choices: choices.max });
}

export async function createGroup(db: Db, orgId: string, productId: string, input: GroupInput): Promise<Result<{ id: string }>> {
  const parsed = parseGroup(input);
  if (!parsed.ok) return parsed;

  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  if (!(await loadProduct(db, orgId, productId))) return fail("not_found");

  const siblings = await db.from("option_groups").select("sort_order").eq("organization_id", orgId).eq("product_id", productId);
  if (siblings.error) return fail("unexpected");

  const { data, error } = await db
    .from("option_groups")
    .insert({ organization_id: orgId, product_id: productId, ...parsed.data, sort_order: nextSortOrder(siblings.data) })
    .select("id")
    .single();
  if (error) return fail(await optionsWriteFailure(db, orgId, error, "group_cap"));
  return ok({ id: data.id });
}

export async function updateGroup(db: Db, orgId: string, id: string, input: GroupInput): Promise<Result> {
  const parsed = parseGroup(input);
  if (!parsed.ok) return parsed;

  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db
    .from("option_groups")
    .update(parsed.data)
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id");
  if (error) return fail(await optionsWriteFailure(db, orgId, error, "group_cap"));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, "option_groups", id));
  return ok(undefined);
}

export async function setGroupActive(db: Db, orgId: string, id: string, active: boolean): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db
    .from("option_groups")
    .update({ is_active: active })
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id");
  if (error) return fail(await optionsWriteFailure(db, orgId, error, "group_cap"));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, "option_groups", id));
  return ok(undefined);
}

export async function moveGroup(db: Db, orgId: string, id: string, direction: Direction): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const group = await loadGroup(db, orgId, id);
  if (!group) return fail("not_found");

  const list = await db
    .from("option_groups")
    .select("id, name, sort_order")
    .eq("organization_id", orgId)
    .eq("product_id", group.product_id);
  if (list.error) return fail("unexpected");

  const final = moveWithin(list.data, id, direction);
  if (!final) return ok(undefined);
  return applyOrder(db, orgId, "option_groups", changesFor(list.data, final));
}

// ---------------------------------------------------------------------------
// Opciones
// ---------------------------------------------------------------------------

export type OptionInput = { name: string; delta: string };

function parseOption(input: OptionInput): Result<{ name: string; price_delta_cents: number }> {
  const name = validateName(input.name);
  if (!name.ok) return fail(name.problem === "blank" ? "name_blank" : "name_too_long");
  const delta = parseDelta(input.delta);
  if (!delta.ok) return fail(DELTA_ERROR[delta.problem]);
  return ok({ name: name.value, price_delta_cents: delta.cents });
}

export async function createOption(db: Db, orgId: string, groupId: string, input: OptionInput): Promise<Result<{ id: string }>> {
  const parsed = parseOption(input);
  if (!parsed.ok) return parsed;

  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  if (!(await loadGroup(db, orgId, groupId))) return fail("not_found");

  const siblings = await db.from("options").select("sort_order").eq("organization_id", orgId).eq("group_id", groupId);
  if (siblings.error) return fail("unexpected");

  const { data, error } = await db
    .from("options")
    .insert({ organization_id: orgId, group_id: groupId, ...parsed.data, sort_order: nextSortOrder(siblings.data) })
    .select("id")
    .single();
  if (error) return fail(await optionsWriteFailure(db, orgId, error, "option_cap"));
  return ok({ id: data.id });
}

export async function updateOption(db: Db, orgId: string, id: string, input: OptionInput): Promise<Result> {
  const parsed = parseOption(input);
  if (!parsed.ok) return parsed;

  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db
    .from("options")
    .update(parsed.data)
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id");
  if (error) return fail(await optionsWriteFailure(db, orgId, error, "option_cap"));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, "options", id));
  return ok(undefined);
}

export async function setOptionActive(db: Db, orgId: string, id: string, active: boolean): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const { data, error } = await db
    .from("options")
    .update({ is_active: active })
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id");
  if (error) return fail(await optionsWriteFailure(db, orgId, error, "option_cap"));
  if (data.length === 0) return fail(await explainZeroRows(db, orgId, "options", id));
  return ok(undefined);
}

export async function moveOption(db: Db, orgId: string, id: string, direction: Direction): Promise<Result> {
  const blocked = await guard(db, orgId);
  if (blocked) return fail(blocked);

  const current = await db.from("options").select("id, group_id").eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (current.error) return fail("unexpected");
  if (!current.data) return fail("not_found");

  const list = await db
    .from("options")
    .select("id, name, sort_order")
    .eq("organization_id", orgId)
    .eq("group_id", current.data.group_id);
  if (list.error) return fail("unexpected");

  const final = moveWithin(list.data, id, direction);
  if (!final) return ok(undefined);
  return applyOrder(db, orgId, "options", changesFor(list.data, final));
}
