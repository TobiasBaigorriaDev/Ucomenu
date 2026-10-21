/**
 * PostgREST corta cada lectura en `max_rows` (1000 en `supabase/config.toml`) SIN avisar: quien lee "todo" de una tabla
 * grande recibe la primera página y calcula con eso. Pide página por página hasta que una llega incompleta.
 */
export const PAGE_SIZE = 1000;

type Page<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Como `readAllPages`, pero por CLAVE: cada página pide las filas con `id` mayor que el último recibido (`order("id")` y
 * `limit`). Una baja o un alta mientras se lee no corre las páginas siguientes: con `offset`, borrar una fila ya leída salta
 * la primera de la página siguiente SIN error. Garantía: toda fila que existe durante TODA la lectura aparece una vez; una fila
 * creada (o borrada) a mitad de lectura puede o no estar en ESA lectura, y la siguiente la trae (PostgREST no ofrece una
 * transacción única entre pedidos). Las filas tienen que traer `id`.
 */
export async function readAllByKey<T extends { id: string }>(
  fetchPage: (after: string | null, limit: number) => PromiseLike<Page<T>>,
): Promise<Page<T>> {
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await fetchPage(after, PAGE_SIZE);
    if (page.error) return { data: null, error: page.error };
    const got = page.data ?? [];
    rows.push(...got);
    if (got.length < PAGE_SIZE) return { data: rows, error: null };
    after = got[got.length - 1].id;
  }
}

export async function readAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<Page<T>>): Promise<Page<T>> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await fetchPage(from, from + PAGE_SIZE - 1);
    if (page.error) return { data: null, error: page.error };
    const got = page.data ?? [];
    rows.push(...got);
    if (got.length < PAGE_SIZE) return { data: rows, error: null };
  }
}
