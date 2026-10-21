import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { applyBranchSettings, loadBranchSettings, type BranchProductSetting } from "./availability";

afterEach(() => vi.unstubAllGlobals());

const cliente = () => createClient<Database>("http://supabase.test", "test-key");

describe("lectura pública de los ajustes de una sucursal", () => {
  it.each([0, 1000, 1001, 2005])("lee por clave %i ajustes de la sucursal, sin mezclar otras", async (count) => {
    const ids = Array.from({ length: count }, (_, i) => `p-${String(i).padStart(5, "0")}`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : input);
        expect(url.searchParams.get("organization_id")).toBe("eq.org");
        expect(url.searchParams.get("branch_id")).toBe("eq.branch");
        expect(url.searchParams.get("or")).toBe("(is_available.eq.false,is_visible.eq.false,price_cents.not.is.null)");
        expect(url.searchParams.get("order")).toBe("product_id.asc");
        const after = url.searchParams.get("product_id")?.replace("gt.", "") ?? null;
        const limit = Number(url.searchParams.get("limit") ?? 1000);
        const page = ids.filter((id) => after === null || id > after).slice(0, Math.min(limit, 1000));
        return Response.json(page.map((id) => ({ id, is_available: false, is_visible: true, price_cents: null })));
      }),
    );
    const settings = await loadBranchSettings(cliente(), "org", "branch");
    expect([...settings.keys()]).toEqual(ids);
  });

  it("lee el precio propio (cero incluido), la visibilidad y el agotado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          { id: "a", is_available: true, is_visible: true, price_cents: 0 },
          { id: "b", is_available: true, is_visible: false, price_cents: null },
          { id: "c", is_available: false, is_visible: true, price_cents: 1500 },
        ]),
      ),
    );
    expect(await loadBranchSettings(cliente(), "org", "branch")).toEqual(
      new Map([
        ["a", { isAvailable: true, isVisible: true, priceCents: 0 }],
        ["b", { isAvailable: true, isVisible: false, priceCents: null }],
        ["c", { isAvailable: false, isVisible: true, priceCents: 1500 }],
      ]),
    );
  });

  it("un fallo de lectura nunca se interpreta como «sin ajustes»: se publicarían platos ocultos y precios equivocados", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "no" }, { status: 400 })));
    await expect(loadBranchSettings(cliente(), "org", "branch")).rejects.toThrow("No se pudieron leer los ajustes");
  });
});

describe("applyBranchSettings", () => {
  const platos = [
    { id: "base", price_cents: 1000 },
    { id: "propio", price_cents: 1000 },
    { id: "cero", price_cents: 1000 },
    { id: "oculto", price_cents: 1000 },
    { id: "agotado", price_cents: 1000 },
    { id: "oculto-y-agotado", price_cents: 1000 },
  ];
  const ajustes = new Map<string, BranchProductSetting>([
    ["propio", { isAvailable: true, isVisible: true, priceCents: 1800 }],
    ["cero", { isAvailable: true, isVisible: true, priceCents: 0 }],
    ["oculto", { isAvailable: true, isVisible: false, priceCents: null }],
    ["agotado", { isAvailable: false, isVisible: true, priceCents: null }],
    ["oculto-y-agotado", { isAvailable: false, isVisible: false, priceCents: 500 }],
  ]);

  it("sin ajuste hereda el precio base y está disponible; el precio propio manda (cero incluido); lo oculto desaparece; lo agotado se ve", () => {
    expect(applyBranchSettings(platos, ajustes)).toEqual([
      { id: "base", price_cents: 1000, is_available: true },
      { id: "propio", price_cents: 1800, is_available: true },
      { id: "cero", price_cents: 0, is_available: true },
      { id: "agotado", price_cents: 1000, is_available: false },
    ]);
  });

  it("un ajuste de un plato que ya no se publica (inactivo, borrado) no lo resucita", () => {
    expect(applyBranchSettings([{ id: "base", price_cents: 1000 }], new Map([["fantasma", { isAvailable: true, isVisible: true, priceCents: 5 }]]))).toEqual([
      { id: "base", price_cents: 1000, is_available: true },
    ]);
  });

  it("sin ajustes devuelve el catálogo tal cual (los locales sin configuración no cambian)", () => {
    expect(applyBranchSettings(platos, new Map())).toEqual(platos.map((p) => ({ ...p, is_available: true })));
  });
});
