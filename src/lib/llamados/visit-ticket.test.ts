import { describe, expect, it } from "vitest";
import { issueVisitTicket, verifyVisitTicket, VISIT_TTL_MS } from "./visit-ticket";

const TOKEN = "c0ffee01000000000000000000000000";
const OTRA = "c0ffee02000000000000000000000000";
const SECRETO = "secreto-de-prueba-del-ticket-123";
const T0 = Date.parse("2026-10-14T12:00:00.000Z");

describe("ticket de visita", () => {
  it("el plazo es de 3 horas", () => {
    expect(VISIT_TTL_MS).toBe(3 * 60 * 60 * 1000);
  });

  it("emite un ticket con la forma <segundos>.<32 hex>, determinista y atado al secreto y a la mesa", () => {
    const ticket = issueVisitTicket(TOKEN, T0, SECRETO);
    expect(ticket).toMatch(/^\d+\.[0-9a-f]{32}$/);
    expect(ticket.split(".")[0]).toBe(String(T0 / 1000));
    expect(issueVisitTicket(TOKEN, T0, SECRETO)).toBe(ticket);
    expect(issueVisitTicket(TOKEN, T0, "otro-secreto-de-prueba-largo")).not.toBe(ticket);
    expect(issueVisitTicket(OTRA, T0, SECRETO)).not.toBe(ticket);
  });

  it("un ticket vigente es válido y devuelve cuándo se emitió", () => {
    const ticket = issueVisitTicket(TOKEN, T0, SECRETO);
    for (const despues of [0, 1000, 60 * 60_000, VISIT_TTL_MS - 1000]) {
      const r = verifyVisitTicket(TOKEN, ticket, T0 + despues, SECRETO);
      expect(r.ok, String(despues)).toBe(true);
      if (r.ok) expect(r.issuedAt.getTime()).toBe(T0);
    }
  });

  it("vence al cumplirse el plazo (el borde ya no vale)", () => {
    const ticket = issueVisitTicket(TOKEN, T0, SECRETO);
    expect(verifyVisitTicket(TOKEN, ticket, T0 + VISIT_TTL_MS - 1, SECRETO).ok).toBe(true);
    expect(verifyVisitTicket(TOKEN, ticket, T0 + VISIT_TTL_MS, SECRETO)).toEqual({ ok: false, reason: "expired" });
    expect(verifyVisitTicket(TOKEN, ticket, T0 + 24 * 3600_000, SECRETO)).toEqual({ ok: false, reason: "expired" });
  });

  it("no sirve para otra mesa, con otro secreto ni con la hora retocada", () => {
    const ticket = issueVisitTicket(TOKEN, T0, SECRETO);
    expect(verifyVisitTicket(OTRA, ticket, T0, SECRETO)).toEqual({ ok: false, reason: "forged" });
    expect(verifyVisitTicket(TOKEN, ticket, T0, "otro-secreto-de-prueba-largo")).toEqual({ ok: false, reason: "forged" });
    const mac = ticket.split(".")[1];
    // Adelantar la hora de emisión para «renovarlo» invalida la firma.
    expect(verifyVisitTicket(TOKEN, `${T0 / 1000 + 3 * 3600}.${mac}`, T0 + 4 * 3600_000, SECRETO)).toEqual({ ok: false, reason: "forged" });
  });

  it("un ticket del futuro (más de 1 minuto) se rechaza; hasta 1 minuto se tolera", () => {
    const futuro = issueVisitTicket(TOKEN, T0 + 5 * 60_000, SECRETO);
    expect(verifyVisitTicket(TOKEN, futuro, T0, SECRETO)).toEqual({ ok: false, reason: "future" });
    const casi = issueVisitTicket(TOKEN, T0 + 30_000, SECRETO);
    expect(verifyVisitTicket(TOKEN, casi, T0, SECRETO).ok).toBe(true);
  });

  it("falla cerrado ante cualquier valor raro", () => {
    for (const ausente of [undefined, null, ""]) {
      expect(verifyVisitTicket(TOKEN, ausente, T0, SECRETO), String(ausente)).toEqual({ ok: false, reason: "missing" });
    }
    const mac = "a".repeat(32);
    const raros = [5, {}, [], true, "x", "123", "123.", ".abc", "abc.def", `${T0 / 1000}.${"g".repeat(32)}`, `${T0 / 1000}.${"a".repeat(31)}`, `-1.${mac}`, `1e9.${mac}`, `${"9".repeat(13)}.${mac}`, ` 1.${mac}`];
    for (const raro of raros) {
      expect(verifyVisitTicket(TOKEN, raro, T0, SECRETO).ok, String(raro)).toBe(false);
    }
  });
});
