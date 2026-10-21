import { describe, expect, it } from "vitest";
import { billingState, BILLING_STATE_LABEL, moraNotice, parseEntitlements, type Entitlements } from "./entitlements";

const base: Entitlements = { state: "active", canWrite: true, features: [], limits: {}, usage: {} };
const FIN = "2026-10-01T15:00:00Z";

describe("parseEntitlements", () => {
  it("lee la respuesta completa del Dueño", () => {
    const ent = parseEntitlements({
      state: "grace",
      can_write: true,
      features: ["menu", "waiter_call"],
      limits: { branches: 1, active_products: 80, videos_published: null },
      usage: { branches: 1, active_products: 5 },
      plan: "basic",
      billing_cycle: "monthly",
      period_end: FIN,
      days_late: 3,
    });
    expect(ent).toEqual({
      state: "grace",
      canWrite: true,
      features: ["menu", "waiter_call"],
      plan: "basic",
      billingCycle: "monthly",
      periodEnd: FIN,
      daysLate: 3,
      limits: { branches: 1, active_products: 80, videos_published: null },
      usage: { branches: 1, active_products: 5 },
    });
  });

  it("la respuesta del Staff no trae plan ni fechas", () => {
    const ent = parseEntitlements({ state: "active", can_write: true, features: [], limits: {}, usage: {} });
    expect(ent?.plan).toBeUndefined();
    expect(ent?.periodEnd).toBeUndefined();
  });

  it("falla cerrado ante respuestas inválidas", () => {
    for (const raw of [null, undefined, "x", 3, [], {}, { state: "rara" }]) expect(parseEntitlements(raw), String(raw)).toBeNull();
  });

  it("can_write solo es verdadero si viene verdadero", () => {
    expect(parseEntitlements({ state: "read_only", can_write: "true" })?.canWrite).toBe(false);
    expect(parseEntitlements({ state: "read_only" })?.canWrite).toBe(false);
  });
});

describe("moraNotice", () => {
  it("la cuenta al día no muestra aviso", () => {
    expect(moraNotice(base, "owner")).toBeNull();
    expect(moraNotice(base, "staff")).toBeNull();
  });

  it("sin datos de la base no inventa un aviso", () => {
    expect(moraNotice(null, "owner")).toBeNull();
  });

  it("gracia, Dueño: días de atraso y fecha límite (7 días después del fin)", () => {
    const aviso = moraNotice({ ...base, state: "grace", periodEnd: FIN, daysLate: 3 }, "owner");
    expect(aviso?.tone).toBe("grace");
    expect(aviso?.title).toBe("Tu suscripción venció hace 3 días");
    expect(aviso?.body).toContain("hasta el 8 de octubre");
  });

  it("gracia, un solo día: singular", () => {
    expect(moraNotice({ ...base, state: "grace", periodEnd: FIN, daysLate: 1 }, "owner")?.title).toBe("Tu suscripción venció hace 1 día");
  });

  it("solo lectura, Dueño: fecha en que se suspende (15 días después del fin)", () => {
    const aviso = moraNotice({ ...base, state: "read_only", canWrite: false, periodEnd: FIN, daysLate: 9 }, "owner");
    expect(aviso?.tone).toBe("read_only");
    expect(aviso?.body).toContain("16 de octubre");
  });

  it("suspendida, Dueño: dice que la carta no se muestra y que los datos están a salvo", () => {
    const aviso = moraNotice({ ...base, state: "suspended", canWrite: false, periodEnd: FIN, daysLate: 20 }, "owner");
    expect(aviso?.tone).toBe("suspended");
    expect(aviso?.body).toContain("no se muestra");
    expect(aviso?.body).toContain("a salvo");
  });

  it("el Staff ve el estado sin fechas ni días y con «avisale al dueño»", () => {
    for (const state of ["grace", "read_only", "suspended"] as const) {
      const aviso = moraNotice({ ...base, state, canWrite: false, periodEnd: FIN, daysLate: 5 }, "staff");
      const texto = `${aviso?.title} ${aviso?.body}`;
      expect(texto, state).toContain("dueño");
      expect(texto, state).not.toMatch(/\d/);
    }
  });

  it("sin fecha de fin (Dueño), no inventa fechas", () => {
    const aviso = moraNotice({ ...base, state: "grace", daysLate: 2 }, "owner");
    expect(aviso?.body).not.toContain("hasta el");
  });
});

describe("billingState", () => {
  const fin = new Date("2026-10-01T15:00:00Z").getTime();
  const en = (ms: number) => new Date(fin + ms);
  const HORA = 3600_000;

  it("respeta los bordes inclusivos de la base: activa hasta el fin, gracia hasta +168 h, solo lectura hasta +360 h", () => {
    expect(billingState(en(0).toISOString(), en(-1000))).toBe("active");
    expect(billingState(en(0).toISOString(), en(0))).toBe("active");
    expect(billingState(en(0).toISOString(), en(1000))).toBe("grace");
    expect(billingState(en(0).toISOString(), en(168 * HORA))).toBe("grace");
    expect(billingState(en(0).toISOString(), en(168 * HORA + 1000))).toBe("read_only");
    expect(billingState(en(0).toISOString(), en(360 * HORA))).toBe("read_only");
    expect(billingState(en(0).toISOString(), en(360 * HORA + 1000))).toBe("suspended");
  });

  it("sin fecha (o con una fecha ilegible) falla cerrado: suspendida", () => {
    expect(billingState(null)).toBe("suspended");
    expect(billingState("no es una fecha")).toBe("suspended");
  });

  it("todos los estados tienen etiqueta", () => {
    for (const estado of ["active", "grace", "read_only", "suspended"] as const) expect(BILLING_STATE_LABEL[estado]).toBeTruthy();
  });
});
