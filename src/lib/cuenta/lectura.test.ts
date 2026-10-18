import { describe, expect, it } from "vitest";
import { describeHistory, describePayment, formatCursor, formatDay, parseCursor, parseHistory, parsePayments, type HistoryRow } from "./lectura";

const PAGO = {
  id: "0b6f3d8c-0000-4000-8000-000000000001",
  created_at: "2026-10-18T15:47:25.123456+00:00",
  paid_on: "2026-10-18",
  plan_code: "pro",
  billing_cycle: "monthly",
  amount_cents: 2_000_000,
  currency: "ARS",
  method: "transfer",
  reference: "op-123",
  previous_period_end: "2026-10-20T00:00:00+00:00",
  covers_until: "2026-11-20T15:00:00+00:00",
};

const fila = (action: string, detail: Record<string, unknown> = {}): HistoryRow =>
  ({ id: "x", createdAt: "2026-10-18T15:47:25+00:00", action, detail }) as HistoryRow;

describe("lectura de pagos", () => {
  it("lee una fila válida y deja la referencia en null si está vacía", () => {
    const [pago] = parsePayments([PAGO, { ...PAGO, id: "otro", reference: null }])!;
    expect(pago).toMatchObject({ amountCents: 2_000_000, currency: "ARS", plan: "pro", billingCycle: "monthly", paidOn: "2026-10-18", reference: "op-123" });
    expect(parsePayments([{ ...PAGO, reference: null }])![0].reference).toBeNull();
  });

  it.each([
    ["no es una lista", { filas: [] }],
    ["importe como texto", [{ ...PAGO, amount_cents: "2000000" }]],
    ["fecha de pago rota", [{ ...PAGO, paid_on: "18/10/2026" }]],
    ["falta el período", [{ ...PAGO, covers_until: null }]],
    ["una fila que no es objeto", [PAGO, 7]],
  ])("una forma inesperada (%s) es un error, no una lista a medias", (_nombre, entrada) => {
    expect(parsePayments(entrada)).toBeNull();
  });

  it("el texto de un pago: importe con moneda, medio, plan, período y referencia", () => {
    const { amount, lines } = describePayment(parsePayments([PAGO])![0]);
    expect(amount.replace(/\s/g, " ")).toBe("$ 20.000 ARS"); // Intl usa un espacio fino
    expect(lines).toEqual([
      "Transferencia · Plan Pro, mensual",
      "Cubre hasta el 20 de noviembre de 2026 (antes vencía el 19 de octubre de 2026)",
      "Registrado el 18/10/2026, 12:47",
      "Referencia: op-123",
    ]);
  });
});

describe("fechas", () => {
  it("el día del pago no se corre por la zona horaria", () => {
    expect(formatDay("2026-10-18")).toBe("18 de octubre de 2026");
    expect(formatDay("2026-01-01")).toBe("1 de enero de 2026");
  });

  it("el cursor de «Ver más» lleva la fecha y el id de la última fila, y solo acepta esa forma exacta", () => {
    const id = "0b6f3d8c-0000-4000-8000-000000000001";
    expect(parseCursor(`2026-10-18T15:47:25.123456+00:00_${id}`)).toEqual({ before: "2026-10-18T15:47:25.123456+00:00", beforeId: id });
    expect(parseCursor(`2026-10-18T15:47:25Z_${id}`)).toEqual({ before: "2026-10-18T15:47:25Z", beforeId: id });
    expect(formatCursor({ createdAt: "2026-10-18T15:47:25+00:00", id })).toBe(`2026-10-18T15:47:25+00:00_${id}`);
    for (const malo of [
      "",
      "ayer",
      "2026-10-18T15:47:25Z", // sin id: un cursor de la versión anterior no sirve
      `2026-10-18_${id}`,
      `2026-13-45T99:99:99Z_${id}`,
      "2026-10-18T15:47:25Z_no-es-un-uuid",
      `2026-10-18T15:47:25Z_${id}; drop table payments`,
      undefined,
      5,
      [`2026-10-18T15:47:25Z_${id}`],
      `2026-10-18T15:47:25Z_${id}`.repeat(3),
    ]) {
      expect(parseCursor(malo as string)).toBeUndefined();
    }
  });
});

describe("historial", () => {
  it("lee las acciones conocidas y omite las que esta pantalla no conoce", () => {
    const filas = parseHistory([
      { id: "1", created_at: "2026-10-18T10:00:00+00:00", action: "payment.registered", detail: {} },
      { id: "2", created_at: "2026-10-18T09:00:00+00:00", action: "algo.nuevo", detail: { x: 1 } },
      { id: "3", created_at: "2026-10-18T08:00:00+00:00", action: "owner.added", detail: null },
    ])!;
    expect(filas.map((f) => f.id)).toEqual(["1", "3"]);
    expect(filas[1].detail).toEqual({});
  });

  it("una fila rota es un error de lectura", () => {
    expect(parseHistory([{ id: "1", created_at: "ayer", action: "owner.added" }])).toBeNull();
    expect(parseHistory("no")).toBeNull();
  });

  it.each([
    ["organization.created", { plan: "pro", billing_cycle: "yearly", period_end: "2027-01-10T12:00:00+00:00" }, "Cuenta creada", ["Plan Pro, anual", "Vigente hasta el 10 de enero de 2027"]],
    ["subscription.plan_changed", { from_plan: "basic", from_billing_cycle: "monthly", plan: "premium", billing_cycle: "yearly" }, "Cambio de plan", ["De Básico, mensual a Premium, anual"]],
    ["subscription.suspended", {}, "Cuenta suspendida por UcoMenu", []],
    ["subscription.reactivated", { state: "active" }, "Cuenta reactivada por UcoMenu", ["La cuenta quedó al día"]],
    ["subscription.reactivated", { state: "grace" }, "Cuenta reactivada por UcoMenu", ["Sigue vencida, en período de gracia"]],
    ["subscription.reactivated", { state: "algo-raro" }, "Cuenta reactivada por UcoMenu", []],
    ["owner.added", { promoted: false }, "Se sumó una persona como Dueño", []],
    ["owner.added", { promoted: true }, "Una persona del equipo pasó a Dueño", []],
  ])("%s", (accion, detalle, titulo, lineas) => {
    expect(describeHistory(fila(accion, detalle))).toEqual({ title: titulo, lines: lineas });
  });

  it("un pago registrado muestra importe, medio, plan y hasta cuándo cubre", () => {
    const { title, lines } = describeHistory(
      fila("payment.registered", { amount_cents: 1_500_050, currency: "USD", method: "payment_link", plan: "pro", billing_cycle: "monthly", period_end: "2026-12-01T03:00:00+00:00" }),
    );
    expect(title).toBe("Pago registrado");
    expect(lines.slice(1)).toEqual(["Link de pago", "Plan Pro, mensual", "Cubre hasta el 1 de diciembre de 2026"]);
    expect(lines[0]).toMatch(/15\.000,50.*USD/);
  });

  it("un detalle con claves de más no las muestra: solo lo previsto", () => {
    const { title, lines } = describeHistory(fila("subscription.suspended", { reason: "nota interna", actor_email: "equipo@ucomenu.test" }));
    expect(JSON.stringify({ title, lines })).not.toMatch(/nota interna|equipo@/);
  });
});
