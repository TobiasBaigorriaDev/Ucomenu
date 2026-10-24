import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBranchSettings } from "@/lib/carta/availability";
import { sortForDisplay } from "@/lib/carta/ordering";
import { parseEntitlements } from "@/lib/entitlements";
import { readAllByKey } from "@/lib/paginar";
import type { Database } from "@/lib/supabase/database.types";
import { isUnfulfillable, type AnotarData, type AnotarGroup, type AnotarLine, type AnotarProduct, type AnotarSection } from "./anotar";
import { isLineStatus } from "./mesas";

type Db = SupabaseClient<Database>;

/** Ids por pedido en `in (...)` (la lista viaja en la URL). */
const CHUNK = 100;

/**
 * Orden por fecha de creación y, si empatan, por id. Se comparan los TEXTOS de la fecha, no `Date.parse`: la base los devuelve con
 * microsegundos (mismo formato y misma zona) y `Date.parse` los recorta a milisegundos, donde dos filas seguidas empatan.
 */
const byCreated = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id);

/**
 * Las líneas del pedido ABIERTO de una mesa (con sus opciones copiadas), de la más antigua a la más nueva. Vacío si la mesa no tiene
 * pedido abierto. Con el cliente de la PERSONA (RLS). Lanza si la base falla. Un estado desconocido de una línea se omite (mejor menos
 * que un estado inventado).
 */
export async function loadTableLines(db: Db, orgId: string, tableId: string): Promise<AnotarLine[]> {
  return (await loadTableOrder(db, orgId, tableId)).lines;
}

/** El pedido abierto de una mesa (su id, aunque no tenga líneas vivas) y sus líneas. Sin pedido abierto: `orderId: null` y sin líneas. */
export async function loadTableOrder(db: Db, orgId: string, tableId: string): Promise<{ orderId: string | null; lines: AnotarLine[] }> {
  const order = await db.from("orders").select("id").eq("organization_id", orgId).eq("table_id", tableId).eq("status", "open").maybeSingle();
  if (order.error) throw new Error(`No se pudo leer el pedido de la mesa: ${order.error.message}`);
  if (!order.data) return { orderId: null, lines: [] };
  const orderId = order.data.id;

  const items = await readAllByKey((after, limit) => {
    const query = db
      .from("order_items")
      .select("id, product_name, quantity, status, unit_price_cents, options_cents, note, cancel_reason, created_at")
      .eq("organization_id", orgId)
      .eq("order_id", orderId);
    return (after ? query.gt("id", after) : query).order("id").limit(limit);
  });
  if (items.error) throw new Error(`No se pudieron leer las líneas del pedido: ${items.error.message}`);
  const rows = items.data ?? [];

  const optionsOf = new Map<string, { group: string; name: string; deltaCents: number; createdAt: string; id: string }[]>();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const ids = rows.slice(i, i + CHUNK).map((row) => row.id);
    const page = await readAllByKey((after, limit) => {
      const query = db
        .from("order_item_options")
        .select("id, order_item_id, group_name, option_name, price_delta_cents, created_at")
        .eq("organization_id", orgId)
        .in("order_item_id", ids);
      return (after ? query.gt("id", after) : query).order("id").limit(limit);
    });
    if (page.error) throw new Error(`No se pudieron leer las opciones de las líneas: ${page.error.message}`);
    for (const row of page.data ?? []) {
      const list = optionsOf.get(row.order_item_id) ?? [];
      list.push({ group: row.group_name, name: row.option_name, deltaCents: row.price_delta_cents, createdAt: row.created_at, id: row.id });
      optionsOf.set(row.order_item_id, list);
    }
  }

  const lines = rows
    .filter((row) => isLineStatus(row.status))
    .sort((a, b) => byCreated({ createdAt: a.created_at, id: a.id }, { createdAt: b.created_at, id: b.id }))
    .map((row) => ({
      id: row.id,
      productName: row.product_name,
      quantity: row.quantity,
      status: row.status as AnotarLine["status"],
      unitPriceCents: row.unit_price_cents,
      optionsCents: Number(row.options_cents),
      note: row.note,
      cancelReason: row.cancel_reason,
      options: (optionsOf.get(row.id) ?? [])
        .sort(byCreated)
        .map(({ group, name, deltaCents }) => ({ group, name, deltaCents })),
    }));
  return { orderId, lines };
}

/**
 * Lo que necesita la pantalla «Anotar» de una mesa: la carta de SU sucursal (solo lo activo, sin lo oculto en esa sucursal, con el
 * precio efectivo de ahora y lo agotado marcado) y el pedido abierto. `null` si la mesa no existe, no es del local o está inactiva (o
 * su sucursal). Si el plan o la cuenta no permiten pedidos, `enabled: false`, no se lee la carta y solo se trae el pedido abierto, si lo hay. Cliente de la PERSONA (RLS). Lanza si la
 * base falla. Lecturas paginadas por clave: PostgREST corta cada lectura en 1000 filas sin avisar.
 */
export async function loadAnotar(db: Db, orgId: string, tableId: string): Promise<AnotarData | null> {
  const table = await db.from("tables").select("id, label, branch_id, is_active").eq("organization_id", orgId).eq("id", tableId).maybeSingle();
  if (table.error) throw new Error(`No se pudo leer la mesa: ${table.error.message}`);
  if (!table.data || !table.data.is_active) return null;
  const { branch_id: branchId } = table.data;

  const branches = await readAllByKey((after, limit) => {
    const query = db.from("branches").select("id, name").eq("organization_id", orgId).eq("is_active", true);
    return (after ? query.gt("id", after) : query).order("id").limit(limit);
  });
  if (branches.error) throw new Error(`No se pudieron leer las sucursales: ${branches.error.message}`);
  const branch = (branches.data ?? []).find((row) => row.id === branchId);
  if (!branch) return null;
  const multiBranch = (branches.data ?? []).length > 1;
  const base = { table: { id: table.data.id, label: table.data.label, branchId: branch.id, branchName: branch.name }, multiBranch };

  const ent = await db.rpc("org_entitlements", { p_org: orgId });
  if (ent.error) throw new Error(`No se pudo leer el estado de la cuenta: ${ent.error.message}`);
  if (parseEntitlements(ent.data)?.features.includes("orders") !== true) {
    // Sin la función no se anota ni se cambia nada, pero un pedido que ya estaba abierto se sigue viendo: cerrarlo o anularlo nunca se
    // bloquea por plan ni por mora (ADR 0041, decisión 5).
    const open = await loadTableOrder(db, orgId, tableId);
    return { ...base, enabled: false, sections: [], ...open };
  }

  const [categories, products, groups, options, settings, prices, order] = await Promise.all([
    readAllByKey((after, limit) => {
      const query = db.from("categories").select("id, name, sort_order").eq("organization_id", orgId).eq("is_active", true);
      return (after ? query.gt("id", after) : query).order("id").limit(limit);
    }),
    readAllByKey((after, limit) => {
      const query = db.from("products").select("id, category_id, name, description, price_cents, sort_order").eq("organization_id", orgId).eq("is_active", true);
      return (after ? query.gt("id", after) : query).order("id").limit(limit);
    }),
    readAllByKey((after, limit) => {
      const query = db.from("option_groups").select("id, product_id, name, min_choices, max_choices, sort_order").eq("organization_id", orgId).eq("is_active", true);
      return (after ? query.gt("id", after) : query).order("id").limit(limit);
    }),
    readAllByKey((after, limit) => {
      const query = db.from("options").select("id, group_id, name, price_delta_cents, sort_order").eq("organization_id", orgId).eq("is_active", true);
      return (after ? query.gt("id", after) : query).order("id").limit(limit);
    }),
    loadBranchSettings(db, orgId, branch.id),
    // Las promociones en curso de la sucursal, de la misma función que usa la base al anotar: devuelve UNA FILA POR PLATO CON PROMOCIÓN
    // (los demás valen su precio de la sucursal o el base). Es la vista previa: el precio que se cobra lo calcula `add_order_item`.
    db.rpc("effective_prices", { p_branch: branch.id, p_product: undefined, p_at: undefined }),
    loadTableOrder(db, orgId, tableId),
  ]);
  if (categories.error) throw new Error(`No se pudieron leer las categorías: ${categories.error.message}`);
  if (products.error) throw new Error(`No se pudieron leer los platos: ${products.error.message}`);
  if (groups.error) throw new Error(`No se pudieron leer los grupos de opciones: ${groups.error.message}`);
  if (options.error) throw new Error(`No se pudieron leer las opciones: ${options.error.message}`);
  if (prices.error) throw new Error(`No se pudieron leer los precios: ${prices.error.message}`);

  const promotionOf = new Map((prices.data ?? []).filter((row) => row.promotion_id !== null).map((row) => [row.product_id, row]));

  const optionsByGroup = new Map<string, AnotarGroup["options"]>();
  for (const option of sortForDisplay(options.data ?? [])) {
    const list = optionsByGroup.get(option.group_id) ?? [];
    list.push({ id: option.id, name: option.name, deltaCents: option.price_delta_cents });
    optionsByGroup.set(option.group_id, list);
  }
  const groupsByProduct = new Map<string, AnotarGroup[]>();
  for (const group of sortForDisplay(groups.data ?? [])) {
    const list = groupsByProduct.get(group.product_id) ?? [];
    list.push({ id: group.id, name: group.name, min: group.min_choices, max: group.max_choices, options: optionsByGroup.get(group.id) ?? [] });
    groupsByProduct.set(group.product_id, list);
  }

  const productsByCategory = new Map<string, AnotarProduct[]>();
  for (const product of sortForDisplay(products.data ?? [])) {
    const setting = settings.get(product.id);
    // Oculto en esta sucursal = no está en su carta. (Un plato inactivo o de categoría inactiva ya no llegó: se leen solo los activos.)
    if (setting && !setting.isVisible) continue;
    const listCents = setting?.priceCents ?? product.price_cents;
    const found = promotionOf.get(product.id);
    // Una promoción que no baja el precio no se aplica (la base tampoco).
    const promotion = found && found.price_cents < listCents ? found : null;
    // Un grupo activo sin opciones y sin mínimo no estorba (la carta tampoco lo muestra); uno con mínimo que no se puede cumplir, sí.
    const productGroups = (groupsByProduct.get(product.id) ?? []).filter((group) => group.options.length > 0 || group.min > 0);
    const entry: AnotarProduct = {
      id: product.id,
      name: product.name,
      description: product.description,
      priceCents: promotion ? promotion.price_cents : listCents,
      listCents: promotion ? listCents : null,
      promotionName: promotion ? promotion.promotion_name : null,
      groups: productGroups,
      block: setting && !setting.isAvailable ? "unavailable" : productGroups.some(isUnfulfillable) ? "options_unfulfillable" : null,
    };
    const list = productsByCategory.get(product.category_id) ?? [];
    list.push(entry);
    productsByCategory.set(product.category_id, list);
  }

  const sections: AnotarSection[] = sortForDisplay(categories.data ?? []).flatMap((category) => {
    const list = productsByCategory.get(category.id);
    return list && list.length > 0 ? [{ categoryId: category.id, name: category.name, products: list }] : [];
  });

  return { ...base, enabled: true, sections, ...order };
}
