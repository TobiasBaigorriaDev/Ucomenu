import { describe, expect, it } from "vitest";
import type { AdminContext } from "./organizations";
import { changePlan, endAddon, endFeaturePreview, isAddonActive, isVoidable, registerPayment, setAddon, setExtraBranches, setFeaturePreview, setOrganizationActive, setSuspension, voidPayment } from "./subscriptions";
import { accountState, parseEntitlements, trialStatus, moraNotice } from "@/lib/entitlements";
import { formatMoney } from "./format";
import {
  AMOUNT_MAX_CENTS,
  isAddonCode,
  isCurrency,
  isPaymentMethod,
  isPreviewFeature,
  parseAddonEnd,
  parseAmountToCents,
  parseBranchSelection,
  parseExtraBranches,
  parseExtraPacks,
  parsePaidOn,
  parsePreviewEnd,
  parseReason,
  parseReference,
  PREVIEW_FEATURES,
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

// ---------------------------------------------------------------------------
// Cómo traduce la aplicación lo que contesta la base (sin base: clientes simulados)
// ---------------------------------------------------------------------------

type RpcError = { code?: string; message?: string };

/** Contexto con un SuperAdmin, una organización y una función de base que contesta lo que se le indique. */
function fakeContext(rpc: { data?: unknown; error?: RpcError | null }): { ctx: AdminContext; llamadas: string[] } {
  const llamadas: string[] = [];
  const query = (data: unknown) => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data, error: null }) };
    return q;
  };
  const session = { from: () => query({ user_id: "actor" }) };
  const admin = {
    from: () => query({ id: "org-1" }),
    rpc: async (nombre: string) => {
      llamadas.push(nombre);
      return { data: rpc.data ?? null, error: rpc.error ?? null };
    },
  };
  return { ctx: { session, admin, actorId: "actor" } as unknown as AdminContext, llamadas };
}

const cambio = { slug: "local-1", plan: "basic", billingCycle: "monthly", reason: "x" };
const pagoValido = {
  slug: "local-1",
  amount: "100",
  currency: "ARS",
  method: "cash",
  reference: "",
  paidOn: todayInArgentina(new Date()),
  coversUntil: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10),
};

describe("errores de las funciones de base", () => {
  it("un error con SQLSTATE y un mensaje conocido se traduce al error de la aplicación", async () => {
    const casos: Array<[RpcError, string]> = [
      [{ code: "55000", message: "plan_unchanged" }, "plan_unchanged"],
      [{ code: "42501", message: "not_platform_admin" }, "forbidden"],
      [{ code: "22023", message: "invalid_reason" }, "invalid_reason"],
      [{ code: "P0002", message: "subscription_not_found" }, "org_not_found"],
    ];
    for (const [error, esperado] of casos) {
      const { ctx } = fakeContext({ error });
      expect(await changePlan(ctx, cambio), esperado).toEqual({ ok: false, error: esperado });
    }
  });

  it("un SQLSTATE con un mensaje desconocido es un error genérico (la transacción se revirtió)", async () => {
    const { ctx } = fakeContext({ error: { code: "XX000", message: "algo inesperado" } });
    expect(await setSuspension(ctx, { slug: "local-1", suspend: true, reason: "x" })).toEqual({ ok: false, error: "unexpected" });
  });

  it("sin SQLSTATE (red cortada, tiempo agotado) el resultado es INCIERTO, nunca un fallo seguro", async () => {
    for (const error of [{ code: "", message: "TypeError: fetch failed" }, { message: "timeout" }, { code: "PGRST000", message: "x" }]) {
      const { ctx } = fakeContext({ error });
      expect(await changePlan(ctx, cambio)).toEqual({ ok: false, error: "uncertain_change" });
      expect(await setSuspension(ctx, { slug: "local-1", suspend: false, reason: "x" })).toEqual({ ok: false, error: "uncertain_change" });
      expect(await registerPayment(ctx, pagoValido)).toEqual({ ok: false, error: "uncertain_change" });
    }
  });

  it("un pago que la base dice haber registrado pero sin identificador también es incierto", async () => {
    const { ctx } = fakeContext({ data: null });
    expect(await registerPayment(ctx, pagoValido)).toEqual({ ok: false, error: "uncertain_change" });
    const ok = fakeContext({ data: "pago-1" });
    expect(await registerPayment(ok.ctx, pagoValido)).toEqual({ ok: true, data: { paymentId: "pago-1" } });
  });

  it("lo inválido se rechaza antes de llamar a la base", async () => {
    const { ctx, llamadas } = fakeContext({ data: "pago-1" });
    expect(await changePlan(ctx, { ...cambio, reason: "  " })).toEqual({ ok: false, error: "invalid_reason" });
    expect(await changePlan(ctx, { ...cambio, plan: "gold" })).toEqual({ ok: false, error: "invalid_plan" });
    expect(await setSuspension(ctx, { slug: "local-1", suspend: true, reason: "" })).toEqual({ ok: false, error: "invalid_reason" });
    expect(await registerPayment(ctx, { ...pagoValido, amount: "0" })).toEqual({ ok: false, error: "invalid_amount" });
    expect(await registerPayment(ctx, { ...pagoValido, coversUntil: "2020-01-01" })).toEqual({ ok: false, error: "invalid_covers_until" });
    expect(llamadas).toEqual([]);
  });
});

describe("anular un pago (ficha anular-pagos)", () => {
  const PAGO_ID = "0b6f3d8c-0000-4000-8000-000000000001";
  const anulacion = { slug: "local-1", paymentId: PAGO_ID, reason: "Se cargó mal" };

  it("la base contesta con un identificador: la anulación quedó hecha", async () => {
    const { ctx, llamadas } = fakeContext({ data: "anulacion-1" });
    expect(await voidPayment(ctx, anulacion)).toEqual({ ok: true, data: { voidId: "anulacion-1" } });
    expect(llamadas).toEqual(["admin_void_payment"]);
  });

  it("cada error estable de la base se traduce a su error de la aplicación", async () => {
    const casos: Array<[RpcError, string]> = [
      [{ code: "42501", message: "not_platform_admin" }, "forbidden"],
      [{ code: "22023", message: "invalid_reason" }, "invalid_reason"],
      [{ code: "P0002", message: "subscription_not_found" }, "org_not_found"],
      [{ code: "P0002", message: "payment_not_found" }, "payment_not_found"],
      [{ code: "55000", message: "payment_already_voided" }, "payment_already_voided"],
      [{ code: "55000", message: "payment_not_latest" }, "payment_not_latest"],
      [{ code: "55000", message: "payment_history_inconsistent" }, "payment_history_inconsistent"],
    ];
    for (const [error, esperado] of casos) {
      const { ctx } = fakeContext({ error });
      expect(await voidPayment(ctx, anulacion), esperado).toEqual({ ok: false, error: esperado });
    }
  });

  it("sin SQLSTATE, o sin identificador en la respuesta, el resultado es INCIERTO: no se asume éxito ni fallo", async () => {
    for (const error of [{ code: "", message: "TypeError: fetch failed" }, { message: "timeout" }, { code: "PGRST000", message: "x" }]) {
      const { ctx } = fakeContext({ error });
      expect(await voidPayment(ctx, anulacion)).toEqual({ ok: false, error: "uncertain_change" });
    }
    const { ctx } = fakeContext({ data: null });
    expect(await voidPayment(ctx, anulacion)).toEqual({ ok: false, error: "uncertain_change" });
  });

  it("lo inválido se rechaza antes de llamar a la base", async () => {
    const { ctx, llamadas } = fakeContext({ data: "anulacion-1" });
    expect(await voidPayment(ctx, { ...anulacion, reason: "  " })).toEqual({ ok: false, error: "invalid_reason" });
    expect(await voidPayment(ctx, { ...anulacion, reason: "x".repeat(201) })).toEqual({ ok: false, error: "invalid_reason" });
    expect(await voidPayment(ctx, { ...anulacion, paymentId: "no-es-un-uuid" })).toEqual({ ok: false, error: "payment_not_found" });
    expect(await voidPayment(ctx, { ...anulacion, paymentId: undefined })).toEqual({ ok: false, error: "payment_not_found" });
    expect(await voidPayment(ctx, { ...anulacion, slug: "No Es Un Slug!" })).toEqual({ ok: false, error: "org_not_found" });
    expect(llamadas).toEqual([]);
  });

  it("solo se ofrece anular el pago que define el vencimiento actual y que no está anulado", () => {
    const pago = { coversUntil: "2026-11-20T15:00:00+00:00", voided: null };
    expect(isVoidable(pago, "2026-11-20T15:00:00+00:00")).toBe(true);
    expect(isVoidable(pago, "2026-11-20T12:00:00-03:00")).toBe(true); // el mismo instante en otra zona
    expect(isVoidable(pago, "2026-12-20T15:00:00+00:00")).toBe(false); // hay un pago más nuevo
    expect(isVoidable(pago, null)).toBe(false); // sin período propio
    expect(isVoidable({ ...pago, voided: { at: "2026-10-19T10:00:00+00:00", reason: "x" } }, "2026-11-20T15:00:00+00:00")).toBe(false);
  });
});

describe("add-ons (ficha addons-y-baja-de-organizaciones)", () => {
  const addon = { slug: "local-1", addon: "ensayo", extraPacks: "2", endsOn: "", reason: "Contrató el ensayo" };

  it("parseExtraPacks: enteros de 0 a 50; vacío cuenta como 0", () => {
    expect(parseExtraPacks("0")).toBe(0);
    expect(parseExtraPacks(" 7 ")).toBe(7);
    expect(parseExtraPacks("50")).toBe(50);
    expect(parseExtraPacks("")).toBe(0);
    expect(parseExtraPacks(undefined)).toBe(0);
    for (const malo of ["51", "-1", "1.5", "1,5", "abc", "1e2", "0x10", "1000", 3, {}]) expect(parseExtraPacks(malo), String(malo)).toBeNull();
  });

  it("parseAddonEnd: vacío = sin fin; una fecha real y futura = fin de ese día; lo demás no sirve", () => {
    expect(parseAddonEnd("", NOW)).toBeNull();
    expect(parseAddonEnd("  ", NOW)).toBeNull();
    expect(parseAddonEnd(undefined, NOW)).toBeNull();
    expect(parseAddonEnd("2026-12-31", NOW)).toBe("2027-01-01T02:59:59.000Z");
    for (const malo of ["2020-01-01", "2026-02-31", "ayer", "2030-01-01", 5]) expect(parseAddonEnd(malo, NOW), String(malo)).toBeUndefined();
  });

  it("isAddonCode y isAddonActive", () => {
    // Solo la forma: que exista en el catálogo (vacío desde ADR 0031) lo decide la base.
    expect(isAddonCode("ensayo")).toBe(true);
    expect(isAddonCode("add_on_2")).toBe(true);
    for (const malo of ["", "Otro", "otro add", "2otro", "otro-uno", "x".repeat(33), "'; drop table addons", null, 3]) expect(isAddonCode(malo), String(malo)).toBe(false);
    expect(isAddonActive(null, NOW)).toBe(true);
    expect(isAddonActive("2026-10-15T00:00:00Z", NOW)).toBe(true);
    expect(isAddonActive("2026-10-14T15:00:00Z", NOW)).toBe(false);
    expect(isAddonActive("2026-10-01T00:00:00Z", NOW)).toBe(false);
  });

  it("activar llega a la base con los datos ya validados (fin vacío = null)", async () => {
    const { ctx, llamadas } = fakeContext({ data: null });
    expect(await setAddon(ctx, addon, NOW)).toEqual({ ok: true, data: undefined });
    expect(llamadas).toEqual(["admin_set_addon"]);
  });

  it("lo inválido se rechaza antes de llamar a la base", async () => {
    const { ctx, llamadas } = fakeContext({ data: null });
    expect(await setAddon(ctx, { ...addon, addon: "No es un add-on" }, NOW)).toEqual({ ok: false, error: "invalid_addon" });
    expect(await setAddon(ctx, { ...addon, extraPacks: "51" }, NOW)).toEqual({ ok: false, error: "invalid_packs" });
    expect(await setAddon(ctx, { ...addon, endsOn: "2020-01-01" }, NOW)).toEqual({ ok: false, error: "invalid_ends_at" });
    expect(await setAddon(ctx, { ...addon, reason: " " }, NOW)).toEqual({ ok: false, error: "invalid_reason" });
    expect(await endAddon(ctx, { slug: "local-1", addon: "No es un add-on", reason: "x" })).toEqual({ ok: false, error: "invalid_addon" });
    expect(await endAddon(ctx, { slug: "local-1", addon: "ensayo", reason: "" })).toEqual({ ok: false, error: "invalid_reason" });
    expect(await setOrganizationActive(ctx, { slug: "local-1", active: false, reason: "" })).toEqual({ ok: false, error: "invalid_reason" });
    expect(await setOrganizationActive(ctx, { slug: "No Es Un Slug!", active: false, reason: "x" })).toEqual({ ok: false, error: "org_not_found" });
    expect(llamadas).toEqual([]);
  });

  it("cada error estable de la base se traduce a su error de la aplicación", async () => {
    const casos: Array<[RpcError, string]> = [
      [{ code: "42501", message: "not_platform_admin" }, "forbidden"],
      [{ code: "22023", message: "invalid_addon" }, "invalid_addon"],
      [{ code: "22023", message: "invalid_packs" }, "invalid_packs"],
      [{ code: "22023", message: "invalid_ends_at" }, "invalid_ends_at"],
      [{ code: "55000", message: "addon_not_allowed" }, "addon_not_allowed"],
      [{ code: "55000", message: "addon_unchanged" }, "addon_unchanged"],
      [{ code: "55000", message: "addon_not_active" }, "addon_not_active"],
      [{ code: "55000", message: "already_inactive" }, "already_inactive"],
      [{ code: "55000", message: "already_active" }, "already_active"],
      [{ code: "P0002", message: "organization_not_found" }, "org_not_found"],
    ];
    for (const [error, esperado] of casos) {
      const { ctx } = fakeContext({ error });
      expect(await setAddon(ctx, addon, NOW), esperado).toEqual({ ok: false, error: esperado });
      expect(await endAddon(ctx, { slug: "local-1", addon: "ensayo", reason: "x" }), esperado).toEqual({ ok: false, error: esperado });
      expect(await setOrganizationActive(ctx, { slug: "local-1", active: false, reason: "x" }), esperado).toEqual({ ok: false, error: esperado });
    }
  });

  it("sin SQLSTATE el resultado es INCIERTO: no se asume éxito ni fallo", async () => {
    for (const error of [{ code: "", message: "TypeError: fetch failed" }, { message: "timeout" }, { code: "PGRST000", message: "x" }]) {
      const { ctx } = fakeContext({ error });
      expect(await setAddon(ctx, addon, NOW)).toEqual({ ok: false, error: "uncertain_change" });
      expect(await endAddon(ctx, { slug: "local-1", addon: "ensayo", reason: "x" })).toEqual({ ok: false, error: "uncertain_change" });
      expect(await setOrganizationActive(ctx, { slug: "local-1", active: true, reason: "x" })).toEqual({ ok: false, error: "uncertain_change" });
    }
  });
});

describe("sucursales adicionales (ficha sucursal-adicional)", () => {
  const ID_A = "0b6f1c9e-3b0a-4c43-8f55-2f8e6a1d9a01";
  const ID_B = "7a1d3f52-9c3e-4e0b-a1b8-5d9e4c2f7b02";

  it("parseExtraBranches: enteros de 0 a 3; vacío cuenta como 0", () => {
    expect(parseExtraBranches("0")).toBe(0);
    expect(parseExtraBranches(" 3 ")).toBe(3);
    expect(parseExtraBranches("")).toBe(0);
    expect(parseExtraBranches(undefined)).toBe(0);
    for (const malo of ["4", "-1", "1.5", "01", "10", "abc", 2, {}]) expect(parseExtraBranches(malo), String(malo)).toBeNull();
  });

  it("parseBranchSelection: ids sin repetir (a lo sumo 3); nada = vacío", () => {
    expect(parseBranchSelection(undefined)).toEqual([]);
    expect(parseBranchSelection([])).toEqual([]);
    expect(parseBranchSelection([ID_A.toUpperCase(), ` ${ID_B} `])).toEqual([ID_A, ID_B]);
    for (const malo of [[ID_A, ID_A], ["no-es-un-id"], [ID_A, 5], "texto", [ID_A, ID_B, ID_A, ID_B]]) {
      expect(parseBranchSelection(malo), JSON.stringify(malo)).toBeNull();
    }
  });

  it("lo inválido se rechaza antes de llamar a la base y lo válido llega con la selección", async () => {
    const entrada = { slug: "local-1", quantity: "1", deactivate: [], reason: "Contrató" };
    const { ctx, llamadas } = fakeContext({ data: null });
    expect(await setExtraBranches(ctx, { ...entrada, quantity: "4" })).toEqual({ ok: false, error: "invalid_extra_branches" });
    expect(await setExtraBranches(ctx, { ...entrada, deactivate: ["x"] })).toEqual({ ok: false, error: "branches_selection_invalid" });
    expect(await setExtraBranches(ctx, { ...entrada, reason: " " })).toEqual({ ok: false, error: "invalid_reason" });
    expect(llamadas).toEqual([]);
    expect(await setExtraBranches(ctx, { ...entrada, deactivate: [ID_A] })).toEqual({ ok: true, data: undefined });
    expect(llamadas).toEqual(["admin_set_extra_branches"]);
  });

  it("los errores de la base se traducen", async () => {
    for (const mensaje of ["branches_selection_invalid", "addon_not_allowed", "addon_unchanged", "invalid_packs"] as const) {
      const { ctx } = fakeContext({ data: null, error: { code: mensaje === "invalid_packs" ? "22023" : "55000", message: mensaje } });
      const r = await setExtraBranches(ctx, { slug: "local-1", quantity: "1", deactivate: [], reason: "x" });
      expect(r, mensaje).toEqual({ ok: false, error: mensaje });
    }
    const { ctx } = fakeContext({ data: null, error: { code: "55000", message: "extra_branches_must_end" } });
    expect(await changePlan(ctx, { slug: "local-1", plan: "basic", billingCycle: "monthly", reason: "x" })).toEqual({ ok: false, error: "extra_branches_must_end" });
  });
});

describe("vistas previas de funciones (ficha vistas-previas-de-funciones)", () => {
  it("isPreviewFeature: solo las cuatro claves del incremento", () => {
    expect(PREVIEW_FEATURES).toEqual(["orders", "promotions", "review_invite", "customers"]);
    for (const clave of PREVIEW_FEATURES) expect(isPreviewFeature(clave)).toBe(true);
    for (const mala of ["menu", "video_feed", "loyalty", "", "ORDERS", null, 3]) expect(isPreviewFeature(mala), String(mala)).toBe(false);
  });

  it("parsePreviewEnd: obligatoria, futura (hoy vale hasta las 23:59 de Argentina) y de hasta 90 días", () => {
    // NOW = 2026-10-14 12:00 en Argentina.
    expect(parsePreviewEnd("2026-10-14", NOW)).toBe("2026-10-15T02:59:59.000Z");
    expect(parsePreviewEnd("2027-01-11", NOW)).not.toBeNull(); // 89 días
    expect(parsePreviewEnd("2027-01-12", NOW)).toBeNull(); // el final de ese día pasa de 90 días
    for (const mala of ["", "2026-10-13", "2026-02-31", "mañana", "2026-10-14T10:00", null, undefined, 5]) {
      expect(parsePreviewEnd(mala, NOW), String(mala)).toBeNull();
    }
  });

  it("lo inválido se rechaza antes de llamar a la base y lo válido llega con el fin en ISO", async () => {
    const entrada = { slug: "local-1", feature: "orders", endsOn: "2026-11-01", reason: "Piloto" };
    const { ctx, llamadas } = fakeContext({ data: null });
    expect(await setFeaturePreview(ctx, { ...entrada, feature: "video_feed" }, NOW)).toEqual({ ok: false, error: "invalid_preview_feature" });
    expect(await setFeaturePreview(ctx, { ...entrada, endsOn: "" }, NOW)).toEqual({ ok: false, error: "invalid_preview_end" });
    expect(await setFeaturePreview(ctx, { ...entrada, endsOn: "2027-06-01" }, NOW)).toEqual({ ok: false, error: "invalid_preview_end" });
    expect(await setFeaturePreview(ctx, { ...entrada, reason: " " }, NOW)).toEqual({ ok: false, error: "invalid_reason" });
    expect(await endFeaturePreview(ctx, { slug: "local-1", feature: "x", reason: "Fin" })).toEqual({ ok: false, error: "invalid_preview_feature" });
    expect(await endFeaturePreview(ctx, { slug: "local-1", feature: "orders", reason: "" })).toEqual({ ok: false, error: "invalid_reason" });
    expect(llamadas).toEqual([]);
    expect(await setFeaturePreview(ctx, entrada, NOW)).toEqual({ ok: true, data: undefined });
    expect(await endFeaturePreview(ctx, { slug: "local-1", feature: "orders", reason: "Fin" })).toEqual({ ok: true, data: undefined });
    expect(llamadas).toEqual(["admin_set_feature_preview", "admin_end_feature_preview"]);
  });

  it("los errores de la base se traducen", async () => {
    const casos = [
      ["invalid_feature", "22023", "invalid_preview_feature"],
      ["invalid_preview_end", "22023", "invalid_preview_end"],
      ["feature_in_plan", "55000", "feature_in_plan"],
      ["preview_unchanged", "55000", "preview_unchanged"],
      ["preview_not_active", "55000", "preview_not_active"],
    ] as const;
    for (const [mensaje, code, esperado] of casos) {
      const { ctx } = fakeContext({ data: null, error: { code, message: mensaje } });
      const r = await setFeaturePreview(ctx, { slug: "local-1", feature: "orders", endsOn: "2026-11-01", reason: "x" }, NOW);
      expect(r, mensaje).toEqual({ ok: false, error: esperado });
    }
  });
});
