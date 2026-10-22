import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * Un Mux de mentira para los E2E (ficha videos-mux-parte-b): el servidor de pruebas apunta a él con `MUX_API_URL` (la app solo
 * acepta una URL de la propia máquina), así ninguna prueba toca el Mux real ni gasta assets de la cuenta. Implementa lo que usa
 * el cliente —crear una subida, recibir el `PUT` del archivo, cancelarla y borrar un asset— y anota cada llamada. Las pruebas lo
 * consultan por `/__calls`. Sin estado compartido entre pruebas (corren en paralelo): una subida de EXACTAMENTE `FAIL_PUT_BYTES`
 * bytes falla (la conexión se corta), y un asset cuyo id empieza con `fail-` hace fallar su borrado (Mux caído, para probar el
 * reintento).
 *
 * Lo levanta `e2e/global-setup.ts` una sola vez para toda la corrida.
 */

export const MUX_STUB_PORT = Number(process.env.MUX_STUB_PORT ?? 4010);
export const MUX_STUB_URL = `http://127.0.0.1:${MUX_STUB_PORT}`;
/** Una subida de este tamaño exacto hace fallar el `PUT` del archivo. */
export const FAIL_PUT_BYTES = 4242;

/** Credenciales de pruebas: el servidor de E2E las usa en lugar de las reales de `.env.local`. */
export const E2E_MUX = {
  tokenId: "e2e-mux-id",
  tokenSecret: "e2e-mux-secret",
  webhookSecret: "e2e-webhook-secret-0123456789",
} as const;

export type StubCall = { method: string; path: string; body?: unknown; bytes?: number; id?: string };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PUT, POST, DELETE, GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function send(response: ServerResponse, status: number, body?: unknown) {
  response.writeHead(status, { ...CORS, ...(body === undefined ? {} : { "Content-Type": "application/json" }) });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export function startMuxStub(): Promise<{ close: () => Promise<void> }> {
  const calls: StubCall[] = [];
  let counter = 0;
  const expectedAuth = `Basic ${Buffer.from(`${E2E_MUX.tokenId}:${E2E_MUX.tokenSecret}`).toString("base64")}`;

  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", MUX_STUB_URL);
    const path = url.pathname;
    const method = request.method ?? "GET";

    if (method === "OPTIONS") return send(response, 204);

    // Control para las pruebas.
    if (path === "/__calls") return send(response, 200, calls);

    // El archivo que sube el navegador a la URL firmada (sin credenciales: la firma va en la URL).
    const upload = /^\/upload\/([^/]+)$/.exec(path);
    if (upload && method === "PUT") {
      const bytes = (await readBody(request)).length;
      calls.push({ method, path, id: upload[1], bytes });
      if (bytes === FAIL_PUT_BYTES) return send(response, 500, { error: "falla pedida" });
      return send(response, 200);
    }

    // La API de Mux exige las credenciales.
    if (request.headers.authorization !== expectedAuth) {
      calls.push({ method, path, body: "sin credenciales válidas" });
      return send(response, 401, { error: { messages: ["Unauthorized"] } });
    }

    if (path === "/video/v1/uploads" && method === "POST") {
      const body: unknown = JSON.parse((await readBody(request)).toString("utf8") || "{}");
      counter += 1;
      const id = `up-stub-${counter}-${Math.random().toString(36).slice(2, 8)}`;
      calls.push({ method, path, body, id });
      const settings = (body as { new_asset_settings?: unknown; cors_origin?: unknown }) ?? {};
      return send(response, 201, {
        data: { id, url: `${MUX_STUB_URL}/upload/${id}`, status: "waiting", timeout: 3600, cors_origin: settings.cors_origin, new_asset_settings: settings.new_asset_settings },
      });
    }

    const cancel = /^\/video\/v1\/uploads\/([^/]+)\/cancel$/.exec(path);
    if (cancel && method === "PUT") {
      calls.push({ method, path, id: decodeURIComponent(cancel[1]) });
      return send(response, 200, { data: { id: cancel[1], status: "cancelled" } });
    }

    const asset = /^\/video\/v1\/assets\/([^/]+)$/.exec(path);
    if (asset && method === "DELETE") {
      const id = decodeURIComponent(asset[1]);
      calls.push({ method, path, id });
      return id.startsWith("fail-") ? send(response, 500, { error: "Mux caído" }) : send(response, 204);
    }

    calls.push({ method, path, body: "ruta desconocida" });
    return send(response, 404, { error: "no existe" });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(MUX_STUB_PORT, "127.0.0.1", () => {
      resolve({ close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

// ---------------------------------------------------------------------------
// Para las pruebas: consultar y controlar el servidor de mentira desde el proceso de la prueba.
// ---------------------------------------------------------------------------

export async function stubCalls(): Promise<StubCall[]> {
  return (await (await fetch(`${MUX_STUB_URL}/__calls`)).json()) as StubCall[];
}
