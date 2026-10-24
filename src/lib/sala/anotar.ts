/**
 * Tipos y reglas puras de la pantalla «Anotar» de la Sala (ficha sala-anotar-pedido, ADR 0041). Sin dependencias de servidor: las usan
 * la lectura (`anotar-loader.ts`), la acción del servidor y la pantalla del navegador. Se prueban en `anotar.test.ts`.
 *
 * La AUTORIDAD sobre precios, opciones y límites es `add_order_item` en la base. Acá solo se repiten sus reglas para guiar al mozo
 * (que no elija de más ni de menos) y para no mandar basura; lo que el cliente calcula es una vista previa, nunca lo que se cobra.
 */
import type { LineStatus } from "./mesas";

export const MAX_QUANTITY = 99;
export const MAX_NOTE = 200;
export const MAX_OPTIONS = 50;

export type AnotarOption = { id: string; name: string; deltaCents: number };

export type AnotarGroup = {
  id: string;
  name: string;
  min: number;
  max: number;
  options: AnotarOption[];
};

/** Por qué un plato no se puede anotar (distinto de agotado): su configuración de opciones no se puede cumplir. */
export type ProductBlock = "unavailable" | "options_unfulfillable";

export type AnotarProduct = {
  id: string;
  name: string;
  description: string | null;
  /** Precio efectivo ahora en esta sucursal (con promoción si rige), en centavos. Lo vuelve a calcular la base al anotar. */
  priceCents: number;
  /** Precio sin promoción, solo si hay una en curso (para mostrarlo tachado). */
  listCents: number | null;
  promotionName: string | null;
  groups: AnotarGroup[];
  /** `null` = se puede anotar. */
  block: ProductBlock | null;
};

export type AnotarSection = { categoryId: string; name: string; products: AnotarProduct[] };

export type AnotarLineOption = { group: string; name: string; deltaCents: number };

export type AnotarLine = {
  id: string;
  productName: string;
  quantity: number;
  status: LineStatus;
  unitPriceCents: number;
  optionsCents: number;
  note: string | null;
  /** Motivo con que se canceló la línea (solo si está cancelada y se dio uno). */
  cancelReason: string | null;
  options: AnotarLineOption[];
};

export type AnotarData = {
  /** `false` si el plan o la cuenta no permiten pedidos: no hay carta ni se anota. */
  enabled: boolean;
  table: { id: string; label: string; branchId: string; branchName: string };
  multiBranch: boolean;
  sections: AnotarSection[];
  /** El pedido abierto de la mesa, o `null` si no hay (aunque esté abierto y sin líneas vivas, tiene id: se puede cerrar). */
  orderId: string | null;
  /** Líneas del pedido abierto de la mesa (vacío = sin pedido), de la más antigua a la más nueva. */
  lines: AnotarLine[];
};

// ---------------------------------------------------------------------------
// Reglas de elección
// ---------------------------------------------------------------------------

/**
 * Un grupo con mínimo mayor a las opciones que tiene no se puede cumplir: la base lo rechaza siempre (`options_required`), así que el plato
 * no se ofrece para anotar en vez de dejar al mozo con un botón que nunca funciona.
 */
export const isUnfulfillable = (group: Pick<AnotarGroup, "min" | "options">): boolean => group.min > group.options.length;

export type GroupCheck = { group: AnotarGroup; chosen: number; problem: "required" | "exceeded" | null };

/** Cuántas opciones hay elegidas en cada grupo y si se cumple su mínimo y su máximo. */
export function checkGroups(groups: readonly AnotarGroup[], selected: ReadonlySet<string>): GroupCheck[] {
  return groups.map((group) => {
    const chosen = group.options.filter((option) => selected.has(option.id)).length;
    return { group, chosen, problem: chosen < group.min ? "required" : chosen > group.max ? "exceeded" : null };
  });
}

/** Los ids elegidos que de verdad son de este plato, en el orden de la carta (los que ya no existen, por un cambio de carta, se descartan). */
export function chosenIds(groups: readonly AnotarGroup[], selected: ReadonlySet<string>): string[] {
  return groups.flatMap((group) => group.options.filter((option) => selected.has(option.id)).map((option) => option.id));
}

/** Suma de las diferencias de las opciones elegidas (vista previa; la base la recalcula). */
export function optionsCents(groups: readonly AnotarGroup[], selected: ReadonlySet<string>): number {
  return groups.reduce((sum, group) => sum + group.options.filter((option) => selected.has(option.id)).reduce((s, option) => s + option.deltaCents, 0), 0);
}

/** Lo que vale la línea que se va a anotar: cantidad por (precio efectivo + opciones). Vista previa. */
export function previewCents(product: Pick<AnotarProduct, "priceCents" | "groups">, quantity: number, selected: ReadonlySet<string>): number {
  return quantity * (product.priceCents + optionsCents(product.groups, selected));
}

/** «Elegí 1», «Elegí al menos 1 (hasta 3)», «Hasta 3 (opcional)»: lo que pide el grupo, en una frase. */
export function groupHint(group: Pick<AnotarGroup, "min" | "max">): string {
  const { min, max } = group;
  if (min === max) return min === 1 ? "Elegí 1" : `Elegí ${min}`;
  if (min === 0) return max === 1 ? "Opcional · hasta 1" : `Opcional · hasta ${max}`;
  return `Elegí de ${min} a ${max}`;
}

/** Texto de la observación normalizada como la base: sin espacios en los bordes; vacío = sin nota. */
export const normalizeNote = (raw: string): string | null => {
  const note = raw.trim();
  return note === "" ? null : note;
};

/** La base rechaza una observación de más de 200 caracteres o con saltos de línea y otros caracteres de control. */
export const noteProblem = (raw: string): "too_long" | "control" | null => {
  const note = raw.trim();
  if (note.length > MAX_NOTE) return "too_long";
  return /[\u0000-\u001f\u007f-\u009f]/.test(note) ? "control" : null;
};

// ---------------------------------------------------------------------------
// Entrada de la acción del servidor
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (value: unknown): string | null => (typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null);

export type AddItemInput = {
  tableId: string;
  productId: string;
  quantity: number;
  optionIds: string[];
  note: string | null;
  /** Identifica ESTE intento: repetirlo (cortó la red) devuelve la línea ya anotada en vez de duplicarla. */
  clientKey: string;
};

/** Lo que llega del navegador es un dato cualquiera: se valida la forma antes de ir a la base (que valida de nuevo todo lo suyo). */
export function parseAddItemInput(raw: unknown): AddItemInput | "invalid" {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "invalid";
  const { tableId, productId, quantity, optionIds, note, clientKey } = raw as Record<string, unknown>;
  const table = asUuid(tableId);
  const product = asUuid(productId);
  const key = asUuid(clientKey);
  if (!table || !product || !key) return "invalid";
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return "invalid";
  if (!Array.isArray(optionIds) || optionIds.length > MAX_OPTIONS) return "invalid";
  const ids = optionIds.map(asUuid);
  if (ids.some((id) => id === null) || new Set(ids).size !== ids.length) return "invalid";
  if (note !== null && typeof note !== "string") return "invalid";
  if (typeof note === "string" && noteProblem(note)) return "invalid";
  return { tableId: table, productId: product, quantity, optionIds: ids as string[], note: typeof note === "string" ? normalizeNote(note) : null, clientKey: key };
}

// ---------------------------------------------------------------------------
// Resultado y mensajes
// ---------------------------------------------------------------------------

/** Por qué no se anotó. `stale` = la carta cambió desde que se cargó la pantalla (conviene recargar los datos). */
export type AddFailure =
  | "not_allowed"
  | "table_gone"
  | "product_unavailable"
  | "options_required"
  | "options_exceeded"
  | "options_changed"
  | "note"
  | "quantity"
  | "key_reused"
  | "order_full"
  | "busy"
  | "invalid"
  | "unexpected";

export type AddResult = { status: "added"; replayed: boolean } | { status: "failed"; reason: AddFailure };

/** Códigos de excepción de `add_order_item` → motivo. Un texto que no se conoce es `unexpected` (nunca se asume que se anotó). */
export function failureFromDb(message: string | undefined): AddFailure {
  switch ((message ?? "").trim()) {
    case "orders_not_allowed":
      return "not_allowed";
    case "branch_not_found":
    case "table_not_found":
      return "table_gone";
    case "product_unavailable":
      return "product_unavailable";
    case "options_required":
      return "options_required";
    case "options_exceeded":
      return "options_exceeded";
    case "invalid_options":
      return "options_changed";
    case "invalid_note":
      return "note";
    case "invalid_quantity":
      return "quantity";
    case "client_key_reused":
      return "key_reused";
    case "order_full":
      return "order_full";
    case "order_conflict":
      return "busy";
    default:
      return "unexpected";
  }
}

export const FAILURE_TEXT: Record<AddFailure, string> = {
  not_allowed: "No se pudo anotar: el plan o la cuenta no permiten pedidos ahora.",
  table_gone: "Esa mesa o sucursal ya no está disponible.",
  product_unavailable: "Ese plato ya no está disponible (agotado, oculto o fuera de la carta).",
  options_required: "Faltan opciones obligatorias de este plato.",
  options_exceeded: "Elegiste más opciones de las que permite el plato.",
  options_changed: "Alguna opción cambió o ya no está disponible. Revisá lo que elegiste.",
  note: "La observación no es válida: una sola línea de hasta 200 caracteres.",
  quantity: "La cantidad tiene que ser de 1 a 99.",
  key_reused: "Esta carga ya se usó con otros datos. Cerrá y volvé a anotar el plato.",
  order_full: "El pedido de esta mesa llegó al máximo de 200 líneas.",
  busy: "Otra persona estaba anotando en la misma mesa. Probá de nuevo.",
  invalid: "Los datos del plato no son válidos. Revisalos y probá de nuevo.",
  unexpected: "No se pudo confirmar si se anotó. Volvé a tocar «Anotar» sin cambiar nada: si ya estaba, no se duplica.",
};

/** Fallos que indican que la carta cambió desde que se cargó la pantalla: se recarga para que el mozo vea lo vigente. */
export const isStaleFailure = (reason: AddFailure): boolean =>
  reason === "product_unavailable" || reason === "options_changed" || reason === "options_required" || reason === "options_exceeded";

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

export const LINE_STATUS_TEXT: Record<LineStatus, string> = {
  noted: "Anotado",
  in_kitchen: "En cocina",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

/** Sin tildes y en minúsculas, para buscar «milanesa» y encontrar «Milanesa napolitana» o «Ñoquis» con «noquis». */
export const fold = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Filtra la carta por el texto buscado (en el nombre del plato o de su categoría); sin texto, la carta entera. Las categorías vacías no quedan. */
export function filterSections(sections: readonly AnotarSection[], query: string): AnotarSection[] {
  const needle = fold(query.trim());
  if (needle === "") return [...sections];
  return sections.flatMap((section) => {
    const byCategory = fold(section.name).includes(needle);
    const products = byCategory ? section.products : section.products.filter((product) => fold(product.name).includes(needle));
    return products.length > 0 ? [{ ...section, products }] : [];
  });
}
