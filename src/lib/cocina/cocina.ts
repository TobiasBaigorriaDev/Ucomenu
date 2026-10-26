/**
 * Reglas puras de la pantalla de cocina (ficha rol-cocinero, ADR 0048): tipos de lo que devuelven las funciones de la base, lectura
 * defensiva de esas respuestas, validación de lo que llega a las acciones y mensajes de los errores. Sin dependencias de servidor.
 * Se prueban en `cocina.test.ts`.
 *
 * La AUTORIDAD es la base (`kitchen_orders`, `kitchen_branches`, `kitchen_menu`, `set_kitchen_availability`, `set_order_item_status`):
 * ella decide quién puede, con qué plan y con qué cuenta, y no devuelve precios. Acá solo se muestra lo que llega.
 */

/** Estados de una línea que la cocina ve (las entregadas y las canceladas ya no son suyas). */
export type KitchenStatus = "noted" | "in_kitchen" | "ready";

export type KitchenOption = { group: string; option: string };

export type KitchenItem = {
  id: string;
  name: string;
  quantity: number;
  note: string | null;
  status: KitchenStatus;
  /** ISO 8601. */
  createdAt: string;
  options: KitchenOption[];
};

export type KitchenOrder = {
  orderId: string;
  tableLabel: string;
  branchId: string;
  branchName: string;
  /** ISO 8601: cuándo se abrió el pedido. */
  openedAt: string;
  items: KitchenItem[];
};

export type KitchenBranch = { id: string; name: string };

/** `enabled: false` = el plan o la cuenta no permiten pedidos (o la persona ya no trabaja en el local): sin lista ni sondeo. */
export type KitchenState = {
  serverNow: string;
  enabled: boolean;
  branches: KitchenBranch[];
  orders: KitchenOrder[];
};

export type KitchenProduct = { id: string; name: string; available: boolean };
export type KitchenCategory = { id: string; name: string; products: KitchenProduct[] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isIso = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isStatus = (value: unknown): value is KitchenStatus => value === "noted" || value === "in_kitchen" || value === "ready";

function parseItem(raw: unknown): KitchenItem | null {
  if (!isRecord(raw)) return null;
  const { id, name, quantity, note, status, created_at, options } = raw;
  if (typeof id !== "string" || typeof name !== "string" || typeof quantity !== "number" || !isStatus(status) || !isIso(created_at)) return null;
  const parsedOptions = Array.isArray(options)
    ? options.flatMap((option): KitchenOption[] =>
        isRecord(option) && typeof option.group === "string" && typeof option.option === "string" ? [{ group: option.group, option: option.option }] : [],
      )
    : [];
  return { id, name, quantity, note: typeof note === "string" && note.length > 0 ? note : null, status, createdAt: created_at, options: parsedOptions };
}

/** Respuesta de `kitchen_orders` → pedidos. Lo que no tiene la forma esperada se descarta (un `null` ante la duda, nunca un dato inventado). */
export function parseKitchenOrders(raw: unknown): { serverNow: string; orders: KitchenOrder[] } | null {
  if (!isRecord(raw) || !isIso(raw.server_now) || !Array.isArray(raw.orders)) return null;
  const orders = raw.orders.flatMap((entry): KitchenOrder[] => {
    if (!isRecord(entry)) return [];
    const { order_id, table_label, branch_id, branch_name, opened_at, items } = entry;
    if (typeof order_id !== "string" || typeof table_label !== "string" || typeof branch_id !== "string" || typeof branch_name !== "string" || !isIso(opened_at)) return [];
    const lines = Array.isArray(items) ? items.flatMap((item) => parseItem(item) ?? []) : [];
    return lines.length > 0 ? [{ orderId: order_id, tableLabel: table_label, branchId: branch_id, branchName: branch_name, openedAt: opened_at, items: lines }] : [];
  });
  return { serverNow: raw.server_now, orders };
}

/** Una sucursal ilegible invalida la lista entera: mejor un error que una sucursal que falta sin avisar. */
export function parseKitchenBranches(raw: unknown): KitchenBranch[] | null {
  if (!Array.isArray(raw)) return null;
  const branches = raw.map((entry) => (isRecord(entry) && typeof entry.id === "string" && typeof entry.name === "string" ? { id: entry.id, name: entry.name } : null));
  return branches.every((branch): branch is KitchenBranch => branch !== null) ? branches : null;
}

export function parseKitchenMenu(raw: unknown): KitchenCategory[] | null {
  if (!isRecord(raw) || !Array.isArray(raw.categories)) return null;
  return raw.categories.flatMap((category): KitchenCategory[] => {
    if (!isRecord(category) || typeof category.id !== "string" || typeof category.name !== "string") return [];
    const products = Array.isArray(category.products)
      ? category.products.flatMap((product): KitchenProduct[] =>
          isRecord(product) && typeof product.id === "string" && typeof product.name === "string" && typeof product.available === "boolean"
            ? [{ id: product.id, name: product.name, available: product.available }]
            : [],
        )
      : [];
    return products.length > 0 ? [{ id: category.id, name: category.name, products }] : [];
  });
}

const isKitchenItem = (value: unknown): value is KitchenItem =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.name === "string" &&
  typeof value.quantity === "number" &&
  (value.note === null || typeof value.note === "string") &&
  isStatus(value.status) &&
  isIso(value.createdAt) &&
  Array.isArray(value.options) &&
  value.options.every((option) => isRecord(option) && typeof option.group === "string" && typeof option.option === "string");

const isKitchenOrder = (value: unknown): value is KitchenOrder =>
  isRecord(value) &&
  typeof value.orderId === "string" &&
  typeof value.tableLabel === "string" &&
  typeof value.branchId === "string" &&
  typeof value.branchName === "string" &&
  isIso(value.openedAt) &&
  Array.isArray(value.items) &&
  value.items.every(isKitchenItem);

/** Estado recibido por el sondeo (`/cocina/{slug}/estado`, ya normalizado por el servidor) → estado, o `null` si no tiene la forma esperada. */
export function parseKitchenState(raw: unknown): KitchenState | null {
  if (!isRecord(raw) || typeof raw.enabled !== "boolean" || !isIso(raw.serverNow) || !Array.isArray(raw.branches) || !Array.isArray(raw.orders)) return null;
  const branches = parseKitchenBranches(raw.branches);
  if (!branches || !raw.orders.every(isKitchenOrder)) return null;
  return { serverNow: raw.serverNow, enabled: raw.enabled, branches, orders: raw.orders };
}

// ---------------------------------------------------------------------------
// Qué se muestra
// ---------------------------------------------------------------------------

export const STATUS_LABEL: Record<KitchenStatus, string> = { noted: "Pendiente", in_kitchen: "Pendiente", ready: "Listo" };

/** Una línea espera en cocina hasta que se marca lista. */
export const isPending = (item: Pick<KitchenItem, "status">): boolean => item.status !== "ready";

/** Platos (unidades) pendientes y listos de un pedido. */
export function countUnits(items: readonly Pick<KitchenItem, "status" | "quantity">[]): { pending: number; ready: number } {
  return {
    pending: items.filter(isPending).reduce((sum, item) => sum + item.quantity, 0),
    ready: items.filter((item) => item.status === "ready").reduce((sum, item) => sum + item.quantity, 0),
  };
}

/**
 * Orden de los pedidos: primero los que tienen algo pendiente (el que más espera, arriba) y al final los que ya están todos listos
 * (esperan al mozo). Dentro de cada grupo, por antigüedad y mesa.
 */
export function sortKitchenOrders(orders: readonly KitchenOrder[]): KitchenOrder[] {
  const hasPending = (order: KitchenOrder) => order.items.some(isPending);
  return [...orders].sort((a, b) => {
    const group = Number(!hasPending(a)) - Number(!hasPending(b));
    if (group !== 0) return group;
    const opened = Date.parse(a.openedAt) - Date.parse(b.openedAt);
    if (opened !== 0) return opened;
    return a.tableLabel.localeCompare(b.tableLabel, "es-AR", { numeric: true });
  });
}

/** «Opciones: Grande · Sin sal»: las opciones de una línea en una sola frase. */
export const optionsText = (options: readonly KitchenOption[]): string => options.map((option) => option.option).join(" · ");

// ---------------------------------------------------------------------------
// Entrada de las acciones del servidor
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (value: unknown): string | null => (typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null);

/** `ready` marca el plato listo; `noted` lo deshace (un toque equivocado). Es lo único que el cocinero puede hacer con una línea. */
export type KitchenTarget = "ready" | "noted";

export type ReadyInput = { itemId: string; target: KitchenTarget };

export function parseReadyInput(raw: unknown): ReadyInput | "invalid" {
  if (!isRecord(raw)) return "invalid";
  const itemId = asUuid(raw.itemId);
  const target = raw.target === "ready" || raw.target === "noted" ? raw.target : null;
  return itemId && target ? { itemId, target } : "invalid";
}

export type AvailabilityInput = { productId: string; branchId: string; available: boolean };

export function parseAvailabilityInput(raw: unknown): AvailabilityInput | "invalid" {
  if (!isRecord(raw)) return "invalid";
  const productId = asUuid(raw.productId);
  const branchId = asUuid(raw.branchId);
  return productId && branchId && typeof raw.available === "boolean" ? { productId, branchId, available: raw.available } : "invalid";
}

// ---------------------------------------------------------------------------
// Resultado y mensajes
// ---------------------------------------------------------------------------

export type KitchenFailure = "not_allowed" | "item_gone" | "order_closed" | "invalid_transition" | "product_gone" | "branch_gone" | "invalid" | "unexpected";

/** `unchanged`: la base ya lo tenía así (otra persona lo hizo, o se repitió el toque); para la pantalla es lo mismo que haberlo hecho. */
export type KitchenResult = { status: "done"; unchanged: boolean } | { status: "failed"; reason: KitchenFailure };

/** Excepciones de las funciones de cocina → motivo. Un texto que no se conoce es `unexpected`: nunca se da por hecho que se aplicó. */
export function kitchenFailureFromDb(message: string | undefined): KitchenFailure {
  switch ((message ?? "").trim()) {
    case "orders_not_allowed":
      return "not_allowed";
    case "item_not_found":
      return "item_gone";
    case "order_not_open":
      return "order_closed";
    case "invalid_transition":
      return "invalid_transition";
    case "product_not_found":
      return "product_gone";
    case "branch_not_found":
      return "branch_gone";
    case "invalid_status":
    case "invalid_availability":
      return "invalid";
    default:
      return "unexpected";
  }
}

export const KITCHEN_TEXT: Record<KitchenFailure, string> = {
  not_allowed: "No se pudo: el plan o la cuenta no permiten operar ahora. Avisale al dueño.",
  item_gone: "Ese plato ya no está en el pedido. Se actualizó la pantalla.",
  order_closed: "El pedido ya estaba cerrado o anulado. Se actualizó la pantalla.",
  invalid_transition: "Otra persona ya cambió este plato. Se actualizó la pantalla.",
  product_gone: "Ese plato ya no está en la carta. Se actualizó la lista.",
  branch_gone: "Esa sucursal ya no está activa. Se actualizó la lista.",
  invalid: "Los datos no son válidos. Probá de nuevo.",
  unexpected: "No se pudo confirmar el cambio. Revisá la pantalla y probá de nuevo.",
};

/** Fallos que indican que la pantalla ya no es como estaba: se recarga para ver lo vigente. */
export const isStaleKitchen = (reason: KitchenFailure): boolean =>
  reason === "item_gone" || reason === "order_closed" || reason === "invalid_transition" || reason === "product_gone" || reason === "branch_gone" || reason === "unexpected";
