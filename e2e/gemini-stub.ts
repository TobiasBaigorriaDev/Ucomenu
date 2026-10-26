import { createServer, type IncomingMessage, type Server } from "node:http";

/**
 * Un Gemini de mentira para los E2E (ficha traduccion-automatica): el servidor de pruebas apunta a él con `GEMINI_API_URL` (la
 * app solo acepta una URL de la propia máquina), así ninguna prueba toca el servicio real ni gasta cuota. Responde a
 * `generateContent` traduciendo cada texto como «EN: …» o «PT: …» según el idioma pedido en las instrucciones. Exige la clave de
 * pruebas en `x-goog-api-key`. Lo levanta `e2e/global-setup.ts` una sola vez para toda la corrida.
 */

export const GEMINI_STUB_PORT = Number(process.env.GEMINI_STUB_PORT ?? 4011);
export const GEMINI_STUB_URL = `http://127.0.0.1:${GEMINI_STUB_PORT}`;
export const E2E_GEMINI_KEY = "e2e-gemini-key";

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function startGeminiStub(): Promise<{ close: () => Promise<void> }> {
  const server: Server = createServer(async (request, response) => {
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.method !== "POST" || !/^\/v1beta\/models\/[^/]+:generateContent$/.test(request.url ?? "")) return reply(404, {});
    if (request.headers["x-goog-api-key"] !== E2E_GEMINI_KEY) return reply(403, {});

    const body = JSON.parse(await readBody(request));
    const prefix = String(body.systemInstruction?.parts?.[0]?.text).includes("Portuguese") ? "PT" : "EN";
    const input = JSON.parse(body.contents[0].parts[0].text) as { key: string; text: string }[];
    const answer = input.map((item) => ({ key: item.key, text: `${prefix}: ${item.text}` }));
    reply(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(GEMINI_STUB_PORT, "127.0.0.1", () => {
      resolve({ close: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}
