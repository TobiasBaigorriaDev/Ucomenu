import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Las acciones de servidor de los comentarios (ficha comentarios-del-feed): ticket de visita, texto normalizado, clave de conexión sin
 * la IP cruda, y qué mensaje ve el comensal. La base y los encabezados se simulan; lo que se prueba es lo que la acción decide antes y
 * después de llamar a la función.
 */

const rpc = vi.fn();
const range = vi.fn();
vi.mock("next/headers", () => ({ headers: async () => ({ get: (nombre: string) => ({ "x-forwarded-for": "203.0.113.9" })[nombre.toLowerCase()] ?? null }) }));
// La alta la hace el cliente de servicio (ADR 0038); la lectura de aprobados sigue siendo pública.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/supabase/public-client", () => ({
  createPublicClient: () => ({ rpc, from: () => ({ select: () => ({ eq: () => ({ order: () => ({ order: () => ({ range }) }) }) }) }) }),
}));

const { submitVideoCommentAction, loadVideoCommentsAction } = await import("@/app/t/[token]/videos/actions");
const { issueVisitTicket, VISIT_TTL_MS } = await import("@/lib/llamados/visit-ticket");

const TOKEN = "c0ffee01000000000000000000000000";
const OTRA_MESA = "c0ffee02000000000000000000000000";
const VIDEO = "1a1a1a1a-2b2b-4c3c-8d4d-5e5e5e5e5e5e";
const pedido = (cambios: Record<string, unknown> = {}) => ({ token: TOKEN, video: VIDEO, body: "Muy rico", alias: "Ana", ticket: issueVisitTicket(TOKEN), lang: "es", ...cambios });

beforeEach(() => {
  rpc.mockReset();
  range.mockReset();
  rpc.mockResolvedValue({ data: { status: "ok" }, error: null });
});

describe("submitVideoCommentAction", () => {
  it("con un ticket vigente manda el texto normalizado y una clave derivada (nunca la IP) y queda pendiente", async () => {
    expect(await submitVideoCommentAction(pedido({ body: "  Muy \n rico  ", alias: "  Ana " }))).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [nombre, args] = rpc.mock.calls[0];
    expect(nombre).toBe("submit_video_comment");
    expect(args).toMatchObject({ p_token: TOKEN, p_video: VIDEO, p_body: "Muy rico", p_alias: "Ana" });
    expect(args.p_rate).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(args)).not.toContain("203.0.113");
    expect(typeof args.p_visit_started_at).toBe("string");
  });

  it("sin alias no manda alias", async () => {
    await submitVideoCommentAction(pedido({ alias: "   " }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_alias");
  });

  it("sin ticket, con uno falso, de otra mesa o vencido: «sesión vencida» y no llega a la base", async () => {
    const vencido = issueVisitTicket(TOKEN, Date.now() - VISIT_TTL_MS - 1000);
    for (const ticket of [undefined, "", "basura", 5, issueVisitTicket(OTRA_MESA), vencido]) {
      const r = await submitVideoCommentAction(pedido({ ticket }));
      expect(r, String(ticket)).toMatchObject({ ok: false, expired: true });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("un token imposible, un texto vacío o demasiado largo no llegan a la base", async () => {
    for (const malo of [{ token: "x" }, { token: undefined }, { body: "" }, { body: "  \n " }, { body: undefined }, { body: "x".repeat(281) }, { alias: "y".repeat(31) }]) {
      const r = await submitVideoCommentAction(pedido(malo));
      expect(r.ok, JSON.stringify(malo)).toBe(false);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("cada resultado de la base tiene su mensaje, en el idioma del comensal", async () => {
    rpc.mockResolvedValueOnce({ data: { status: "session_closed" }, error: null });
    expect(await submitVideoCommentAction(pedido())).toMatchObject({ ok: false, expired: true });

    rpc.mockResolvedValueOnce({ data: { status: "rate_limited", retry_after_seconds: 130 }, error: null });
    const limitado = await submitVideoCommentAction(pedido({ lang: "en" }));
    expect(limitado.ok === false && limitado.message).toMatch(/3 minutes/);
    expect(limitado.ok === false && limitado.expired).toBeUndefined();

    rpc.mockResolvedValueOnce({ data: { status: "queue_full" }, error: null });
    const llena = await submitVideoCommentAction(pedido({ lang: "pt" }));
    expect(llena.ok === false && llena.message).toMatch(/comentários/);

    rpc.mockResolvedValueOnce({ data: { status: "invalid" }, error: null });
    expect(await submitVideoCommentAction(pedido())).toMatchObject({ ok: false });

    rpc.mockResolvedValueOnce({ data: { status: "unavailable" }, error: null });
    const no = await submitVideoCommentAction(pedido());
    expect(no.ok === false && no.message).toMatch(/No se pudo enviar/);

    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "caída" } });
    expect(await submitVideoCommentAction(pedido())).toMatchObject({ ok: false });
  });
});

describe("loadVideoCommentsAction", () => {
  it("devuelve la página de aprobados y si hay más", async () => {
    range.mockResolvedValueOnce({ data: [{ id: "a", alias: null, body: "hola", created_at: "2026-10-22T12:00:00+00:00" }], error: null });
    expect(await loadVideoCommentsAction({ video: VIDEO, offset: 0, lang: "es" })).toEqual({
      ok: true,
      comments: [{ id: "a", alias: null, body: "hola", created_at: "2026-10-22T12:00:00+00:00" }],
      hasMore: false,
    });
  });

  it("si la base falla, avisa en el idioma del comensal sin lanzar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    range.mockResolvedValueOnce({ data: null, error: { message: "caída" } });
    const r = await loadVideoCommentsAction({ video: VIDEO, offset: 0, lang: "en" });
    expect(r.ok === false && r.message).toMatch(/couldn't load/);
  });

  it("un video imposible no consulta nada", async () => {
    expect(await loadVideoCommentsAction({ video: "no-uuid", offset: 0, lang: "es" })).toEqual({ ok: true, comments: [], hasMore: false });
    expect(range).not.toHaveBeenCalled();
  });
});
