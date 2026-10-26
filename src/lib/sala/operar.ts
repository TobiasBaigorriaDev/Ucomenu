/**
 * Reglas puras de «operar el pedido» desde la Sala (ficha sala-operar-pedido, ADR 0041): qué puede hacerse con cada línea, validación
 * de lo que llega al servidor y mensajes de los errores de la base. Sin dependencias de servidor. Se prueban en `operar.test.ts`.
 *
 * La AUTORIDAD es la base (`set_order_item_status`, `update_order_item`, `close_order`, `void_order`): ella decide las transiciones, el
 * motivo obligatorio y quién puede (plan y mora). Acá solo se repiten para mostrar los botones que corresponden y no mandar basura.
 */
import { MAX_NOTE, MAX_QUANTITY, noteProblem, normalizeNote } from "./anotar";
import type { LineStatus, OrderLine } from "./mesas";

/** A qué estado se puede mandar una línea desde la Sala (`noted` es el de alta; «listo» lo marca la cocina, ADR 0048). */
export type LineTarget = "in_kitchen" | "delivered" | "cancelled";

export const LINE_TARGETS: readonly LineTarget[] = ["in_kitchen", "delivered", "cancelled"];

/**
 * Transiciones que ofrece la Sala: anotado, en cocina (heredado) o listo → entregado; cancelar desde cualquiera salvo lo ya cancelado; sin
 * marcha atrás. «En cocina» ya no se ofrece (la cocina marca «listo»): la base lo sigue aceptando para lo que ya estaba así. Se muestran
 * en este orden: primero avanzar, al final cancelar.
 */
export function lineMoves(status: LineStatus): LineTarget[] {
  switch (status) {
    case "noted":
    case "in_kitchen":
    case "ready":
      return ["delivered", "cancelled"];
    case "delivered":
      return ["cancelled"];
    case "cancelled":
      return [];
  }
}

/** Solo una línea anotada se modifica (cantidad y observación); para cambiar plato u opciones se cancela y se anota otra. */
export const canEditLine = (status: LineStatus): boolean => status === "noted";

/** Cancelar una línea ya entregada exige un motivo; las demás cancelaciones pueden llevarlo. */
export const needsReason = (from: LineStatus, to: LineTarget): boolean => to === "cancelled" && from === "delivered";

export const MOVE_LABEL: Record<LineTarget, string> = {
  in_kitchen: "En cocina",
  delivered: "Entregado",
  cancelled: "Cancelar",
};

/** Platos (unidades) vivos que todavía no se entregaron: lo que se avisa antes de cerrar (cerrar igual es decisión del mozo). */
export function undeliveredUnits(lines: readonly Pick<OrderLine, "status" | "quantity">[]): number {
  return lines.filter((line) => line.status === "noted" || line.status === "in_kitchen" || line.status === "ready").reduce((sum, line) => sum + line.quantity, 0);
}

// ---------------------------------------------------------------------------
// Motivos
// ---------------------------------------------------------------------------

export const MAX_REASON = 200;

/** Mismas reglas que la base para un motivo: sin caracteres de control y hasta 200 caracteres (vacío = sin motivo). */
export const reasonProblem = (raw: string): "too_long" | "control" | null => noteProblem(raw);

export const normalizeReason = (raw: string): string | null => normalizeNote(raw);

// ---------------------------------------------------------------------------
// Entrada de las acciones del servidor
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (value: unknown): string | null => (typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Un motivo opcional: `null`/ausente = sin motivo; un texto se normaliza; lo que no es texto o la base rechazaría es `"invalid"`. */
function parseReason(value: unknown): string | null | "invalid" {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || reasonProblem(value)) return "invalid";
  return normalizeReason(value);
}

export type StatusInput = { itemId: string; status: LineTarget; reason: string | null };

export function parseStatusInput(raw: unknown): StatusInput | "invalid" {
  if (!isRecord(raw)) return "invalid";
  const itemId = asUuid(raw.itemId);
  const status = LINE_TARGETS.find((target) => target === raw.status);
  const reason = parseReason(raw.reason);
  if (!itemId || !status || reason === "invalid") return "invalid";
  return { itemId, status, reason };
}

export type EditInput = { itemId: string; quantity: number; note: string | null };

export function parseEditInput(raw: unknown): EditInput | "invalid" {
  if (!isRecord(raw)) return "invalid";
  const itemId = asUuid(raw.itemId);
  const { quantity, note } = raw;
  if (!itemId || typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return "invalid";
  if (note !== null && note !== undefined && (typeof note !== "string" || noteProblem(note))) return "invalid";
  return { itemId, quantity, note: typeof note === "string" ? normalizeNote(note) : null };
}

export type CloseInput = { orderId: string };

export function parseCloseInput(raw: unknown): CloseInput | "invalid" {
  if (!isRecord(raw)) return "invalid";
  const orderId = asUuid(raw.orderId);
  return orderId ? { orderId } : "invalid";
}

export type VoidInput = { orderId: string; reason: string | null };

export function parseVoidInput(raw: unknown): VoidInput | "invalid" {
  if (!isRecord(raw)) return "invalid";
  const orderId = asUuid(raw.orderId);
  const reason = parseReason(raw.reason);
  if (!orderId || reason === "invalid") return "invalid";
  return { orderId, reason };
}

// ---------------------------------------------------------------------------
// Resultado y mensajes
// ---------------------------------------------------------------------------

export type OperateFailure =
  | "not_allowed"
  | "item_gone"
  | "order_gone"
  | "order_closed"
  | "invalid_transition"
  | "reason_required"
  | "reason_invalid"
  | "not_editable"
  | "quantity"
  | "note"
  | "invalid"
  | "unexpected";

/** `unchanged`: la base ya lo tenía así (otra persona lo hizo, o se repitió el toque); para la pantalla es lo mismo que haberlo hecho. */
export type OperateResult = { status: "done"; unchanged: boolean } | { status: "failed"; reason: OperateFailure };

/** Excepciones de las cuatro funciones → motivo. Un texto que no se conoce es `unexpected`: nunca se da por hecho que se aplicó. */
export function operateFailureFromDb(message: string | undefined): OperateFailure {
  switch ((message ?? "").trim()) {
    case "orders_not_allowed":
      return "not_allowed";
    case "item_not_found":
      return "item_gone";
    case "order_not_found":
      return "order_gone";
    case "order_not_open":
      return "order_closed";
    case "invalid_transition":
      return "invalid_transition";
    case "reason_required":
      return "reason_required";
    case "invalid_reason":
      return "reason_invalid";
    case "item_not_editable":
      return "not_editable";
    case "invalid_quantity":
      return "quantity";
    case "invalid_note":
      return "note";
    case "invalid_status":
      return "invalid";
    default:
      return "unexpected";
  }
}

export const OPERATE_TEXT: Record<OperateFailure, string> = {
  not_allowed: "No se pudo: el plan o la cuenta no permiten cambiar pedidos ahora.",
  item_gone: "Esa línea ya no existe. Se actualizó el pedido.",
  order_gone: "Ese pedido ya no existe. Se actualizó la pantalla.",
  order_closed: "El pedido ya estaba cerrado o anulado. Se actualizó la pantalla.",
  invalid_transition: "Otra persona ya cambió esta línea. Se actualizó el pedido.",
  reason_required: "Hace falta un motivo.",
  reason_invalid: `El motivo no es válido: una sola línea de hasta ${MAX_REASON} caracteres.`,
  not_editable: "Esta línea ya no se puede modificar (solo las anotadas). Se actualizó el pedido.",
  quantity: `La cantidad tiene que ser de 1 a ${MAX_QUANTITY}.`,
  note: `La observación no es válida: una sola línea de hasta ${MAX_NOTE} caracteres.`,
  invalid: "Los datos no son válidos. Probá de nuevo.",
  unexpected: "No se pudo confirmar el cambio. Revisá el pedido y probá de nuevo.",
};

/** Fallos que indican que el pedido ya no es como la pantalla lo mostraba: se recarga para que el mozo vea lo vigente. */
export const isStaleOperation = (reason: OperateFailure): boolean =>
  reason === "item_gone" || reason === "order_gone" || reason === "order_closed" || reason === "invalid_transition" || reason === "not_editable" || reason === "unexpected";
