/**
 * Cuenta del comensal (ficha cuenta-del-comensal, ADR 0044): lo que ve en su celular quien pidió la cuenta desde `/t/{token}`. NO es una
 * factura ni un comprobante. Reglas puras, sin dependencias de servidor; se prueban en `account.test.ts`.
 *
 * La AUTORIDAD es la base (`get_table_account`, solo `service_role`): ella decide si hay cuenta que mostrar (ticket del turno, «Pedir la
 * cuenta» dentro del turno, pedido abierto) y solo devuelve lo que ve el comensal. Acá se lee su respuesta FALLANDO CERRADO: cualquier forma
 * inesperada es un error, nunca un importe inventado.
 */
import type { Lang } from "@/lib/idiomas/idiomas";
import { isTipPercent, suggestedTip, type SuggestedTip } from "@/lib/propina";

export type AccountLine = {
  quantity: number;
  name: string;
  options: string[];
  /** Precio de UNA unidad con sus opciones, en centavos. */
  unitCents: number;
  /** Cantidad por precio de una unidad, en centavos. */
  lineCents: number;
};

export type AccountView = {
  orgName: string;
  branchName: string;
  tableLabel: string;
  timeZone: string;
  /** ISO 8601: cuándo se leyó la cuenta (la hora del servidor). */
  asOf: string;
  lines: AccountLine[];
  dishes: number;
  totalCents: number;
  tip: SuggestedTip | null;
};

export type AccountResult =
  | { status: "ok"; account: AccountView }
  /** Pidió la cuenta pero todavía no hay platos anotados. */
  | { status: "empty" }
  /** Ticket vencido, turno reiniciado o sin cuenta pedida: hay que escanear de nuevo. No se dice cuál. */
  | { status: "expired" }
  | { status: "error" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isCents = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 99;
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

function parseLine(raw: unknown): AccountLine | null {
  if (!isRecord(raw)) return null;
  const { quantity, name, options, unit_cents: unit, line_cents: line } = raw;
  if (!isCount(quantity) || !isText(name, 200) || !Array.isArray(options) || !isCents(unit) || !isCents(line)) return null;
  if (!options.every((option) => isText(option, 80))) return null;
  return { quantity, name, options: options as string[], unitCents: unit, lineCents: line };
}

/** Lee la respuesta de `get_table_account`. Cualquier forma inesperada es `error` (falla cerrado). */
export function parseAccount(raw: unknown): AccountResult {
  if (!isRecord(raw)) return { status: "error" };
  switch (raw.status) {
    case "empty":
      return { status: "empty" };
    case "not_found":
    case "unavailable":
      return { status: "expired" };
    case "ok": {
      const { org_name: orgName, branch_name: branchName, table_label: tableLabel, time_zone: timeZone, as_of: asOf, lines, dishes, total_cents: total } = raw;
      if (!isText(orgName, 200) || !isText(branchName, 200) || !isText(tableLabel, 200) || !isText(timeZone, 100) || !isText(asOf, 64)) return { status: "error" };
      if (Number.isNaN(Date.parse(asOf)) || !Array.isArray(lines) || !isCents(dishes) || !isCents(total)) return { status: "error" };
      const parsed = lines.map(parseLine);
      if (parsed.some((line) => line === null)) return { status: "error" };
      const ok = parsed as AccountLine[];
      // Los totales tienen que cerrar con las líneas: si no, no se muestra una cuenta que no suma.
      if (ok.reduce((sum, line) => sum + line.lineCents, 0) !== total || ok.reduce((sum, line) => sum + line.quantity, 0) !== dishes) return { status: "error" };
      if (!isTipPercent(raw.tip_percent)) return { status: "error" };
      try {
        const tip = suggestedTip(total, raw.tip_percent);
        return { status: "ok", account: { orgName, branchName, tableLabel, timeZone, asOf, lines: ok, dishes, totalCents: total, tip } };
      } catch {
        return { status: "error" };
      }
    }
    default:
      return { status: "error" };
  }
}

const LOCALE: Record<Lang, string> = { es: "es-AR", en: "en-US", pt: "pt-BR" };

/** «21:15» en la zona de la sucursal y con el formato del idioma. Una zona que no se reconoce cae a la de Buenos Aires. */
export function formatAsOf(iso: string, timeZone: string, lang: Lang): string {
  const date = new Date(iso);
  const format = (zone: string) => new Intl.DateTimeFormat(LOCALE[lang], { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  try {
    return format(timeZone);
  } catch {
    return format("America/Argentina/Buenos_Aires");
  }
}
