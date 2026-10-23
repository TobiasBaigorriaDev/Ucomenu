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

describe("pagos anulados (ficha anular-pagos)", () => {
  const ANULADO = { ...PAGO, voided_at: "2026-10-19T14:30:00+00:00" };

  it("un pago vigente no trae fecha de anulación; uno anulado, sí", () => {
    expect(parsePayments([PAGO])![0].voidedAt).toBeNull();
    expect(parsePayments([{ ...PAGO, voided_at: null }])![0].voidedAt).toBeNull();
    expect(parsePayments([ANULADO])![0].voidedAt).toBe("2026-10-19T14:30:00+00:00");
  });

  it("una fecha de anulación rota es un error de lectura, no un pago vigente", () => {
    expect(parsePayments([{ ...PAGO, voided_at: "ayer" }])).toBeNull();
    expect(parsePayments([{ ...PAGO, voided_at: 5 }])).toBeNull();
  });

  it("el texto de un pago anulado lo dice primero y no muestra motivo ni autor", () => {
    const { voided, lines } = describePayment(parsePayments([ANULADO])![0]);
    expect(voided).toBe(true);
    expect(lines[0]).toBe("Anulado el 19/10/2026, 11:30: este pago ya no cuenta para tu vencimiento");
    expect(describePayment(parsePayments([PAGO])![0]).voided).toBe(false);
  });

  it("el movimiento «Pago anulado» muestra importe, medio y a qué fecha vuelve el vencimiento, y nada más", () => {
    const { title, lines } = describeHistory(
      fila("payment.voided", {
        amount_cents: 2_000_000,
        currency: "ARS",
        method: "transfer",
        plan: "pro",
        period_end: "2026-11-01T03:00:00+00:00",
        reason: "nota interna",
        actor_email: "equipo@ucomenu.test",
      }),
    );
    expect(title).toBe("Pago anulado");
    expect(lines[0].replace(/\s/g, " ")).toBe("$ 20.000 ARS");
    expect(lines.slice(1)).toEqual(["Transferencia", "Tu vencimiento vuelve al 1 de noviembre de 2026"]);
    expect(JSON.stringify({ title, lines })).not.toMatch(/nota interna|equipo@/);
  });

  it("la acción «payment.voided» es una de las que esta pantalla conoce", () => {
    const filas = parseHistory([{ id: "1", created_at: "2026-10-19T10:00:00+00:00", action: "payment.voided", detail: {} }])!;
    expect(filas.map((f) => f.action)).toEqual(["payment.voided"]);
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

describe("add-ons y reactivación (ficha addons-y-baja-de-organizaciones)", () => {
  const conocidas = ["addon.activated", "addon.changed", "addon.ended", "organization.reactivated"];

  it("la pantalla conoce las acciones nuevas", () => {
    const filas = parseHistory(conocidas.map((action, i) => ({ id: String(i), created_at: "2026-10-19T10:00:00+00:00", action, detail: {} })))!;
    expect(filas.map((f) => f.action)).toEqual(conocidas);
  });

  it("«add-on activado» dice cuál, los packs y hasta cuándo, y nada más", () => {
    const { title, lines } = describeHistory(
      fila("addon.activated", { addon: "webar", extra_packs: 2, ends_at: "2026-12-01T02:59:59+00:00", reason: "nota interna", actor_email: "equipo@ucomenu.test" }),
    );
    expect(title).toBe("WebAR activado por UcoMenu");
    expect(lines).toEqual(["2 packs extra", "Vigente hasta el 30 de noviembre de 2026"]);
    expect(JSON.stringify({ title, lines })).not.toMatch(/nota interna|equipo@/);
  });

  it("sin packs ni fin: «sin packs extra» y «sin fecha de fin»", () => {
    const { lines } = describeHistory(fila("addon.changed", { addon: "webar", extra_packs: 0 }));
    expect(lines).toEqual(["Sin packs extra", "Sin fecha de fin"]);
  });

  it("«add-on finalizado» dice cuándo terminó", () => {
    const { title, lines } = describeHistory(fila("addon.ended", { addon: "webar", ends_at: "2026-10-19T14:30:00+00:00" }));
    expect(title).toBe("WebAR finalizado por UcoMenu");
    expect(lines).toEqual(["Finalizó el 19 de octubre de 2026"]);
  });

  it("un add-on desconocido se muestra con su código y la reactivación va sin detalle", () => {
    expect(describeHistory(fila("addon.ended", { addon: "otro" })).title).toBe("otro finalizado por UcoMenu");
    expect(describeHistory(fila("organization.reactivated", { reason: "x" }))).toEqual({ title: "Local reactivado por UcoMenu", lines: [] });
  });
});

describe("sucursales adicionales en el historial (ficha sucursal-adicional)", () => {
  it("se cuentan sucursales, no «packs», y no se muestra fin ni motivo", () => {
    const activado = describeHistory(fila("addon.activated", { addon: "extra_branch", extra_packs: 1, ends_at: null, reason: "nota interna" }));
    expect(activado).toEqual({ title: "Sucursales adicionales activadas por UcoMenu", lines: ["1 sucursal adicional"] });
    const cambiado = describeHistory(fila("addon.changed", { addon: "extra_branch", extra_packs: 3 }));
    expect(cambiado).toEqual({ title: "Sucursales adicionales modificadas por UcoMenu", lines: ["3 sucursales adicionales"] });
    const finalizado = describeHistory(fila("addon.ended", { addon: "extra_branch", ends_at: "2026-10-19T14:30:00+00:00" }));
    expect(finalizado).toEqual({ title: "Sucursales adicionales finalizadas por UcoMenu", lines: ["Finalizaron el 19 de octubre de 2026"] });
  });
});
