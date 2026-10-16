import { describe, expect, it } from "vitest";
import { accountState, parseEntitlements, trialStatus, moraNotice } from "@/lib/entitlements";
import { formatMoney } from "./format";
import {
  AMOUNT_MAX_CENTS,
  isCurrency,
  isPaymentMethod,
  parseAmountToCents,
  parsePaidOn,
  parseReason,
  parseReference,
  proposeCoversUntil,
  REASON_MAX_LENGTH,
  REFERENCE_MAX_LENGTH,
  todayInArgentina,
} from "./validation";

// 2026-10-14 12:00 en Argentina (15:00 UTC).
const NOW = new Date("2026-10-14T15:00:00Z");

describe("parseAmountToCents", () => {
  it.each([
    ["20000", 2_000_000],
    ["20000.5", 2_000_050],
    ["20000,50", 2_000_050],
    ["20.000,50", 2_000_050],
    ["1.234.567,89", 123_456_789],
    ["0,01", 1],
    ["  150  ", 15_000],
  ])("convierte %j a %i centavos", (texto, centavos) => {
    expect(parseAmountToCents(texto)).toBe(centavos);
  });

  it.each(["", "   ", "0", "0,00", "-5", "1,234", "1.234", "12,345", "1..2", "1,2,3", "abc", "1e3", "$100", "20.000.5", "20,000.50", "1.23,4"])(
    "rechaza %j",
    (texto) => {
      expect(parseAmountToCents(texto)).toBeNull();
    },
  );

  it("el tope es el de la base y no se pasa", () => {
    expect(parseAmountToCents(String(AMOUNT_MAX_CENTS / 100))).toBe(AMOUNT_MAX_CENTS);
    expect(parseAmountToCents(String(AMOUNT_MAX_CENTS / 100 + 1))).toBeNull();
    expect(parseAmountToCents("99999999999999999999")).toBeNull();
  });

  it("rechaza lo que no es texto", () => {
    for (const value of [null, undefined, 100, {}]) expect(parseAmountToCents(value)).toBeNull();
  });
});

describe("parseReason y parseReference", () => {
  it("el motivo se recorta, es obligatorio y llega a 200 caracteres", () => {
    expect(parseReason("  morosidad reiterada ")).toBe("morosidad reiterada");
    expect(parseReason("a".repeat(REASON_MAX_LENGTH))).toHaveLength(REASON_MAX_LENGTH);
    for (const value of ["", "   ", "a".repeat(REASON_MAX_LENGTH + 1), null, undefined, 3]) expect(parseReason(value)).toBeNull();
  });

  it("la referencia es opcional (vacío) y llega a 120 caracteres", () => {
    expect(parseReference(undefined)).toBe("");
    expect(parseReference("")).toBe("");
    expect(parseReference("  op 123  ")).toBe("op 123");
    expect(parseReference("a".repeat(REFERENCE_MAX_LENGTH))).toHaveLength(REFERENCE_MAX_LENGTH);
    expect(parseReference("a".repeat(REFERENCE_MAX_LENGTH + 1))).toBeNull();
    expect(parseReference(5)).toBeNull();
  });
});

describe("moneda y medio de pago", () => {
  it("solo las opciones de la lista", () => {
    expect(isCurrency("ARS") && isCurrency("USD")).toBe(true);
    for (const value of ["EUR", "ars", "", null, undefined]) expect(isCurrency(value)).toBe(false);
    for (const value of ["transfer", "payment_link", "cash", "other"]) expect(isPaymentMethod(value)).toBe(true);
    for (const value of ["card", "", null]) expect(isPaymentMethod(value)).toBe(false);
  });
});

describe("parsePaidOn", () => {
  it("acepta hoy (día de Argentina) y hasta 365 días atrás", () => {
    expect(parsePaidOn("2026-10-14", NOW)).toBe("2026-10-14");
    expect(parsePaidOn("2025-10-14", NOW)).toBe("2025-10-14");
  });

  it("rechaza el futuro, lo más viejo que un año y las fechas inexistentes", () => {
    expect(parsePaidOn("2026-10-15", NOW)).toBeNull();
    expect(parsePaidOn("2025-10-13", NOW)).toBeNull();
    expect(parsePaidOn("2026-02-30", NOW)).toBeNull();
    expect(parsePaidOn("14/10/2026", NOW)).toBeNull();
    expect(parsePaidOn(null, NOW)).toBeNull();
  });

  it("usa el día de Argentina, no el de UTC (01:00 UTC todavía es el día anterior allá)", () => {
    const madrugadaUtc = new Date("2026-10-15T01:00:00Z");
    expect(todayInArgentina(madrugadaUtc)).toBe("2026-10-14");
    expect(parsePaidOn("2026-10-14", madrugadaUtc)).toBe("2026-10-14");
    expect(parsePaidOn("2026-10-15", madrugadaUtc)).toBeNull();
  });
});

describe("proposeCoversUntil", () => {
  it("un mes después del vencimiento si todavía no venció", () => {
    // Vence el 20/10 (23:59:59 en Argentina = 21/10 02:59:59Z).
    expect(proposeCoversUntil("2026-10-21T02:59:59.000Z", "monthly", NOW)).toBe("2026-11-20");
  });

  it("un año si el ciclo es anual", () => {
    expect(proposeCoversUntil("2026-10-21T02:59:59.000Z", "yearly", NOW)).toBe("2027-10-20");
  });

  it("si ya venció, cuenta desde hoy (no regala meses atrasados ni los cobra de nuevo)", () => {
    expect(proposeCoversUntil("2026-08-01T02:59:59.000Z", "monthly", NOW)).toBe("2026-11-14");
  });

  it("sin vencimiento, cuenta desde hoy", () => {
    expect(proposeCoversUntil(null, "monthly", NOW)).toBe("2026-11-14");
  });

  it("un mes más corto deja el último día de ese mes y pasa de año en diciembre", () => {
    expect(proposeCoversUntil("2027-01-31T15:00:00.000Z", "monthly", new Date("2027-01-10T15:00:00Z"))).toBe("2027-02-28");
    expect(proposeCoversUntil("2028-01-31T15:00:00.000Z", "monthly", new Date("2028-01-10T15:00:00Z"))).toBe("2028-02-29");
    expect(proposeCoversUntil("2026-12-15T15:00:00.000Z", "monthly", new Date("2026-12-01T15:00:00Z"))).toBe("2027-01-15");
  });
});

describe("accountState y trialStatus", () => {
  const fin = new Date("2026-10-01T15:00:00Z");

  it("la suspensión manual manda sobre las fechas al día", () => {
    expect(accountState(fin, false, new Date(fin.getTime() - 1000))).toBe("active");
    expect(accountState(fin, true, new Date(fin.getTime() - 1000))).toBe("suspended");
  });

  it("sin suspensión manual sigue la regla de mora de siempre", () => {
    expect(accountState(fin, false, new Date(fin.getTime() + 3600_000))).toBe("grace");
    expect(accountState(null, false)).toBe("suspended");
  });

  it("la prueba tiene su propio estado, distinto de la mora", () => {
    const fin = new Date("2026-10-10T15:00:00Z");
    expect(trialStatus(null, null, NOW)).toBe("none");
    expect(trialStatus(null, "2026-11-01T00:00:00Z", NOW)).toBe("none");
    expect(trialStatus(new Date("2026-10-20T15:00:00Z"), null, NOW)).toBe("in_trial");
    expect(trialStatus(fin, null, new Date(fin.getTime()))).toBe("in_trial"); // borde inclusivo
    expect(trialStatus(fin, null, new Date(fin.getTime() + 1000))).toBe("expired");
    expect(trialStatus(fin, "2026-11-01T00:00:00Z", NOW)).toBe("converted");
  });
});

describe("entitlements: prueba y suspensión manual (solo Dueño)", () => {
  const dueno = {
    state: "suspended",
    can_write: false,
    features: [],
    plan: "pro",
    billing_cycle: "monthly",
    period_end: "2026-11-01T00:00:00Z",
    days_late: 0,
    trial_status: "converted",
    trial_ends_at: "2026-10-10T00:00:00Z",
    suspended_manually: true,
    limits: {},
    usage: {},
  };

  it("lee la prueba y la suspensión manual", () => {
    const ent = parseEntitlements(dueno);
    expect(ent?.trialStatus).toBe("converted");
    expect(ent?.trialEndsAt).toBe("2026-10-10T00:00:00Z");
    expect(ent?.suspendedManually).toBe(true);
  });

  it("el Staff no las recibe y un valor desconocido se ignora", () => {
    const ent = parseEntitlements({ state: "suspended", can_write: false, features: [], limits: {}, usage: {} });
    expect(ent?.trialStatus).toBeUndefined();
    expect(ent?.suspendedManually).toBeUndefined();
    expect(parseEntitlements({ ...dueno, trial_status: "otro", suspended_manually: "yes" })?.trialStatus).toBeUndefined();
    expect(parseEntitlements({ ...dueno, suspended_manually: "yes" })?.suspendedManually).toBeUndefined();
  });

  it("el Dueño de una cuenta suspendida a mano ve que la suspendió UcoMenu; el Staff, el aviso de siempre", () => {
    const ent = parseEntitlements(dueno)!;
    expect(moraNotice(ent, "owner")?.title).toContain("suspendida por UcoMenu");
    expect(moraNotice(ent, "owner")?.body).toContain("a salvo");
    const staff = moraNotice({ ...ent, suspendedManually: undefined, plan: undefined, periodEnd: undefined, daysLate: undefined }, "staff");
    expect(`${staff?.title} ${staff?.body}`).toContain("dueño");
    expect(`${staff?.title} ${staff?.body}`).not.toMatch(/\d/);
  });

  it("una suspensión por mora (no manual) conserva el aviso de mora del Dueño", () => {
    const ent = parseEntitlements({ ...dueno, suspended_manually: false, days_late: 20 })!;
    expect(moraNotice(ent, "owner")?.title).toBe("Tu cuenta está suspendida");
  });
});

describe("formatMoney", () => {
  it("muestra el importe con su moneda", () => {
    expect(formatMoney(2_000_000, "ARS")).toMatch(/20\.000/);
    expect(formatMoney(2_000_000, "ARS")).toMatch(/ARS$/);
    expect(formatMoney(2_000_050, "ARS")).toMatch(/20\.000,50/);
    expect(formatMoney(2000, "USD")).toMatch(/20.*USD$/);
  });
});
