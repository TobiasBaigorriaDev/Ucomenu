import { describe, expect, it } from "vitest";
import { PLANES } from "@/lib/marketing/planes";
import { serviceClient, sql } from "./helpers";

/**
 * La portada pública copia los límites y los precios de Básico y Pro (la tabla `plans` exige sesión, así que no la lee).
 * Esta prueba evita que se separen: si cambia el catálogo en la base, hay que actualizar `src/lib/marketing/planes.ts`.
 */
describe("portada: planes coinciden con la base", () => {
  it("límites de Básico y Pro", async () => {
    const { data, error } = await serviceClient()
      .from("plans")
      .select("code, max_branches, max_tables_per_branch, max_active_products")
      .in("code", PLANES.map((p) => p.code));
    expect(error).toBeNull();
    for (const plan of PLANES) {
      expect(data?.find((fila) => fila.code === plan.code), plan.code).toEqual({
        code: plan.code,
        max_branches: plan.maxSucursales,
        max_tables_per_branch: plan.maxMesasPorSucursal,
        max_active_products: plan.maxPlatosActivos,
      });
    }
  });

  it("los precios en pesos de la portada son los del catálogo (mensual y anual, en centavos)", async () => {
    const { data, error } = await serviceClient()
      .from("plans")
      .select("code, monthly_price_cents, yearly_price_cents, price_currency")
      .in("code", PLANES.map((p) => p.code));
    expect(error).toBeNull();
    for (const plan of PLANES) {
      expect(data?.find((fila) => fila.code === plan.code), plan.code).toEqual({
        code: plan.code,
        monthly_price_cents: plan.mensualArs * 100,
        yearly_price_cents: plan.anualArs * 100,
        price_currency: "ARS",
      });
    }
  });

  it("Premium no se vende y no tiene precio de lista (nulo, no una cifra inventada)", async () => {
    const { data, error } = await serviceClient().from("plans").select("monthly_price_cents, yearly_price_cents").eq("code", "premium").single();
    expect(error).toBeNull();
    expect(data).toEqual({ monthly_price_cents: null, yearly_price_cents: null });
  });

  it("la base rechaza un plan con un solo precio de lista o con una moneda desconocida", () => {
    expect(() => sql("update public.plans set monthly_price_cents = 100, yearly_price_cents = null where code = 'premium'")).toThrow(/plans_prices_together_check/);
    expect(() => sql("update public.plans set price_currency = 'EUR' where code = 'basic'")).toThrow(/plans_price_currency_check/);
    expect(sql("select monthly_price_cents is null, price_currency from public.plans where code = 'premium'")).toEqual([["t", "ARS"]]);
  });

  it("Pro tiene el feed de videos con cupo de 10 (lo que dice la portada); Básico no", async () => {
    const { data, error } = await serviceClient().from("plans").select("code, features, max_videos_published").in("code", ["basic", "pro"]);
    expect(error).toBeNull();
    expect(data?.find((f) => f.code === "pro")).toMatchObject({ max_videos_published: 10 });
    expect(data?.find((f) => f.code === "pro")?.features).toContain("video_feed");
    expect(data?.find((f) => f.code === "basic")?.features).not.toContain("video_feed");
  });

  it("Premium no se ofrece en la portada (el plan sigue existiendo en la base, sin venderse)", () => {
    expect(PLANES.some((p) => (p.code as string) === "premium")).toBe(false);
  });
});
