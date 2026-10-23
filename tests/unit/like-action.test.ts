import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La acción de servidor de los likes (ficha likes-del-feed): ticket de visita, claves sin valores crudos, y qué mensaje ve el comensal.
 * La base y los encabezados se simulan; lo que se prueba es lo que la acción decide antes y después de llamar a la función.
 */

const rpc = vi.fn();
vi.mock("next/headers", () => ({ headers: async () => ({ get: (nombre: string) => ({ "x-forwarded-for": "203.0.113.9" })[nombre.toLowerCase()] ?? null }) }));
vi.mock("@/lib/supabase/public-client", () => ({ createPublicClient: () => ({ rpc }) }));

const { setVideoLikeAction } = await import("@/app/t/[token]/videos/actions");
const { issueVisitTicket, VISIT_TTL_MS } = await import("@/lib/llamados/visit-ticket");

const TOKEN = "c0ffee01000000000000000000000000";
const OTRA_MESA = "c0ffee02000000000000000000000000";
const VIDEO = "1a1a1a1a-2b2b-4c3c-8d4d-5e5e5e5e5e5e";
const CODIGO = "0123456789abcdef0123456789abcdef";
const pedido = (cambios: Record<string, unknown> = {}) => ({ token: TOKEN, video: VIDEO, liked: true, device: CODIGO, ticket: issueVisitTicket(TOKEN), lang: "es", ...cambios });

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { status: "ok", liked: true, count: 3 }, error: null });
});

describe("setVideoLikeAction", () => {
  it("con un ticket vigente llama a la base con claves derivadas (nunca el código ni la IP) y devuelve el conteo", async () => {
    expect(await setVideoLikeAction(pedido())).toEqual({ ok: true, liked: true, count: 3 });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [nombre, args] = rpc.mock.calls[0];
    expect(nombre).toBe("set_video_like");
    expect(args).toMatchObject({ p_token: TOKEN, p_video: VIDEO, p_liked: true });
    expect(args.p_device).toMatch(/^[0-9a-f]{32}$/);
    expect(args.p_rate).toMatch(/^[0-9a-f]{32}$/);
    expect(args.p_device).not.toBe(CODIGO);
    expect(JSON.stringify(args)).not.toContain("203.0.113");
    expect(typeof args.p_visit_started_at).toBe("string");
  });

  it("sin ticket, con uno falso, de otra mesa o vencido: «sesión vencida» y no llega a la base", async () => {
    const vencido = issueVisitTicket(TOKEN, Date.now() - VISIT_TTL_MS - 1000);
    for (const ticket of [undefined, "", "basura", 5, issueVisitTicket(OTRA_MESA), vencido]) {
      const r = await setVideoLikeAction(pedido({ ticket }));
      expect(r, String(ticket)).toMatchObject({ ok: false, expired: true });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("un token, una intención o un código imposibles no llegan a la base", async () => {
    for (const malo of [{ token: "x" }, { token: undefined }, { liked: "si" }, { liked: undefined }, { device: "corto" }, { device: undefined }, { video: "no-uuid" }]) {
      const r = await setVideoLikeAction(pedido(malo));
      expect(r.ok, JSON.stringify(malo)).toBe(false);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("cada resultado de la base tiene su mensaje, en el idioma del comensal", async () => {
    rpc.mockResolvedValueOnce({ data: { status: "session_closed" }, error: null });
    expect(await setVideoLikeAction(pedido())).toMatchObject({ ok: false, expired: true });

    rpc.mockResolvedValueOnce({ data: { status: "rate_limited", retry_after_seconds: 130 }, error: null });
    const limitado = await setVideoLikeAction(pedido({ lang: "en" }));
    expect(limitado).toMatchObject({ ok: false });
    expect(limitado.ok === false && limitado.message).toMatch(/3 minutes/);
    expect(limitado.ok === false && limitado.expired).toBeUndefined();

    rpc.mockResolvedValueOnce({ data: { status: "unavailable" }, error: null });
    const no = await setVideoLikeAction(pedido({ lang: "pt" }));
    expect(no).toMatchObject({ ok: false });
    expect(no.ok === false && no.message).toMatch(/curtida/);

    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "caída" } });
    expect(await setVideoLikeAction(pedido())).toMatchObject({ ok: false });
  });

  it("quitar el like manda la intención contraria", async () => {
    rpc.mockResolvedValueOnce({ data: { status: "ok", liked: false, count: 2 }, error: null });
    expect(await setVideoLikeAction(pedido({ liked: false }))).toEqual({ ok: true, liked: false, count: 2 });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_liked: false });
  });
});
