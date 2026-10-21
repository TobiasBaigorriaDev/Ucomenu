import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cadena REAL guard → endpoint de la sala (ficha acceso-del-personal / sala): no se simula el guard. Se construye el cliente
 * de Supabase de verdad (@supabase/ssr + auth-js) con una sesión en la cookie y se simula solo la RED (`fetch`): lo que el
 * SDK devuelve ante un Auth caído, lento o que rechaza el token es lo que decide el código de estado.
 *
 * Invariante: un error recuperable de Auth (red, 5xx, gateway, 429) es 503 y no toca la sesión; solo la falta de sesión o
 * un rechazo explícito de Auth (4xx) es 401. Se prueban las dos puertas: el `proxy` (primer guard del pedido) y la ruta.
 */

vi.mock("server-only", () => ({}));

const URL_SUPABASE = "https://abcdefgh.supabase.co";
const CLAVE = "sb_publishable_prueba";
process.env.NEXT_PUBLIC_SUPABASE_URL = URL_SUPABASE;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = CLAVE;

const base64url = (texto: string) => Buffer.from(texto).toString("base64url");
const jwt = (exp: number) =>
  `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({ sub: "u1", role: "authenticated", aud: "authenticated", exp }),
  )}.${base64url("f".repeat(32))}`;

const ahora = Math.floor(Date.now() / 1000);
const usuario = { id: "u1", aud: "authenticated", role: "authenticated", email: "mozo@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const sesion = {
  access_token: jwt(ahora + 3600),
  refresh_token: "refresco",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: ahora + 3600,
  user: usuario,
};
const COOKIE = { name: "sb-abcdefgh-auth-token", value: `base64-${base64url(JSON.stringify(sesion))}` };

/** Qué responde Auth a `GET /auth/v1/user`. */
type Auth = "ok" | "red" | "503" | "500" | "502-html" | "429" | "401-jwt" | "403-sin-sesion";

let auth: Auth;
let pedidosAAuth: number;
const escrituraDeCookies = vi.fn();

const json = (cuerpo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json", ...extra } });

function responderAuth(): Response {
  pedidosAAuth++;
  switch (auth) {
    case "ok":
      return json(usuario);
    case "red":
      throw new TypeError("fetch failed");
    case "503":
      return json({ msg: "Service Unavailable" }, 503);
    case "500":
      return json({ msg: "Internal error" }, 500);
    case "502-html":
      return new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } });
    case "429":
      return json({ code: 429, error_code: "over_request_rate_limit", msg: "rate limit" }, 429);
    case "401-jwt":
      return json({ code: 401, error_code: "bad_jwt", msg: "invalid JWT: unable to parse or verify signature" }, 401);
    case "403-sin-sesion":
      return json({ code: 403, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" }, 403);
  }
}

const miembro = { role: "staff", organization_id: "org-1" };
const org = { id: "org-1", slug: "cafe", name: "Café", menu_palette: "calida", logo_path: null };

const fetchSimulado = vi.fn(async (entrada: RequestInfo | URL) => {
  const url = new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
  if (url.pathname === "/auth/v1/user") return responderAuth();
  if (url.pathname === "/rest/v1/memberships") return json([miembro]);
  if (url.pathname === "/rest/v1/organizations") return json([org]);
  return json({ msg: `no simulado: ${url.pathname}` }, 404);
});

const loadSala = vi.fn();
vi.mock("@/lib/sala/pending", () => ({ loadSala }));

// El cliente de sesión del servidor, construido igual que el real pero con la cookie del pedido (sin next/headers).
let cookies: { name: string; value: string }[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createSessionClient: async () =>
    createServerClient(URL_SUPABASE, CLAVE, { cookies: { getAll: () => cookies, setAll: escrituraDeCookies } }),
}));

const { GET } = await import("@/app/sala/[org]/estado/route");
const { proxy } = await import("@/proxy");

const rutaEstado = () =>
  GET(new Request("http://localhost/sala/cafe/estado"), { params: Promise.resolve({ org: "cafe" }) } as never);

const proxyEstado = () => {
  const cabecera = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  return proxy(new NextRequest("http://localhost/sala/cafe/estado", { headers: cabecera ? { cookie: cabecera } : {} }));
};

beforeEach(() => {
  auth = "ok";
  pedidosAAuth = 0;
  cookies = [COOKIE];
  vi.stubGlobal("fetch", fetchSimulado);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  loadSala.mockResolvedValue({ serverNow: "2026-01-01T00:00:00.000Z", enabled: true, multiBranch: false, calls: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const RECUPERABLES: Auth[] = ["red", "503", "500", "502-html", "429"];
const RECHAZOS: Auth[] = ["401-jwt", "403-sin-sesion"];

describe("ruta /sala/{slug}/estado con el error real del SDK", () => {
  it.each(RECUPERABLES)("Auth con fallo recuperable (%s): 503 y la sesión no se toca", async (falla) => {
    auth = falla;

    const res = await rutaEstado();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(escrituraDeCookies).not.toHaveBeenCalled();
    expect(loadSala).not.toHaveBeenCalled();
  });

  it.each(RECHAZOS)("Auth rechaza la sesión (%s): 401", async (rechazo) => {
    auth = rechazo;
    const res = await rutaEstado();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "no_session" });
  });

  it("sin cookie de sesión: 401, sin llamar a Auth", async () => {
    cookies = [];
    const res = await rutaEstado();
    expect(res.status).toBe(401);
    expect(pedidosAAuth).toBe(0);
  });

  it("los reintentos siguen: tras un 503, cuando Auth vuelve la misma sesión recibe el estado", async () => {
    auth = "503";
    expect((await rutaEstado()).status).toBe(503);
    expect((await rutaEstado()).status).toBe(503);

    auth = "ok";
    const res = await rutaEstado();

    expect(res.status).toBe(200);
    expect(loadSala).toHaveBeenCalledTimes(1);
  });

  it("con Auth sano un miembro recibe el estado y quien no es miembro, el 404", async () => {
    expect((await rutaEstado()).status).toBe(200);
    const ajeno = await GET(new Request("http://localhost/sala/otro/estado"), { params: Promise.resolve({ org: "otro" }) } as never);
    expect(ajeno.status).toBe(404);
  });
});

describe("proxy delante de /sala/{slug}/estado con el error real del SDK", () => {
  it.each(RECUPERABLES)("Auth con fallo recuperable (%s): 503, no 401 ni redirección", async (falla) => {
    auth = falla;

    const res = await proxyEstado();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it.each(RECHAZOS)("Auth rechaza la sesión (%s): 401", async (rechazo) => {
    auth = rechazo;
    const res = await proxyEstado();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "no_session" });
  });

  it("sin cookie: 401; con Auth sano deja pasar el pedido", async () => {
    cookies = [];
    expect((await proxyEstado()).status).toBe(401);

    cookies = [COOKIE];
    const res = await proxyEstado();
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
