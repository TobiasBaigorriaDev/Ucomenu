import { describe, expect, it, vi } from "vitest";
import { visitInTurn } from "./visit-turn";
import { conParametro, leerVisitaDeLaUrl, urlConVisita } from "./visita";
import { issueVisitTicket, VISIT_TTL_MS } from "./visit-ticket";

const SECRET = "secreto-de-prueba";
const TOKEN = "a".repeat(32);
const OTRO = "b".repeat(32);
const AHORA = Date.parse("2026-10-25T12:00:00Z");
const ticket = (token: string, nowMs: number) => issueVisitTicket(token, nowMs, SECRET);

// `verifyVisitTicket` usa el secreto del proceso: se fija el mismo para firmar y verificar.
process.env.WAITER_CALL_CLIENT_SECRET = SECRET;

describe("la visita en la URL", () => {
  it("sin `v` es un escaneo: se emite una visita nueva", () => {
    expect(leerVisitaDeLaUrl(TOKEN, undefined, AHORA)).toEqual({ kind: "nueva" });
  });

  it("un ticket propio y vigente se reutiliza, con lo que le queda de vida", () => {
    const t = ticket(TOKEN, AHORA - 10 * 60_000);
    const r = leerVisitaDeLaUrl(TOKEN, t, AHORA);
    expect(r).toMatchObject({ kind: "propia", ticket: t });
    if (r.kind === "propia") {
      expect(r.issuedAt.getTime()).toBe(Math.floor((AHORA - 10 * 60_000) / 1000) * 1000);
      expect(r.ttlMs).toBe(VISIT_TTL_MS - 10 * 60_000);
    }
  });

  it("recargar no renueva el plazo: pasadas 3 horas la visita es inválida", () => {
    const t = ticket(TOKEN, AHORA);
    expect(leerVisitaDeLaUrl(TOKEN, t, AHORA + VISIT_TTL_MS - 1000)).toMatchObject({ kind: "propia" });
    expect(leerVisitaDeLaUrl(TOKEN, t, AHORA + VISIT_TTL_MS + 1000)).toMatchObject({ kind: "invalida" });
  });

  it("de otra mesa, forjado, mal formado, vacío, repetido o del futuro: inválido, nunca una visita nueva", () => {
    const otro = ticket(OTRO, AHORA);
    const forjado = `${Math.floor(AHORA / 1000)}.${"0".repeat(32)}`;
    const futuro = ticket(TOKEN, AHORA + 60 * 60_000);
    for (const raw of [otro, forjado, "basura", "", futuro, ["a", "b"]]) {
      expect(leerVisitaDeLaUrl(TOKEN, raw, AHORA), JSON.stringify(raw)).toMatchObject({ kind: "invalida" });
    }
  });

  it("lo inválido conserva a lo sumo 64 caracteres para los enlaces", () => {
    expect(leerVisitaDeLaUrl(TOKEN, "x".repeat(500), AHORA)).toEqual({ kind: "invalida", raw: "x".repeat(64) });
  });
});

describe("armar las URLs", () => {
  it("conserva la query de la página (idioma) y pone la visita, reemplazando una anterior", () => {
    expect(urlConVisita("/t/abc", { lang: "en" }, "1.f")).toBe("/t/abc?lang=en&v=1.f");
    expect(urlConVisita("/t/abc", { v: "viejo", lang: "pt" }, "2.g")).toBe("/t/abc?lang=pt&v=2.g");
    expect(urlConVisita("/t/abc", {}, "1.f")).toBe("/t/abc?v=1.f");
    expect(urlConVisita("/t/abc", { lang: ["es", "en"] }, "1.f")).toBe("/t/abc?v=1.f");
  });

  it("agrega un parámetro con ? o & según corresponda y lo codifica", () => {
    expect(conParametro("/t/abc/videos", "lang", "es")).toBe("/t/abc/videos?lang=es");
    expect(conParametro("/t/abc/videos?v=1.f", "lang", "es")).toBe("/t/abc/videos?v=1.f&lang=es");
    expect(conParametro("/t/abc", "v", "a b&c")).toBe("/t/abc?v=a%20b%26c");
  });
});

describe("¿la visita sigue en el turno? (falla abierto)", () => {
  const llamar = (resultado: { data?: unknown; error?: { code?: string; message: string } | null } | Error) => {
    const rpc = vi.fn(async () => {
      if (resultado instanceof Error) throw resultado;
      return { data: resultado.data ?? null, error: resultado.error ?? null };
    });
    return { rpc, db: () => ({ rpc }) as never };
  };

  it("false de la base es visita terminada; true es vigente, y manda el ticket como fecha ISO", async () => {
    const a = llamar({ data: false });
    expect(await visitInTurn(a.db, TOKEN, new Date(AHORA))).toBe(false);
    expect(a.rpc).toHaveBeenCalledWith("visit_in_turn", { p_token: TOKEN, p_ticket_at: "2026-10-25T12:00:00.000Z" });
    expect(await visitInTurn(llamar({ data: true }).db, TOKEN, new Date(AHORA))).toBe(true);
  });

  it("si la base falla, responde raro o no hay clave de servicio, se ofrecen los botones (la acción vuelve a comprobar) y no se registra el token", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await visitInTurn(llamar({ error: { code: "XX000", message: "caída" } }).db, TOKEN, new Date(AHORA))).toBe(true);
    expect(await visitInTurn(llamar(new Error("sin red")).db, TOKEN, new Date(AHORA))).toBe(true);
    expect(await visitInTurn(llamar({ data: "raro" }).db, TOKEN, new Date(AHORA))).toBe(true);
    expect(
      await visitInTurn(
        () => {
          throw new Error("falta SUPABASE_SERVICE_ROLE_KEY");
        },
        TOKEN,
        new Date(AHORA),
      ),
    ).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    log.mockRestore();
  });
});
