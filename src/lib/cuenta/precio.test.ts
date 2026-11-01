import { describe, expect, it } from "vitest";
import type { Entitlements } from "@/lib/entitlements";
import { describePrice, planPriceText } from "./precio";

/** `Intl` separa la moneda del número con un espacio duro (que evita partir el importe al final de la línea): se compara con espacios comunes. */
const plain = (text: string | null) => text?.replace(/ /g, " ") ?? null;
const summary = (value: ReturnType<typeof describePrice>) => (value ? { headline: plain(value.headline), lines: value.lines.map((line) => plain(line)) } : null);

const catalog = { monthlyCents: 2_900_000, yearlyCents: 27_840_000, currency: "ARS" };
const sinPrecio = { monthlyCents: null, yearlyCents: null, currency: "ARS" };
const ent = (over: Partial<Entitlements> = {}): Entitlements => ({ state: "active", canWrite: true, features: [], limits: {}, usage: {}, plan: "pro", billingCycle: "monthly", ...over });

describe("planPriceText", () => {
  it("dice el precio por mes o por año según el ciclo", () => {
    expect(plain(planPriceText("monthly", catalog))).toBe("$ 29.000 ARS por mes");
    expect(plain(planPriceText("yearly", catalog))).toBe("$ 278.400 ARS por año");
  });
  it("sin ciclo conocido o sin catálogo no inventa un precio", () => {
    expect(planPriceText(undefined, catalog)).toBeNull();
    expect(planPriceText("quarterly", catalog)).toBeNull();
    expect(planPriceText("monthly", null)).toBeNull();
  });
  it("un plan sin precio de lista (Premium, no se vende) no muestra ninguno", () => {
    expect(planPriceText("monthly", sinPrecio)).toBeNull();
    expect(planPriceText("yearly", sinPrecio)).toBeNull();
    expect(describePrice(ent({ plan: "premium" }), sinPrecio)).toBeNull();
  });
});

describe("describePrice: sucursales adicionales en una cuenta anual", () => {
  const anual = (over: Partial<Entitlements> = {}) => ent({ billingCycle: "yearly", extraBranches: 2, extraBranchPriceCents: 1_200_000, extraBranchCurrency: "ARS", ...over });

  it("se cobran por año con el precio anual, no el mensual rotulado «por mes»", () => {
    expect(summary(describePrice(anual(), { ...catalog }, 11_520_000))!.lines).toEqual(["Más $ 230.400 ARS por año por 2 sucursales adicionales."]);
    expect(summary(describePrice(anual({ trialStatus: "in_trial" }), { ...catalog }, 11_520_000))!.lines.at(-1)).toBe(
      "Más $ 230.400 ARS por año por 2 sucursales adicionales (cuando termine la prueba).",
    );
  });

  it("sin el precio anual no se dice ninguno (no se inventa ni se muestra el mensual)", () => {
    expect(summary(describePrice(anual(), { ...catalog }, null))!.lines).toEqual([]);
    expect(summary(describePrice(anual(), { ...catalog }))!.lines).toEqual([]);
  });

  it("una cuenta mensual sigue mostrando el precio mensual aunque llegue el anual", () => {
    expect(summary(describePrice(anual({ billingCycle: "monthly" }), catalog, 11_520_000))!.lines).toEqual(["Más $ 24.000 ARS por mes por 2 sucursales adicionales."]);
  });
});

describe("describePrice", () => {
  it("plan mensual: el precio del plan y nada más", () => {
    expect(summary(describePrice(ent(), catalog))).toEqual({ headline: "$ 29.000 ARS por mes", lines: [] });
  });

  it("plan anual: el precio por año", () => {
    expect(summary(describePrice(ent({ billingCycle: "yearly" }), catalog))!.headline).toBe("$ 278.400 ARS por año");
  });

  it("las sucursales adicionales van en su propia línea, en su moneda, sin sumarlas al plan", () => {
    const result = summary(describePrice(ent({ extraBranches: 2, extraBranchPriceCents: 1_200_000, extraBranchCurrency: "ARS" }), catalog))!;
    expect(result.headline).toBe("$ 29.000 ARS por mes");
    expect(result.lines).toEqual(["Más $ 24.000 ARS por mes por 2 sucursales adicionales."]);
  });

  it("una sola sucursal adicional va en singular", () => {
    const result = summary(describePrice(ent({ extraBranches: 1, extraBranchPriceCents: 1_200_000, extraBranchCurrency: "ARS" }), catalog))!;
    expect(result.lines[0]).toContain("por 1 sucursal adicional.");
  });

  it("en la prueba gratuita no cobra nada y avisa qué viene después", () => {
    const result = summary(describePrice(ent({ trialStatus: "in_trial", extraBranches: 1, extraBranchPriceCents: 1_200_000, extraBranchCurrency: "ARS" }), catalog))!;
    expect(result.headline).toBe("Sin costo durante la prueba");
    expect(result.lines).toEqual(["Después de la prueba: $ 29.000 ARS por mes.", "Más $ 12.000 ARS por mes por 1 sucursal adicional (cuando termine la prueba)."]);
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
