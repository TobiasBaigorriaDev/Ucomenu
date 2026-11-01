import { describe, expect, it } from "vitest";
import { describeQuote, hasPayContent, parseQuote, returnNotice, startErrorMessage } from "./cotizacion";

const disponible = (extra: Record<string, unknown> = {}) => ({
  available: true,
  plan_code: "pro",
  billing_cycle: "monthly",
  currency: "ARS",
  plan_price_cents: 2_900_000,
  extra_branches: 0,
  extra_branch_unit_cents: 0,
  amount_cents: 2_900_000,
  period_end: "2026-11-05T00:00:00Z",
  ...extra,
});

describe("lectura de la cotización de la base", () => {
  it("lee una cotización disponible y el link pendiente", () => {
    const quote = parseQuote(disponible({ pending_intent: { id: "i-1", expires_at: "2026-11-05T12:00:00Z", amount_cents: 2_900_000 } }));
    expect(quote).toMatchObject({ available: true, planCode: "pro", billingCycle: "monthly", amountCents: 2_900_000, pending: { id: "i-1", expiresAt: "2026-11-05T12:00:00Z" } });
    expect(parseQuote(disponible())).toMatchObject({ available: true, pending: null, unpaid: [] });
    // Las intenciones sin pagar (aunque su link haya vencido) son las que «Ya pagué, verificar» consulta.
    expect(
      parseQuote(disponible({ unpaid_intents: [{ id: "i-2", expires_at: "2026-10-01T00:00:00Z" }, { id: 5 }, null, { id: "i-1", expires_at: "2026-09-01T00:00:00Z" }] }))?.unpaid,
    ).toEqual([
      { id: "i-2", expiresAt: "2026-10-01T00:00:00Z" },
      { id: "i-1", expiresAt: "2026-09-01T00:00:00Z" },
    ]);
  });

  it("lee el motivo cuando no se puede cobrar", () => {
    expect(parseQuote({ available: false, reason: "no_list_price" })).toEqual({ available: false, reason: "no_list_price", pending: null, unpaid: [] });
    expect(parseQuote({ available: false })).toEqual({ available: false, reason: "unknown", pending: null, unpaid: [] });
  });

  it("lo que no tiene la forma esperada no se interpreta: no se inventa un importe", () => {
    for (const malo of [null, undefined, "x", [], {}, { available: "si" }, disponible({ amount_cents: 0 }), disponible({ amount_cents: "29000" }), disponible({ plan_price_cents: null }), disponible({ plan_code: 3 })]) {
      expect(parseQuote(malo), JSON.stringify(malo)).toBeNull();
    }
  });
});

/** `Intl` separa «$» del número con un espacio de no separación: se compara con un espacio común. */
const plano = (summary: ReturnType<typeof describeQuote>) => ({
  ...summary,
  total: summary.total.replace(/ /g, " "),
  lines: summary.lines.map((line) => line.replace(/ /g, " ")),
});

describe("cuándo se muestra el bloque de pago", () => {
  const q = (raw: unknown) => parseQuote(raw)!;

  it("se muestra si se puede pagar, si ya está cubierto, si hay un pedido sin confirmar o si se vuelve de Mercado Pago", () => {
    expect(hasPayContent(q(disponible()), undefined)).toBe(true);
    expect(hasPayContent(q({ available: false, reason: "already_covered" }), undefined)).toBe(true);
    expect(hasPayContent(q({ available: false, reason: "no_list_price", unpaid_intents: [{ id: "i-1", expires_at: "2026-11-05T12:00:00Z" }] }), undefined)).toBe(true);
    expect(hasPayContent(q({ available: false, reason: "no_list_price" }), "exito")).toBe(true);
  });

  it("no se muestra (nada de título solo) cuando no hay qué ofrecer ni qué decir", () => {
    for (const reason of ["no_list_price", "suspended_manually", "price_unavailable", "organization_inactive", "too_many_unpaid", "unknown"]) {
      expect(hasPayContent(q({ available: false, reason }), undefined), reason).toBe(false);
    }
    // Un valor raro en `?pago=` no lo muestra.
    expect(hasPayContent(q({ available: false, reason: "no_list_price" }), "<script>")).toBe(false);
  });
});

describe("desglose y textos", () => {
  it("cuenta el plan y las sucursales adicionales, y el total por mes o por año", () => {
    const mensual = parseQuote(disponible({ extra_branches: 2, extra_branch_unit_cents: 1_200_000, amount_cents: 5_300_000 }));
    if (!mensual?.available) throw new Error("debía estar disponible");
    expect(plano(describeQuote(mensual))).toEqual({
      total: "$ 53.000 ARS",
      period: "por mes",
      lines: ["Plan Pro mensual: $ 29.000 ARS", "2 sucursales adicionales: $ 24.000 ARS"],
    });
    const anual = parseQuote(disponible({ billing_cycle: "yearly", plan_price_cents: 27_840_000, extra_branches: 1, extra_branch_unit_cents: 11_520_000, amount_cents: 39_360_000 }));
    if (!anual?.available) throw new Error("debía estar disponible");
    expect(plano(describeQuote(anual))).toEqual({
      total: "$ 393.600 ARS",
      period: "por año",
      lines: ["Plan Pro anual: $ 278.400 ARS", "1 sucursal adicional: $ 115.200 ARS"],
    });
  });

  it("explica cada motivo y cada error de «Pagar» con palabras del Dueño", () => {
    for (const reason of ["suspended_manually", "no_list_price", "price_unavailable", "already_covered", "too_many_unpaid", "otro"]) {
      expect(startErrorMessage({ notAvailable: reason })).toMatch(/\S/);
    }
    expect(startErrorMessage({ notAvailable: "already_covered" })).toContain("por adelantado");
    expect(startErrorMessage({ notAvailable: "too_many_unpaid" })).toContain("Ya pagué, verificar");
    for (const error of ["not_configured", "forbidden", "unavailable"] as const) expect(startErrorMessage(error)).toMatch(/\S/);
  });

  it("el aviso de regreso solo reconoce los resultados conocidos (los de Mercado Pago y los de verificar)", () => {
    expect(returnNotice("registrado")?.text).toContain("Registramos tu pago");
    expect(returnNotice("ya_registrado")?.tone).toBe("info");
    expect(returnNotice("revision")?.tone).toBe("warning");
    expect(returnNotice("exito")?.tone).toBe("info");
    expect(returnNotice("pendiente")?.tone).toBe("info");
    expect(returnNotice("fallo")?.tone).toBe("warning");
    expect(returnNotice("exito")?.text).toContain("Ya pagué, verificar");
    for (const raro of [undefined, "", "<script>", ["exito"], 1]) expect(returnNotice(raro)).toBeNull();
  });
});
