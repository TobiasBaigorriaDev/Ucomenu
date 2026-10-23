import { describe, expect, it } from "vitest";
import { BRANCH_TIME_ZONES } from "@/lib/sucursales/rules";
import { CASE_BRANCHES, PRICE_SCENARIOS, ruleOf } from "./casos-precio";
import { effectivePrice, compareInstants, isoWeekday, previousDate, promotionPriceCents, wallClock, windowEndsLocal, type PromotionRule } from "./precio";

describe("la tabla de casos del precio efectivo (la misma que recorre la base de datos)", () => {
  for (const scenario of PRICE_SCENARIOS) {
    it(scenario.key, () => {
      const rules = scenario.promos.map((spec, index) => ({ spec, rule: ruleOf(spec, index) }));
      for (const probe of scenario.probes) {
        const product = scenario.products.find((p) => p.key === (probe.product ?? scenario.products[0].key));
        if (!product) throw new Error(`plato ${probe.product} no existe`);
        const base = product.branchPrices?.[probe.branch] ?? product.base;
        // Lo que la base filtra antes de calcular: pausa, sucursal y, por el objetivo, el plato.
        const applicable = rules
          .filter(({ spec }) => !spec.paused && (spec.branches === undefined || spec.branches.includes(probe.branch)))
          .filter(() => scenario.target === "category" || product.key === scenario.products[0].key)
          .map(({ rule }) => rule);
        const got = effectivePrice({ basePriceCents: base, promotions: applicable, timeZone: CASE_BRANCHES[probe.branch], at: new Date(probe.at) });
        const label = `${scenario.key} · ${probe.branch} · ${probe.at}`;
        expect(got.priceCents, label).toBe(probe.price);
        expect(got.basePriceCents, label).toBe(base);
        expect(got.promotion?.name ?? null, label).toBe(probe.promo);
        if (probe.endsLocal) expect(got.promotion?.endsLocal, label).toBe(probe.endsLocal);
      }
    });
  }

  it("cubre cada tipo de descuento, la medianoche, las fechas y el horario de verano", () => {
    const keys = PRICE_SCENARIOS.map((s) => s.key).join(" ");
    for (const pista of ["cruza-medianoche", "fechas", "horario-de-verano-primavera", "horario-de-verano-otono", "madrid", "empate", "categoria"]) {
      expect(keys, pista).toContain(pista);
    }
    const tipos = new Set(PRICE_SCENARIOS.flatMap((s) => s.promos.map((p) => p.type)));
    expect([...tipos].sort()).toEqual(["amount", "fixed_price", "percent"]);
  });

  it("las zonas de la tabla de casos están en la lista de zonas de las sucursales", () => {
    const ids: readonly string[] = BRANCH_TIME_ZONES.map((z) => z.id);
    for (const zone of Object.values(CASE_BRANCHES)) expect(ids).toContain(zone);
  });
});

describe("piezas del cálculo", () => {
  const rule = (over: Partial<PromotionRule> = {}): PromotionRule => ({
    id: "r",
    name: "r",
    discountType: "percent",
    discountValue: 10,
    weekdaysMask: 127,
    startMinute: 0,
    endMinute: 1440,
    startsOn: null,
    endsOn: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });

  it("el reloj de pared de un instante, con el día y el minuto", () => {
    expect(wallClock(new Date("2026-12-19T02:30:00Z"), "America/Argentina/Buenos_Aires")).toEqual({ date: "2026-12-18", minute: 23 * 60 + 30 });
    expect(wallClock(new Date("2026-12-19T02:30:00Z"), "Europe/Madrid")).toEqual({ date: "2026-12-19", minute: 3 * 60 + 30 });
    // Medianoche exacta: 00:00, no 24:00.
    expect(wallClock(new Date("2026-12-19T03:00:00Z"), "America/Argentina/Buenos_Aires")).toEqual({ date: "2026-12-19", minute: 0 });
  });

  it("día anterior y día de la semana ISO", () => {
    expect(previousDate("2026-03-01")).toBe("2026-02-28");
    expect(previousDate("2026-01-01")).toBe("2025-12-31");
    expect(previousDate("2028-03-01")).toBe("2028-02-29");
    expect([isoWeekday("2026-12-21"), isoWeekday("2026-12-20"), isoWeekday("2026-12-19")]).toEqual([1, 7, 6]);
  });

  it("el precio con la promoción, sin compararlo todavía con el de lista", () => {
    expect(promotionPriceCents(rule({ discountType: "percent", discountValue: 25 }), 10000)).toBe(7500);
    expect(promotionPriceCents(rule({ discountType: "amount", discountValue: 1500 }), 1000)).toBe(0);
    expect(promotionPriceCents(rule({ discountType: "fixed_price", discountValue: 1234 }), 5000)).toBe(1234);
    // Precios grandes: sin pérdida de precisión.
    expect(promotionPriceCents(rule({ discountType: "percent", discountValue: 1 }), 2_147_483_647)).toBe(2_126_008_811);
  });

  it("una franja de todo el día termina a la medianoche siguiente", () => {
    expect(windowEndsLocal(rule(), { date: "2026-12-18", minute: 0 })).toBe("2026-12-19T00:00:00");
    expect(windowEndsLocal(rule({ endMinute: 1 }), { date: "2026-12-18", minute: 1 })).toBeNull();
  });

  it("sin promociones, o sin ninguna en curso, el precio es el de lista", () => {
    const at = new Date("2026-12-18T15:00:00Z");
    const zone = "America/Argentina/Buenos_Aires";
    expect(effectivePrice({ basePriceCents: 900, promotions: [], timeZone: zone, at })).toEqual({ basePriceCents: 900, priceCents: 900, promotion: null });
    expect(effectivePrice({ basePriceCents: 900, promotions: [rule({ weekdaysMask: 1 })], timeZone: zone, at }).promotion).toBeNull(); // el viernes no es lunes
  });
});

describe("el desempate por antigüedad llega a los microsegundos, como en la base", () => {
  const fijo = (id: string, createdAt: string): PromotionRule => ({
    id,
    name: id,
    discountType: "fixed_price",
    discountValue: 700,
    weekdaysMask: 127,
    startMinute: 0,
    endMinute: 1440,
    startsOn: null,
    endsOn: null,
    createdAt,
  });
  const at = new Date("2026-12-18T15:00:00Z");
  const zone = "America/Argentina/Buenos_Aires";

  it("dos altas del mismo milisegundo: gana la primera aunque su id sea mayor", () => {
    const primera = fijo("ffffffff-0000-4000-8000-000000000000", "2026-01-01T00:00:00.000100+00:00");
    const segunda = fijo("00000000-0000-4000-8000-000000000001", "2026-01-01T00:00:00.000900+00:00");
    for (const orden of [[primera, segunda], [segunda, primera]]) {
      expect(effectivePrice({ basePriceCents: 1000, promotions: orden, timeZone: zone, at }).promotion?.id).toBe(primera.id);
    }
  });

  it("con la misma alta exacta gana el id menor", () => {
    const a = fijo("00000000-0000-4000-8000-00000000000a", "2026-01-01T00:00:00.5+00:00");
    const b = fijo("00000000-0000-4000-8000-00000000000b", "2026-01-01T00:00:00.500000+00:00");
    expect(effectivePrice({ basePriceCents: 1000, promotions: [b, a], timeZone: zone, at }).promotion?.id).toBe(a.id);
  });

  it("lee los formatos de fecha que devuelve la base y compara al microsegundo", () => {
    expect(compareInstants("2026-01-01T00:00:00.000100+00:00", "2026-01-01T00:00:00.000100Z")).toBe(0);
    expect(compareInstants("2026-01-01T00:00:00+00", "2026-01-01T00:00:00Z")).toBe(0);
    expect(compareInstants("2026-01-01 00:00:00.123456+00", "2026-01-01T00:00:00.123456Z")).toBe(0);
    expect(compareInstants("2026-01-01T03:00:00.000001+03:00", "2026-01-01T00:00:00Z")).toBe(1);
    expect(compareInstants("2026-01-01T00:00:00.1234567Z", "2026-01-01T00:00:00.123456Z")).toBe(0);
    expect(compareInstants("2026-01-01T00:00:00.000900Z", "2026-01-01T00:00:00.000100Z")).toBeGreaterThan(0);
    expect(compareInstants("2026-01-01T00:00:01Z", "2026-01-01T00:00:00.999999Z")).toBeGreaterThan(0);
  });
});
