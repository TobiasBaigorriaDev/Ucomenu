/**
 * Precuenta de un pedido (ficha sala-precuenta, ADR 0041, decisión 6): lo que el mozo le muestra o imprime al cliente antes de cerrar la
 * mesa. NO es una factura ni un comprobante: lleva siempre la leyenda y no registra cobro, propina ni división de cuenta. Reglas puras,
 * sin dependencias de servidor; se prueban en `precuenta.test.ts`.
 *
 * Los importes salen de lo COPIADO al anotar (precio efectivo y diferencias de las opciones): la precuenta nunca recalcula con el
 * catálogo de hoy. Las líneas canceladas no salen ni suman. Las observaciones de cocina («sin sal») no salen.
 */
import type { AnotarLine } from "./anotar";
import { lineCents, orderCents } from "./mesas";

export const PRECUENTA_LEGEND = "No válida como factura";

export type PrecuentaLine = {
  quantity: number;
  name: string;
  /** Opciones elegidas (variantes y adicionales), en el orden anotado. */
  options: string[];
  /** Precio de UNA unidad con sus opciones, en centavos. */
  unitCents: number;
  /** Cantidad por precio de una unidad, en centavos. */
  lineCents: number;
};

export type PrecuentaBody = { lines: PrecuentaLine[]; dishes: number; totalCents: number };

/** Las líneas vigentes del pedido con sus importes y el total. Sin líneas vigentes: lista vacía y total 0. */
export function buildPrecuenta(lines: readonly AnotarLine[]): PrecuentaBody {
  const live = lines.filter((line) => line.status !== "cancelled");
  return {
    lines: live.map((line) => ({
      quantity: line.quantity,
      name: line.productName,
      options: line.options.map((option) => option.name),
      unitCents: line.unitPriceCents + line.optionsCents,
      lineCents: lineCents(line),
    })),
    dishes: live.reduce((sum, line) => sum + line.quantity, 0),
    totalCents: orderCents(live),
  };
}

/** «24/10/2026 21:15» en la zona de la sucursal (24 horas). Si la zona no se reconoce, en la de Buenos Aires. */
export function formatLocal(iso: string | Date, timeZone: string): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const format = (zone: string) =>
    new Intl.DateTimeFormat("es-AR", { timeZone: zone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .format(date)
      .replace(",", "");
  try {
    return format(timeZone);
  } catch {
    return format("America/Argentina/Buenos_Aires");
  }
}

/** Cómo se avisa el estado del pedido en la cabecera: el abierto es lo normal y no lleva aviso. */
export function statusNotice(status: "open" | "closed" | "void"): string | null {
  if (status === "closed") return "Pedido cerrado";
  if (status === "void") return "Pedido anulado: no usar como cuenta";
  return null;
}
