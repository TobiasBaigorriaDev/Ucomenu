import { beforeEach, describe, expect, it, vi } from "vitest";

// La ruta del sondeo con sus dependencias simuladas: sin base ni red. Lo que importa es que NINGUNA falla de
// infraestructura termine en un 500 del framework (sin JSON ni no-store): se traduce a 503.

const getCurrentUser = vi.fn();
const getMemberships = vi.fn();
const loadSala = vi.fn();
const createSessionClient = vi.fn();

vi.mock("@/lib/auth/session", () => ({ getCurrentUser, getMemberships }));
vi.mock("@/lib/sala/pending", () => ({ loadSala }));
vi.mock("@/lib/supabase/server", () => ({ createSessionClient }));

const { GET } = await import("@/app/sala/[org]/estado/route");

const pedir = (org = "cafe") =>
  GET(new Request(`http://localhost/sala/${org}/estado`), { params: Promise.resolve({ org }) } as never);

const miembro = { org: { id: "org-1", slug: "cafe" }, role: "staff" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  createSessionClient.mockResolvedValue({});
});

async function esperar(res: Response, status: number, error?: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("content-type")).toContain("application/json");
  if (error) expect(await res.json()).toEqual({ error });
}

describe("GET /sala/{slug}/estado", () => {
  it("sin sesión: 401", async () => {
    getCurrentUser.mockResolvedValue(null);
    await esperar(await pedir(), 401, "no_session");
  });

  it("no miembro o local inexistente: el mismo 404", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    getMemberships.mockResolvedValue([miembro]);
    const otro = await pedir("otro-local");
    await esperar(otro, 404, "not_found");
    getMemberships.mockResolvedValue([]);
    await esperar(await pedir(), 404, "not_found");
  });

  it("un miembro recibe el estado", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    getMemberships.mockResolvedValue([miembro]);
    loadSala.mockResolvedValue({ serverNow: "2026-01-01T00:00:00.000Z", enabled: true, multiBranch: false, calls: [] });
    await esperar(await pedir(), 200);
  });

  it("falla al leer las membresías (base caída con Auth en pie): 503 con JSON, no un 500", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    getMemberships.mockRejectedValue(new Error("No se pudieron leer las membresías: connection refused"));
    await esperar(await pedir(), 503, "unavailable");
  });

  it("falla al leer la identidad o el estado: 503 con JSON", async () => {
    getCurrentUser.mockRejectedValue(new Error("red"));
    await esperar(await pedir(), 503, "unavailable");
    getCurrentUser.mockResolvedValue({ id: "u1" });
    getMemberships.mockResolvedValue([miembro]);
    loadSala.mockRejectedValue(new Error("base caída"));
    await esperar(await pedir(), 503, "unavailable");
  });
});
