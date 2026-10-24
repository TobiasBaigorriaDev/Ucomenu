import { describe, expect, it } from "vitest";
import { TEXTOS } from "@/lib/idiomas/textos";
import { applyPromotions, describeUntil, type ProductPromotion } from "./carta";
import { EVENT_LABEL, describeEntry, describePromotionSnapshot, type NameLookups } from "./historial";
import { instantAt, wallClock } from "./precio";

describe("hasta cuándo rige", () => {
  it("hoy, mañana y otro día, según el día de hoy en la sucursal", () => {
    expect(describeUntil("2026-12-18T20:00:00", "2026-12-18")).toEqual({ time: "20:00", day: "today", date: "18/12" });
    expect(describeUntil("2026-12-19T02:00:00", "2026-12-18")).toEqual({ time: "02:00", day: "tomorrow", date: "19/12" });
    expect(describeUntil("2026-12-19T00:00:00", "2026-12-18")).toEqual({ time: "00:00", day: "tomorrow", date: "19/12" });
    expect(describeUntil("2026-12-24T12:00:00", "2026-12-18")).toEqual({ time: "12:00", day: "later", date: "24/12" });
    // Cruce de mes y de año.
    expect(describeUntil("2027-01-01T01:00:00", "2026-12-31")?.day).toBe("tomorrow");
    expect(describeUntil("basura", "2026-12-18")).toBeNull();
  });

  it("los textos en los tres idiomas", () => {
    expect(TEXTOS.es.promo.until("20:00", "today", "18/12")).toBe("Hasta las 20:00");
    expect(TEXTOS.es.promo.until("00:00", "tomorrow", "19/12")).toBe("Hasta la medianoche");
    expect(TEXTOS.es.promo.until("02:00", "tomorrow", "19/12")).toBe("Hasta las 02:00 de mañana");
    expect(TEXTOS.es.promo.until("12:00", "later", "24/12")).toBe("Hasta el 24/12 a las 12:00");
    expect(TEXTOS.en.promo.until("20:00", "today", "18/12")).toBe("Until 20:00");
    expect(TEXTOS.en.promo.until("00:00", "tomorrow", "19/12")).toBe("Until midnight");
    expect(TEXTOS.pt.promo.until("20:00", "today", "18/12")).toBe("Até às 20:00");
    expect(TEXTOS.pt.promo.until("00:00", "tomorrow", "19/12")).toBe("Até a meia-noite");
    for (const lang of ["es", "en", "pt"] as const) expect(TEXTOS[lang].promo.was.length).toBeGreaterThan(3);
  });
});

describe("applyPromotions", () => {
  const promo = (priceCents: number): ProductPromotion => ({ priceCents, name: "Happy hour", until: { time: "20:00", day: "today", date: "18/12" } });
  const products = [
    { id: "a", price_cents: 1000 },
    { id: "b", price_cents: 500 },
    { id: "c", price_cents: 800 },
  ];

  it("pone la promoción en su plato y deja intacto el precio de lista", () => {
    const out = applyPromotions(products, new Map([["a", promo(700)]]));
    expect(out[0]).toEqual({ id: "a", price_cents: 1000, promotion: promo(700) });
    expect(out[1]).toEqual({ id: "b", price_cents: 500 });
    expect("promotion" in out[1]).toBe(false);
  });

  it("ignora una promoción que no baja el precio (la base no debería mandarla)", () => {
    const out = applyPromotions(products, new Map([["b", promo(500)], ["c", promo(900)]]));
    expect(out.every((p) => !("promotion" in p))).toBe(true);
  });

  it("un precio promocional de cero es un precio", () => {
    expect(applyPromotions(products, new Map([["a", promo(0)]]))[0].promotion?.priceCents).toBe(0);
  });
});

describe("instantAt: la hora de pared de una sucursal a un instante", () => {
  it("ida y vuelta con el reloj de pared, en zonas con y sin horario de verano", () => {
    const cases: [string, number, string][] = [
      ["2026-12-18", 20 * 60, "America/Argentina/Buenos_Aires"],
      ["2026-12-18", 0, "Europe/Madrid"],
      ["2026-07-01", 12 * 60 + 30, "Europe/Madrid"],
      ["2026-03-07", 150, "America/New_York"],
      ["2026-03-09", 150, "America/New_York"],
      ["2026-11-02", 90, "America/New_York"],
    ];
    for (const [date, minute, zone] of cases) expect(wallClock(instantAt(date, minute, zone), zone), `${date} ${minute} ${zone}`).toEqual({ date, minute });
  });

  it("20:00 en Buenos Aires es 23:00 UTC", () => {
    expect(instantAt("2026-12-18", 20 * 60, "America/Argentina/Buenos_Aires").toISOString()).toBe("2026-12-18T23:00:00.000Z");
  });

  it("la hora que no existe (salto de primavera) se corre una hora: 02:30 pasa a 03:30", () => {
    expect(wallClock(instantAt("2026-03-08", 150, "America/New_York"), "America/New_York")).toEqual({ date: "2026-03-08", minute: 210 });
  });
});

describe("el historial en palabras", () => {
  const names: NameLookups = {
    products: new Map([["p1", "Cerveza"]]),
    categories: new Map([["c1", "Bebidas"]]),
    branches: new Map([["b1", "Centro"]]),
  };
  const snapshot = { name: "Happy hour", discount_type: "percent", discount_value: 25, weekdays_mask: 31, start_minute: 1080, end_minute: 1200, starts_on: null, ends_on: null, is_active: true };

  it("alta y cambio dicen el descuento, los días y el horario; pausada se aclara", () => {
    const plain = (text: string | null) => text?.replace(/ /g, " ");
    expect(plain(describePromotionSnapshot(snapshot))).toBe("25 % de descuento · Lunes a viernes · De 18:00 a 20:00");
    expect(describePromotionSnapshot({ ...snapshot, is_active: false, starts_on: "2026-12-18" })).toBe(
      "25 % de descuento · Lunes a viernes · De 18:00 a 20:00 · Desde el 18/12/2026 · pausada",
    );
    expect(describeEntry({ event: "created", snapshot }, names)).toContain("25 % de descuento");
    expect(describePromotionSnapshot({ name: "x" })).toBeNull();
    expect(describePromotionSnapshot({ ...snapshot, discount_type: "raro" })).toBeNull();
  });

  it("platos, categorías y sucursales, aunque ya no existan", () => {
    expect(describeEntry({ event: "target_added", snapshot: { product_id: "p1" } }, names)).toBe("Plato: Cerveza");
    expect(describeEntry({ event: "target_added", snapshot: { category_id: "c1" } }, names)).toBe("Categoría: Bebidas");
    expect(describeEntry({ event: "branch_added", snapshot: { branch_id: "b1" } }, names)).toBe("Sucursal: Centro");
    expect(describeEntry({ event: "target_removed", snapshot: { product_id: "borrado" } }, names)).toBe("Plato: plato eliminado");
    expect(describeEntry({ event: "branch_removed", snapshot: { branch_id: "borrada" } }, names)).toContain("desactivada o eliminada");
  });

  it("la baja cuenta lo que tenía", () => {
    const deleted = { ...snapshot, targets: [{ product_id: "p1" }, { category_id: "c1" }], branches: [{ branch_id: "b1" }] };
    expect(describeEntry({ event: "deleted", snapshot: deleted }, names)).toBe(
      "25 % de descuento · Lunes a viernes · De 18:00 a 20:00 · Tenía 2 platos o categorías y 1 sucursal",
    );
    expect(describeEntry({ event: "deleted", snapshot: { name: "x", targets: [{ product_id: "p1" }] } }, names)).toBe("Tenía 1 plato o categoría");
  });

  it("cada evento tiene su etiqueta", () => {
    expect(Object.keys(EVENT_LABEL).sort()).toEqual(["branch_added", "branch_removed", "created", "deleted", "target_added", "target_removed", "updated"]);
  });
});
