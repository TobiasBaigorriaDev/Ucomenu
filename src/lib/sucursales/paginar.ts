/**
 * PostgREST corta cada lectura en `max_rows` (1000 en `supabase/config.toml`) SIN avisar: quien lee "todo" de una tabla
 * grande recibe la primera página y calcula con eso. Pide página por página hasta que una llega incompleta.
 */
export const PAGE_SIZE = 1000;

type Page<T> = { data: T[] | null; error: { message: string } | null };

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
