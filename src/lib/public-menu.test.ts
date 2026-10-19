import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRows } from "./public-menu";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const MAX_ROWS = 1000; // El corte real configurado en PostgREST.

/** Usa el cliente Supabase real contra una respuesta HTTP simulada, sin base ni red. */
function mockPostgrest(n: number, failedTable?: "categories" | "products") {
  const categories = Array.from({ length: n }, (_, i) => ({
    id: `category-${String(i).padStart(5, "0")}`,
    name: `Categoría ${i}`,
    sort_order: n - i,
  }));
  const products = categories.map((category, i) => ({
    id: `product-${String(i).padStart(5, "0")}`,
    category_id: category.id,
    name: `Plato ${i}`,
    description: null,
    price_cents: 1000,
    sort_order: n - i,
    image_path: null,
  }));
  const tables = { categories, products, option_groups: [], options: [] };
  const requests = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const table = url.pathname.split("/").at(-1) as keyof typeof tables;
    expect(url.searchParams.get("organization_id")).toBe(`eq.${ORG_ID}`);
    const from = Number(url.searchParams.get("offset") ?? 0);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? MAX_ROWS), MAX_ROWS);
    if (table === failedTable && from >= MAX_ROWS) {
      return Response.json({ code: "TEST", message: "Falló la segunda página" }, { status: 400 });
    }
    // El orden de inserción difiere del de id: paginar exige pedir un orden estable.
    const rows = [...tables[table]].reverse();
    if (url.searchParams.get("order") === "id.asc") rows.sort((a, b) => a.id.localeCompare(b.id));
    return Response.json(rows.slice(from, from + limit));
  });
  vi.stubGlobal("fetch", requests);
  return { categories, products };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-public-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("loadRows: categorías y platos paginados", () => {
  it.each([0, 1000, 1001, 2005])("devuelve las %i filas de cada tabla sin omisiones ni duplicados", async (n) => {
    const expected = mockPostgrest(n);
    const rows = await loadRows(ORG_ID);
    expect(rows.categories).toHaveLength(n);
    expect(rows.products).toHaveLength(n);
    for (let i = 0; i < n; i++) {
      // La lectura agrega `translations` (vacío si la fila no trae traducciones).
      expect(rows.categories[i]).toEqual({ ...expected.categories[i], translations: {} });
      expect(rows.products[i]).toEqual({ ...expected.products[i], translations: {} });
    }
    expect(rows.optionGroups).toEqual([]);
    expect(rows.options).toEqual([]);
  });

  it("lee las traducciones con tolerancia: lo que no tiene la forma esperada se ignora y la carta no se rompe", async () => {
    const { categories, products } = mockPostgrest(3);
    Object.assign(categories[0], { translations: { en: { name: "Coffee" }, fr: { name: "Café" } } });
    Object.assign(products[0], { translations: { en: { name: "Dish", description: "Tasty" }, pt: "roto" } });
    Object.assign(products[1], { translations: [1, 2, 3] });
    Object.assign(products[2], { translations: null });
    const rows = await loadRows(ORG_ID);
    expect(rows.categories.find((c) => c.id === categories[0].id)?.translations).toEqual({ en: { name: "Coffee" } });
    expect(rows.products.find((p) => p.id === products[0].id)?.translations).toEqual({ en: { name: "Dish", description: "Tasty" } });
    expect(rows.products.find((p) => p.id === products[1].id)?.translations).toEqual({});
    expect(rows.products.find((p) => p.id === products[2].id)?.translations).toEqual({});
  });

  it.each([
    ["categories", "las categorías"],
    ["products", "los platos"],
  ] as const)("propaga el error de una página posterior de %s sin devolver una carta parcial", async (table, label) => {
    mockPostgrest(1001, table);
    await expect(loadRows(ORG_ID)).rejects.toThrow(`No se pudieron leer ${label}: Falló la segunda página`);
  });
});
