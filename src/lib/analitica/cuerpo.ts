/**
 * Lee el cuerpo de un pedido SIN pasar de un tope de bytes (ficha analitica-basica, ADR 0022). `request.text()` acumula todo
 * antes de que se pueda mirar el tamaño: en una ruta pública, un pedido anónimo enorme (o que nunca termina) se quedaría con
 * la memoria del servidor. Acá se rechaza por el encabezado `content-length` si ya declara de más y, si no lo declara
 * (transferencia por partes) o miente, se corta la lectura apenas se supera el tope.
 * Devuelve `null` si el cuerpo es más grande que `maxBytes` (o ilegible).
 */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const joined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}
