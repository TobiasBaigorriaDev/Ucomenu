import { describe, expect, it } from "vitest";
import type { Entitlements } from "@/lib/entitlements";
import { describePrice, planPriceText } from "./precio";

/** `Intl` separa la moneda del número con un espacio duro (que evita partir el importe al final de la línea): se compara con espacios comunes. */
const plain = (text: string | null) => text?.replace(/ /g, " ") ?? null;
const summary = (value: ReturnType<typeof describePrice>) => (value ? { headline: plain(value.headline), lines: value.lines.map((line) => plain(line)) } : null);

const catalog = { monthlyUsdCents: 4000, yearlyUsdCents: 38000 };
const ent = (over: Partial<Entitlements> = {}): Entitlements => ({ state: "active", canWrite: true, features: [], limits: {}, usage: {}, plan: "pro", billingCycle: "monthly", ...over });

describe("planPriceText", () => {
  it("dice el precio por mes o por año según el ciclo", () => {
    expect(plain(planPriceText("monthly", catalog))).toBe("US$ 40 USD por mes");
    expect(plain(planPriceText("yearly", catalog))).toBe("US$ 380 USD por año");
  });
  it("sin ciclo conocido o sin catálogo no inventa un precio", () => {
    expect(planPriceText(undefined, catalog)).toBeNull();
    expect(planPriceText("quarterly", catalog)).toBeNull();
    expect(planPriceText("monthly", null)).toBeNull();
  });
});

describe("describePrice", () => {
  it("plan mensual: el precio del plan y nada más", () => {
    expect(summary(describePrice(ent(), catalog))).toEqual({ headline: "US$ 40 USD por mes", lines: [] });
  });

  it("plan anual: el precio por año", () => {
    expect(summary(describePrice(ent({ billingCycle: "yearly" }), catalog))!.headline).toBe("US$ 380 USD por año");
  });

  it("las sucursales adicionales van en su propia línea, en su moneda, sin sumarlas al plan", () => {
    const result = summary(describePrice(ent({ extraBranches: 2, extraBranchPriceCents: 1_200_000, extraBranchCurrency: "ARS" }), catalog))!;
    expect(result.headline).toBe("US$ 40 USD por mes");
    expect(result.lines).toEqual(["Más $ 24.000 ARS por mes por 2 sucursales adicionales."]);
  });

  it("una sola sucursal adicional va en singular", () => {
    const result = summary(describePrice(ent({ extraBranches: 1, extraBranchPriceCents: 1_200_000, extraBranchCurrency: "ARS" }), catalog))!;
    expect(result.lines[0]).toContain("por 1 sucursal adicional.");
  });

  it("en la prueba gratuita no cobra nada y avisa qué viene después", () => {
    const result = summary(describePrice(ent({ trialStatus: "in_trial", extraBranches: 1, extraBranchPriceCents: 1_200_000, extraBranchCurrency: "ARS" }), catalog))!;
    expect(result.headline).toBe("Sin costo durante la prueba");
    expect(result.lines).toEqual(["Después de la prueba: US$ 40 USD por mes.", "Más $ 12.000 ARS por mes por 1 sucursal adicional (cuando termine la prueba)."]);
  });

  it("sin plan, o sin ciclo y fuera de la prueba, no muestra precio", () => {
    expect(describePrice(null, catalog)).toBeNull();
    expect(describePrice(ent({ plan: undefined }), catalog)).toBeNull();
    expect(describePrice(ent({ billingCycle: undefined }), catalog)).toBeNull();
    expect(describePrice(ent(), null)).toBeNull();
  });

  it("una prueba sin precio de lista legible igual dice que no cuesta nada", () => {
    expect(describePrice(ent({ trialStatus: "in_trial", billingCycle: undefined }), null)).toEqual({ headline: "Sin costo durante la prueba", lines: [] });
  });
});
