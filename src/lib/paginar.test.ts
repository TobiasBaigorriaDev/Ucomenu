import { describe, expect, it } from "vitest";
import { PAGE_SIZE, readAllPages } from "./paginar";

/** Simula PostgREST: nunca devuelve más de PAGE_SIZE filas por lectura, aunque se pidan más. */
const tabla = (n: number) => (from: number, to: number) =>
  Promise.resolve({
    data: Array.from({ length: n }, (_, i) => i).slice(from, Math.min(to, from + PAGE_SIZE - 1) + 1),
    error: null,
  });

describe("readAllPages", () => {
  it.each([0, 1, PAGE_SIZE - 1, PAGE_SIZE, PAGE_SIZE + 1, 2 * PAGE_SIZE + 5])("lee las %i filas completas", async (n) => {
    const { data, error } = await readAllPages(tabla(n));
    expect(error).toBeNull();
    expect(data).toHaveLength(n);
    expect(data?.at(-1)).toBe(n === 0 ? undefined : n - 1);
  });

  it("propaga el error de cualquier página", async () => {
    const result = await readAllPages(async (from) =>
      from === 0 ? { data: Array.from({ length: PAGE_SIZE }, (_, i) => i), error: null } : { data: null, error: { message: "boom" } },
    );
    expect(result).toEqual({ data: null, error: { message: "boom" } });
  });
});
