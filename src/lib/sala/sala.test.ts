import { describe, expect, it } from "vitest";
import {
  elapsedLabel,
  EXPIRY_MS,
  HIDDEN_POLL_MS,
  isUrgent,
  MAX_BACKOFF_MS,
  newCalls,
  nextPollDelay,
  pageTitle,
  parseSalaState,
  sortOldestFirst,
  URGENT_MS,
  VISIBLE_POLL_MS,
  waitingMs,
  type SalaCall,
} from "./types";

const call = (id: string, createdAt: string, tableLabel = "Mesa 1", kind: SalaCall["kind"] = "waiter"): SalaCall => ({
  id,
  kind,
  tableLabel,
  branchName: "Centro",
  createdAt,
});

describe("tiempo transcurrido", () => {
  it("formatea segundos, minutos y horas", () => {
    expect(elapsedLabel(0)).toBe("hace 0 s");
    expect(elapsedLabel(45_000)).toBe("hace 45 s");
    expect(elapsedLabel(59_999)).toBe("hace 59 s");
    expect(elapsedLabel(60_000)).toBe("hace 1 min");
    expect(elapsedLabel(125_000)).toBe("hace 2 min");
    expect(elapsedLabel(59 * 60_000 + 59_000)).toBe("hace 59 min");
    expect(elapsedLabel(60 * 60_000)).toBe("hace 1 h");
    expect(elapsedLabel(65 * 60_000)).toBe("hace 1 h 5 min");
    expect(elapsedLabel(-5_000)).toBe("hace 0 s");
  });

  it("la espera sale de la hora de referencia y nunca es negativa", () => {
    const c = call("a", "2026-10-14T12:00:00.000Z");
    expect(waitingMs(c, Date.parse("2026-10-14T12:02:00.000Z"))).toBe(120_000);
    expect(waitingMs(c, Date.parse("2026-10-14T11:59:00.000Z"))).toBe(0);
  });

  it("es urgente desde los 5 minutos (inclusive) y el vencimiento es de 30", () => {
    expect(isUrgent(URGENT_MS - 1)).toBe(false);
    expect(isUrgent(URGENT_MS)).toBe(true);
    expect(URGENT_MS).toBe(5 * 60_000);
    expect(EXPIRY_MS).toBe(30 * 60_000);
  });
});

describe("llamados nuevos y orden", () => {
  it("detecta solo los que no se habían visto", () => {
    const seen = new Set(["a", "b"]);
    const next = [call("a", "2026-10-14T12:00:00Z"), call("c", "2026-10-14T12:01:00Z"), call("d", "2026-10-14T12:02:00Z")];
    expect(newCalls(seen, next).map((c) => c.id)).toEqual(["c", "d"]);
    expect(newCalls(new Set(["a", "c", "d"]), next)).toEqual([]);
    expect(newCalls(seen, [])).toEqual([]);
  });

  it("ordena el más viejo primero y desempata por mesa en orden natural", () => {
    const calls = [
      call("1", "2026-10-14T12:05:00Z", "Mesa 3"),
      call("2", "2026-10-14T12:01:00Z", "Mesa 10"),
      call("3", "2026-10-14T12:01:00Z", "Mesa 2"),
    ];
    expect(sortOldestFirst(calls).map((c) => c.id)).toEqual(["3", "2", "1"]);
    // No modifica el arreglo recibido.
    expect(calls.map((c) => c.id)).toEqual(["1", "2", "3"]);
  });
});

describe("ritmo del sondeo", () => {
  it("3 s visible y 15 s oculta; tras errores se espacia hasta 15 s y vuelve al normal", () => {
    expect(nextPollDelay(true, 0)).toBe(VISIBLE_POLL_MS);
    expect(nextPollDelay(false, 0)).toBe(HIDDEN_POLL_MS);
    expect(nextPollDelay(true, 1)).toBe(6_000);
    expect(nextPollDelay(true, 2)).toBe(12_000);
    expect(nextPollDelay(true, 3)).toBe(MAX_BACKOFF_MS);
    expect(nextPollDelay(true, 50)).toBe(MAX_BACKOFF_MS);
    expect(nextPollDelay(false, 5)).toBe(MAX_BACKOFF_MS);
    expect(nextPollDelay(true, -1)).toBe(VISIBLE_POLL_MS);
  });
});

describe("título de la pestaña", () => {
  it("lleva la cantidad de pendientes", () => {
    expect(pageTitle(0)).toBe("Sala en vivo");
    expect(pageTitle(3)).toBe("(3) Sala en vivo");
  });
});

describe("lectura de la respuesta del servidor", () => {
  const valido = {
    serverNow: "2026-10-14T12:00:00.000Z",
    enabled: true,
    multiBranch: false,
    calls: [{ id: "x", kind: "bill", tableLabel: "Mesa 4", branchName: "Centro", createdAt: "2026-10-14T11:58:00.000Z" }],
  };

  it("lee una respuesta válida", () => {
    expect(parseSalaState(valido)).toEqual(valido);
    expect(parseSalaState({ ...valido, enabled: false, calls: [] })?.calls).toEqual([]);
  });

  it("cualquier forma inesperada es null (la pantalla lo trata como error y reintenta)", () => {
    for (const raro of [null, undefined, "x", 4, [], {}, { ...valido, serverNow: "ayer" }, { ...valido, enabled: "si" }, { ...valido, multiBranch: 1 }, { ...valido, calls: "no" }]) {
      expect(parseSalaState(raro), String(raro)).toBeNull();
    }
    const mal = (cambio: object) => ({ ...valido, calls: [{ ...valido.calls[0], ...cambio }] });
    for (const cambio of [{ kind: "otro" }, { id: 5 }, { tableLabel: null }, { branchName: undefined }, { createdAt: "no es fecha" }]) {
      expect(parseSalaState(mal(cambio)), JSON.stringify(cambio)).toBeNull();
    }
    // Un solo elemento malo invalida toda la lista (no se muestra a medias).
    expect(parseSalaState({ ...valido, calls: [valido.calls[0], { id: 1 }] })).toBeNull();
  });
});
