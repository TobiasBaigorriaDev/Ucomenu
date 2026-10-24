/**
 * Tipos y reglas puras de la vista «Mesas» de la Sala (ficha sala-mesas-y-total, ADR 0041). Sin dependencias de servidor: las usa la
 * lectura (`mesas-loader.ts`), la ruta de consulta y la pantalla del navegador. Se prueban en `mesas.test.ts`.
 *
 * Los importes viajan en CENTAVOS ENTEROS. Una línea copia al anotarla el precio efectivo y las diferencias de sus opciones: el total
 * de un pedido es la suma de `cantidad × (precio efectivo + opciones)` de las líneas NO canceladas. No es una factura.
 */
import type { CallKind, SalaBranch } from "./types";

/** Estados de una línea (ADR 0041, decisión 3). */
export type LineStatus = "noted" | "in_kitchen" | "delivered" | "cancelled";

export type OrderLine = {
  status: LineStatus;
  quantity: number;
  unitPriceCents: number;
  optionsCents: number;
};

/** Resumen de un pedido abierto: lo que la tarjeta de una mesa muestra. */
export type MesaOrder = {
  /** ISO 8601: cuándo se abrió el pedido (de la hora del servidor). */
  openedAt: string;
  /** Platos (suma de cantidades) no cancelados. */
  dishes: number;
  /** De esos platos, cuántos hay en cada estado. */
  noted: number;
  inKitchen: number;
  delivered: number;
  /** Suma de las líneas no canceladas, en centavos. */
  totalCents: number;
};

export type MesaCall = { kind: CallKind; createdAt: string };

export type MesaCard = {
  tableId: string;
  tableLabel: string;
  branchName: string;
  /** Llamados pendientes de menos de 30 minutos; el que más espera, primero. */
  calls: MesaCall[];
  /** El pedido abierto de la mesa, o `null` si está libre. */
  order: MesaOrder | null;
};

export type MesasState = {
  serverNow: string;
  /** `false` si el plan o la cuenta no permiten pedidos: no hay lista ni sondeo. */
  enabled: boolean;
  multiBranch: boolean;
  branches: SalaBranch[];
  /** Vista efectiva de la persona (ids de las sucursales que mira; vacío = todas). */
  view: string[];
  mesas: MesaCard[];
};

export const LINE_STATUSES: readonly LineStatus[] = ["noted", "in_kitchen", "delivered", "cancelled"];

export const isLineStatus = (value: unknown): value is LineStatus => LINE_STATUSES.includes(value as LineStatus);

/** Lo que vale una línea: cantidad por (precio efectivo + opciones). */
export function lineCents(line: Pick<OrderLine, "quantity" | "unitPriceCents" | "optionsCents">): number {
  return line.quantity * (line.unitPriceCents + line.optionsCents);
}

/** Total de un pedido: las líneas canceladas no suman. */
export function orderCents(lines: readonly OrderLine[]): number {
  return lines.reduce((sum, line) => (line.status === "cancelled" ? sum : sum + lineCents(line)), 0);
}

/**
 * Resume un pedido abierto. `null` si no le queda ninguna línea sin cancelar (un pedido recién abierto del que se canceló todo no
 * muestra platos ni total: la mesa se ve como libre y el pedido sigue abierto hasta que el mozo lo cierre).
 */
export function summarizeOrder(openedAt: string, lines: readonly OrderLine[]): MesaOrder | null {
  const live = lines.filter((line) => line.status !== "cancelled");
  if (live.length === 0) return null;
  const units = (status: LineStatus) => live.filter((line) => line.status === status).reduce((sum, line) => sum + line.quantity, 0);
  return {
    openedAt,
    dishes: live.reduce((sum, line) => sum + line.quantity, 0),
    noted: units("noted"),
    inKitchen: units("in_kitchen"),
    delivered: units("delivered"),
    totalCents: orderCents(live),
  };
}

const rankOf = (card: MesaCard): number => {
  if (card.calls.some((call) => call.kind === "bill")) return 0;
  if (card.calls.length > 0) return 1;
  return card.order ? 2 : 3;
};

const byLabel = (a: MesaCard, b: MesaCard) => a.tableLabel.localeCompare(b.tableLabel, "es-AR", { numeric: true }) || a.branchName.localeCompare(b.branchName, "es-AR");

/**
 * Primero las que piden la cuenta, después las que llaman, después las que tienen pedido (el más antiguo primero: es el que más
 * lleva) y al final las libres. Dentro de cada grupo, por la etiqueta de la mesa (numérica) y la sucursal.
 */
export function sortMesas(mesas: readonly MesaCard[]): MesaCard[] {
  return [...mesas].sort((a, b) => {
    const rank = rankOf(a) - rankOf(b);
    if (rank !== 0) return rank;
    if (rankOf(a) === 2) {
      const opened = Date.parse(a.order!.openedAt) - Date.parse(b.order!.openedAt);
      if (opened !== 0) return opened;
    }
    if (rankOf(a) <= 1) {
      const waiting = Date.parse(a.calls[0].createdAt) - Date.parse(b.calls[0].createdAt);
      if (waiting !== 0) return waiting;
    }
    return byLabel(a, b);
  });
}

/** «3 platos · 1 anotado · 1 en cocina · 1 entregado» (sin los estados en cero). */
export function orderStatusText(order: MesaOrder): string {
  const parts = [order.dishes === 1 ? "1 plato" : `${order.dishes} platos`];
  if (order.noted > 0) parts.push(order.noted === 1 ? "1 anotado" : `${order.noted} anotados`);
  if (order.inKitchen > 0) parts.push(`${order.inKitchen} en cocina`);
  if (order.delivered > 0) parts.push(order.delivered === 1 ? "1 entregado" : `${order.delivered} entregados`);
  return parts.join(" · ");
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isCents = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isIso = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

function parseOrder(raw: unknown): MesaOrder | null | undefined {
  if (raw === null) return null;
  if (!isRecord(raw)) return undefined;
  const { openedAt, dishes, noted, inKitchen, delivered, totalCents } = raw;
  if (!isIso(openedAt) || !isCents(dishes) || !isCents(noted) || !isCents(inKitchen) || !isCents(delivered) || !isCents(totalCents)) return undefined;
  return { openedAt, dishes, noted, inKitchen, delivered, totalCents };
}

function parseCard(raw: unknown): MesaCard | null {
  if (!isRecord(raw)) return null;
  const { tableId, tableLabel, branchName, calls, order } = raw;
  if (typeof tableId !== "string" || typeof tableLabel !== "string" || typeof branchName !== "string" || !Array.isArray(calls)) return null;
  const parsedCalls: MesaCall[] = [];
  for (const call of calls) {
    if (!isRecord(call) || (call.kind !== "waiter" && call.kind !== "bill") || !isIso(call.createdAt)) return null;
    parsedCalls.push({ kind: call.kind, createdAt: call.createdAt });
  }
  const parsedOrder = parseOrder(order);
  if (parsedOrder === undefined) return null;
  return { tableId, tableLabel, branchName, calls: parsedCalls, order: parsedOrder };
}

/** Lee la respuesta de la ruta de consulta. Cualquier forma inesperada es `null` (la pantalla lo trata como error). */
export function parseMesasState(raw: unknown): MesasState | null {
  if (!isRecord(raw)) return null;
  const { serverNow, enabled, multiBranch, branches, view, mesas } = raw;
  if (!isIso(serverNow) || typeof enabled !== "boolean" || typeof multiBranch !== "boolean") return null;
  if (!Array.isArray(branches) || !Array.isArray(view) || !view.every((id) => typeof id === "string") || !Array.isArray(mesas)) return null;
  const parsedBranches = branches.map((branch) => (isRecord(branch) && typeof branch.id === "string" && typeof branch.name === "string" ? { id: branch.id, name: branch.name } : null));
  if (parsedBranches.some((branch) => branch === null)) return null;
  const parsed = mesas.map(parseCard);
  if (parsed.some((card) => card === null)) return null;
  return { serverNow, enabled, multiBranch, branches: parsedBranches as SalaBranch[], view: view as string[], mesas: parsed as MesaCard[] };
}
