import { describe, expect, it } from "vitest";
import { PAGE_SIZE, readAllByKey, readAllPages } from "./paginar";

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

/** Tabla con ids ordenables que se puede modificar entre dos páginas; PostgREST nunca devuelve más de PAGE_SIZE filas. */
function tablaViva(n: number) {
  const ids = Array.from({ length: n }, (_, i) => `id-${String(i).padStart(5, "0")}`);
  return {
    ids,
    porPosicion: (from: number, to: number) =>
      Promise.resolve({ data: ids.slice(from, Math.min(to, from + PAGE_SIZE - 1) + 1).map((id) => ({ id })), error: null }),
    porClave: (after: string | null, limit: number) =>
      Promise.resolve({ data: ids.filter((id) => after === null || id > after).slice(0, Math.min(limit, PAGE_SIZE)).map((id) => ({ id })), error: null }),
  };
}

describe("readAllByKey", () => {
  it.each([0, 1, PAGE_SIZE - 1, PAGE_SIZE, PAGE_SIZE + 1, 2 * PAGE_SIZE, 2 * PAGE_SIZE + 5])("lee las %i filas completas, en orden y sin repetir", async (n) => {
    const { ids, porClave } = tablaViva(n);
    const { data, error } = await readAllByKey(porClave);
    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual(ids);
  });

  it("propaga el error de cualquier página", async () => {
    const result = await readAllByKey(async (after) =>
      after === null ? { data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `id-${i}` })), error: null } : { data: null, error: { message: "boom" } },
    );
    expect(result).toEqual({ data: null, error: { message: "boom" } });
  });

  it("una baja entre dos páginas NO esconde otra fila (con offset sí: la primera de la segunda página se pierde sin error)", async () => {
    // Con offset: se leen las primeras 1000, se borra la primera y la página siguiente arranca una fila corrida.
    const offset = tablaViva(PAGE_SIZE + 1);
    const primera = await offset.porPosicion(0, PAGE_SIZE - 1);
    offset.ids.shift();
    const segunda = await offset.porPosicion(PAGE_SIZE, 2 * PAGE_SIZE - 1);
    const vistas = [...primera.data, ...segunda.data].map((row) => row.id);
    expect(vistas).not.toContain("id-01000"); // la fila 1001 existe y nunca se leyó

    // Por clave: mismo escenario (se borra la primera después de leer la primera página): no se pierde ninguna fila que sigue existiendo.
    const clave = tablaViva(PAGE_SIZE + 1);
    let paginas = 0;
    const { data, error } = await readAllByKey(async (after, limit) => {
      const page = await clave.porClave(after, limit);
      if (++paginas === 1) clave.ids.shift();
      return page;
    });
    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toContain("id-01000");
    expect(new Set(data?.map((row) => row.id)).size).toBe(data?.length);
  });

  it("un alta entre dos páginas no repite ni corre filas; el alta misma puede quedar fuera de ESA lectura (la siguiente la trae)", async () => {
    const clave = tablaViva(PAGE_SIZE + 1);
    const existianAntes = [...clave.ids];
    let paginas = 0;
    const { data } = await readAllByKey(async (after, limit) => {
      const page = await clave.porClave(after, limit);
      if (++paginas === 1) clave.ids.unshift("id-00000-nuevo"); // entra detrás del cursor
      return page;
    });
    const vistos = data?.map((row) => row.id) ?? [];
    // Garantía: toda fila que existía durante toda la lectura aparece, una sola vez y en orden.
    expect(vistos).toEqual(existianAntes);
    // Tolerancia aceptada: la fila creada a mitad de lectura no está en esta lectura, pero sí en la siguiente.
    expect(vistos).not.toContain("id-00000-nuevo");
    const { data: siguiente } = await readAllByKey(clave.porClave);
    expect(siguiente?.map((row) => row.id)).toContain("id-00000-nuevo");
  });
});
