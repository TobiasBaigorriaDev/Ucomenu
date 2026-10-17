import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { loadSoldOutProducts } from "./availability";

afterEach(() => vi.unstubAllGlobals());
describe("lectura pública de disponibilidad", () => {
  it.each([0, 1000, 1001, 2005])("pagina %i estados de la sucursal, sin mezclar otras", async (count) => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input);
      expect(url.searchParams.get("organization_id")).toBe("eq.org");
      expect(url.searchParams.get("branch_id")).toBe("eq.branch");
      expect(url.searchParams.get("is_available")).toBe("eq.false");
      expect(url.searchParams.get("order")).toBe("product_id.asc");
      const from = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 1000);
      return Response.json(Array.from({ length: count }, (_, i) => ({ product_id: `p-${i}` })).slice(from, from + limit));
    }));
    const db = createClient<Database>("http://supabase.test", "test-key");
    expect(await loadSoldOutProducts(db, "org", "branch")).toEqual(new Set(Array.from({ length: count }, (_, i) => `p-${i}`)));
  });
  it("un fallo de lectura nunca se interpreta como todos disponibles", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "no" }, { status: 400 })));
    const db = createClient<Database>("http://supabase.test", "test-key");
    await expect(loadSoldOutProducts(db, "org", "branch")).rejects.toThrow("No se pudo leer la disponibilidad");
  });
});
