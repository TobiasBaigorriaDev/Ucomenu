import { CYCLE_LABEL, formatMoney, METHOD_LABEL } from "@/lib/admin/format";
import { formatDateWithYear, PLAN_NAME } from "@/lib/entitlements";

/**
 * Lo que el Dueño lee de su cuenta (ficha dueno-lee-pagos-y-auditoria, ADR 0021): pagos y historial de cambios. La base
 * ya entrega solo lo que puede ver (`owner_payments` y `owner_account_history`); acá se lee la respuesta sin confiar en
 * su forma y se arma el texto. Puro: se prueba en `lectura.test.ts`.
 */

export const PAYMENTS_PAGE = 24;
export const HISTORY_PAGE = 25;

export type PaymentRow = {
  id: string;
  createdAt: string;
  /** AAAA-MM-DD: el día (de Argentina) en que se recibió el dinero. */
  paidOn: string;
  plan: string;
  billingCycle: string;
  amountCents: number;
  currency: string;
  method: string;
  reference: string | null;
  previousPeriodEnd: string;
  coversUntil: string;
};

export type HistoryAction =
  | "organization.created"
  | "subscription.plan_changed"
  | "subscription.suspended"
  | "subscription.reactivated"
  | "payment.registered"
  | "owner.added";

export type HistoryRow = { id: string; createdAt: string; action: HistoryAction; detail: Record<string, unknown> };

const ACTIONS: readonly string[] = [
  "organization.created",
  "subscription.plan_changed",
  "subscription.suspended",
  "subscription.reactivated",
  "payment.registered",
  "owner.added",
];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStr = (value: unknown): value is string => typeof value === "string" && value !== "";
const isDate = (value: unknown): value is string => isStr(value) && !Number.isNaN(Date.parse(value));

function parsePayment(raw: unknown): PaymentRow | null {
  if (!isRecord(raw)) return null;
  const r = raw;
  if (!isStr(r.id) || !isDate(r.created_at) || !isStr(r.paid_on) || !/^\d{4}-\d{2}-\d{2}$/.test(r.paid_on)) return null;
  if (!isStr(r.plan_code) || !isStr(r.billing_cycle) || !isStr(r.currency) || !isStr(r.method)) return null;
  if (typeof r.amount_cents !== "number" || !Number.isFinite(r.amount_cents) || !isDate(r.previous_period_end) || !isDate(r.covers_until)) return null;
  return {
    id: r.id,
    createdAt: r.created_at,
    paidOn: r.paid_on,
    plan: r.plan_code,
    billingCycle: r.billing_cycle,
    amountCents: r.amount_cents,
    currency: r.currency,
    method: r.method,
    reference: isStr(r.reference) ? r.reference : null,
    previousPeriodEnd: r.previous_period_end,
    coversUntil: r.covers_until,
  };
}

/** Lee la respuesta de `owner_payments`. Cualquier forma inesperada es `null` (la pantalla lo trata como error). */
export function parsePayments(raw: unknown): PaymentRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows = raw.map(parsePayment);
  return rows.some((row) => row === null) ? null : (rows as PaymentRow[]);
}

/** Lee la respuesta de `owner_account_history`. Una acción que esta pantalla no conoce se omite (no se inventa un texto). */
export function parseHistory(raw: unknown): HistoryRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: HistoryRow[] = [];
  for (const item of raw) {
    if (!isRecord(item) || !isStr(item.id) || !isDate(item.created_at) || !isStr(item.action)) return null;
    if (!ACTIONS.includes(item.action)) continue;
    rows.push({ id: item.id, createdAt: item.created_at, action: item.action as HistoryAction, detail: isRecord(item.detail) ? item.detail : {} });
  }
  return rows;
}

/**
 * Cursor de «Ver más»: la fecha de la última fila mostrada y su id (separados por «_»). La fecha sola no alcanza: varias
 * filas pueden compartirla y las que quedaron fuera de la página se saltarían. Viene de la dirección, así que solo se
 * acepta la forma exacta que devuelve la base (fecha con hora y zona + uuid).
 */
export type Cursor = { before: string; beforeId: string };

const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function parseCursor(value: unknown): Cursor | undefined {
  if (typeof value !== "string" || value.length > 80) return undefined;
  const match = CURSOR.exec(value);
  if (!match || Number.isNaN(Date.parse(match[1]))) return undefined;
  return { before: match[1], beforeId: match[2] };
}

export const formatCursor = (row: { createdAt: string; id: string }): string => `${row.createdAt}_${row.id}`;

/** «18 de octubre de 2026» a partir de AAAA-MM-DD, sin que la zona horaria lo corra un día. */
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

const dateTime = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Buenos_Aires",
});
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

const planLabel = (plan: unknown, cycle: unknown): string | null => {
  if (!isStr(plan)) return null;
  const name = PLAN_NAME[plan] ?? plan;
  return isStr(cycle) ? `${name}, ${CYCLE_LABEL[cycle] ?? cycle}` : name;
};

const STATE_AFTER_REACTIVATION: Record<string, string> = {
  active: "La cuenta quedó al día",
  grace: "Sigue vencida, en período de gracia",
  read_only: "Sigue vencida, en solo lectura",
  suspended: "Sigue suspendida por la fecha de vencimiento",
};

/** Cómo se ve cada movimiento: un título y las líneas de detalle. El autor es siempre el equipo de UcoMenu. */
export function describeHistory(row: HistoryRow): { title: string; lines: string[] } {
  const d = row.detail;
  const lines: string[] = [];
  switch (row.action) {
    case "organization.created": {
      const plan = planLabel(d.plan, d.billing_cycle);
      if (plan) lines.push(`Plan ${plan}`);
      if (isDate(d.period_end)) lines.push(`Vigente hasta el ${formatDateWithYear(d.period_end)}`);
      return { title: "Cuenta creada", lines };
    }
    case "subscription.plan_changed": {
      const from = planLabel(d.from_plan, d.from_billing_cycle);
      const to = planLabel(d.plan, d.billing_cycle);
      if (from && to) lines.push(`De ${from} a ${to}`);
      else if (to) lines.push(`Ahora: ${to}`);
      return { title: "Cambio de plan", lines };
    }
    case "subscription.suspended":
      return { title: "Cuenta suspendida por UcoMenu", lines };
    case "subscription.reactivated": {
      const state = isStr(d.state) ? STATE_AFTER_REACTIVATION[d.state] : undefined;
      if (state) lines.push(state);
      return { title: "Cuenta reactivada por UcoMenu", lines };
    }
    case "payment.registered": {
      if (typeof d.amount_cents === "number" && isStr(d.currency)) lines.push(formatMoney(d.amount_cents, d.currency));
      if (isStr(d.method)) lines.push(METHOD_LABEL[d.method] ?? d.method);
      const plan = planLabel(d.plan, d.billing_cycle);
      if (plan) lines.push(`Plan ${plan}`);
      if (isDate(d.period_end)) lines.push(`Cubre hasta el ${formatDateWithYear(d.period_end)}`);
      return { title: "Pago registrado", lines };
    }
    case "owner.added":
      return { title: d.promoted === true ? "Una persona del equipo pasó a Dueño" : "Se sumó una persona como Dueño", lines };
  }
}

/** Un pago para la lista: el importe y las líneas de detalle (medio, plan, período que cubre y referencia). */
export function describePayment(row: PaymentRow): { amount: string; lines: string[] } {
  const lines = [
    `${METHOD_LABEL[row.method] ?? row.method} · Plan ${planLabel(row.plan, row.billingCycle)}`,
    `Cubre hasta el ${formatDateWithYear(row.coversUntil)} (antes vencía el ${formatDateWithYear(row.previousPeriodEnd)})`,
    `Registrado el ${formatDateTime(row.createdAt)}`,
  ];
  if (row.reference) lines.push(`Referencia: ${row.reference}`);
  return { amount: formatMoney(row.amountCents, row.currency), lines };
}
