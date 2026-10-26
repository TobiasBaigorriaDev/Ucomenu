import { describe, expect, it } from "vitest";
import {
  announceableCalls,
  callName,
  durationLabel,
  elapsedLabel,
  EXPIRY_MS,
  HIDDEN_POLL_MS,
  isStaleVisit,
  isUrgent,
  MAX_BACKOFF_MS,
  newCalls,
  newCallsAnnouncement,
  nextPollDelay,
  pageTitle,
  parseSalaState,
  sortOldestFirst,
  STALE_VISIT_MS,
  URGENT_MS,
  VISIBLE_POLL_MS,
  visitAgeMs,
  waitingMs,
  type SalaCall,
} from "./types";

const call = (id: string, createdAt: string, tableLabel = "Mesa 1", kind: SalaCall["kind"] = "waiter"): SalaCall => ({
  id,
  kind,
  tableLabel,
  branchName: "Centro",
  createdAt,
  visitStartedAt: null,
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
    expect(pageTitle(0)).toBe("Mesas");
    expect(pageTitle(3)).toBe("(3) Mesas");
  });
});

describe("lectura de la respuesta del servidor", () => {
  const valido = {
    serverNow: "2026-10-14T12:00:00.000Z",
    enabled: true,
    multiBranch: false,
    branches: [{ id: "b1", name: "Centro" }],
    view: [] as string[],
    othersPending: 0,
    calls: [{ id: "x", kind: "bill", tableLabel: "Mesa 4", branchName: "Centro", createdAt: "2026-10-14T11:58:00.000Z", visitStartedAt: "2026-10-14T11:20:00.000Z" }],
  };

  it("lee una respuesta válida", () => {
    expect(parseSalaState(valido)).toEqual(valido);
    expect(parseSalaState({ ...valido, enabled: false, calls: [] })?.calls).toEqual([]);
  });

  it("lee la vista por sucursal: sucursales, las que mira la persona y cuántos llamados quedan en las otras", () => {
    const conVista = { ...valido, multiBranch: true, branches: [{ id: "b1", name: "Centro" }, { id: "b2", name: "Norte" }], view: ["b2"], othersPending: 3 };
    expect(parseSalaState(conVista)).toEqual(conVista);
  });

  it("el escaneo es opcional: sin la clave, nulo o ilegible se lee como «no se sabe» y no invalida la respuesta", () => {
    const sinClave = { ...valido, calls: [{ id: "x", kind: "bill", tableLabel: "Mesa 4", branchName: "Centro", createdAt: "2026-10-14T11:58:00.000Z" }] };
    expect(parseSalaState(sinClave)?.calls[0].visitStartedAt).toBeNull();
    for (const visitStartedAt of [null, "ayer", 5, {}]) {
      expect(parseSalaState({ ...valido, calls: [{ ...valido.calls[0], visitStartedAt }] })?.calls[0].visitStartedAt, String(visitStartedAt)).toBeNull();
    }
  });

  it("cualquier forma inesperada es null (la pantalla lo trata como error y reintenta)", () => {
    for (const raro of [null, undefined, "x", 4, [], {}, { ...valido, serverNow: "ayer" }, { ...valido, enabled: "si" }, { ...valido, multiBranch: 1 }, { ...valido, calls: "no" },
      { ...valido, branches: "no" }, { ...valido, branches: [{ id: 1, name: "x" }] }, { ...valido, view: [1] }, { ...valido, view: "b1" },
      { ...valido, othersPending: -1 }, { ...valido, othersPending: 1.5 }, { ...valido, othersPending: "2" }, { ...valido, othersPending: undefined }]) {
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

describe("antigüedad del escaneo (ticket de visita)", () => {
  const con = (createdAt: string, visitStartedAt: string | null) => ({ createdAt, visitStartedAt });

  it("es la diferencia entre el aviso y el escaneo; sin dato es null; nunca negativa", () => {
    expect(visitAgeMs(con("2026-10-14T12:00:00.000Z", "2026-10-14T11:20:00.000Z"))).toBe(40 * 60_000);
    expect(visitAgeMs(con("2026-10-14T12:00:00.000Z", null))).toBeNull();
    expect(visitAgeMs(con("2026-10-14T12:00:00.000Z", "2026-10-14T12:00:30.000Z"))).toBe(0);
  });

  it("desde 2 horas se considera vieja (el borde cuenta)", () => {
    expect(STALE_VISIT_MS).toBe(2 * 60 * 60 * 1000);
    expect(isStaleVisit(STALE_VISIT_MS - 1)).toBe(false);
    expect(isStaleVisit(STALE_VISIT_MS)).toBe(true);
  });

  it("la duración se escribe sin «hace»", () => {
    expect(durationLabel(45_000)).toBe("45 s");
    expect(durationLabel(120_000)).toBe("2 min");
    expect(durationLabel(2 * 3600_000 + 40 * 60_000)).toBe("2 h 40 min");
    expect(durationLabel(3 * 3600_000)).toBe("3 h");
    expect(elapsedLabel(65 * 60_000)).toBe("hace 1 h 5 min");
  });
});

describe("anuncios con varias sucursales", () => {
  const norte = { ...call("n", "2026-01-01T00:00:00Z", "Mesa 1"), branchName: "Norte" };
  const centro = { ...call("c", "2026-01-01T00:00:01Z", "Mesa 1", "bill"), branchName: "Centro" };

  it("la mesa se nombra con su sucursal solo si el local tiene varias: «Mesa 1» puede existir en cada una", () => {
    expect(callName(norte, true)).toBe("Mesa 1, sucursal Norte");
    expect(callName(centro, true)).toBe("Mesa 1, sucursal Centro");
    expect(callName(norte, false)).toBe("Mesa 1");
  });

  it("un llamado nuevo se anuncia completo; varios, por cantidad; ninguno, nada", () => {
    expect(newCallsAnnouncement([norte], true)).toBe("Nuevo llamado: Mesa 1, sucursal Norte, llama al mozo.");
    expect(newCallsAnnouncement([centro], true)).toBe("Nuevo llamado: Mesa 1, sucursal Centro, pide la cuenta.");
    expect(newCallsAnnouncement([norte], false)).toBe("Nuevo llamado: Mesa 1, llama al mozo.");
    expect(newCallsAnnouncement([norte, centro], true)).toBe("2 llamados nuevos.");
    expect(newCallsAnnouncement([], true)).toBe("");
  });
});

describe("qué anuncia una respuesta cuando cambia la vista por sucursal", () => {
  const at = (segundos: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, segundos)).toISOString();
  const norte = call("norte", at(5), "Mesa 1");
  const centro = call("centro", at(12.5), "Mesa 1");
  const ms = (segundos: number) => Date.parse(at(segundos));

  it("sin cambio de vista, anuncia lo que la pantalla no había visto", () => {
    expect(announceableCalls(new Set(["norte"]), [norte, centro], false, ms(10)).map((c) => c.id)).toEqual(["centro"]);
    expect(announceableCalls(new Set(["norte", "centro"]), [norte, centro], false, ms(10))).toEqual([]);
  });

  it("con cambio de vista, lo que la pantalla ya había recibido (y la vista anterior ocultaba) es base: no se anuncia", () => {
    // Mirando Norte, la pantalla ya había recibido el llamado de Centro de las 12:00:02 (última actualización a las 12:00:10).
    const viejo = call("viejo", at(2), "Mesa 3");
    expect(announceableCalls(new Set(["norte"]), [norte, viejo], true, ms(10))).toEqual([]);
  });

  it("con cambio de vista, un llamado creado DESPUÉS de la última actualización nunca se mostró y sí se anuncia, aunque lo oculte la vista anterior", () => {
    expect(announceableCalls(new Set(["norte"]), [norte, centro], true, ms(10)).map((c) => c.id)).toEqual(["centro"]);
  });

  it("no depende del reloj del dispositivo ni del momento del toque: dos cambios seguidos se resuelven cada uno con la actualización anterior", () => {
    // Respuesta intermedia (vista Norte, a las 12:00:11) y final (vista «Todas», a las 12:00:13) con un llamado de Centro a las 12:00:12,5.
    const intermedia = announceableCalls(new Set(["norte"]), [norte], true, ms(10));
    expect(intermedia).toEqual([]);
    const final = announceableCalls(new Set(["norte"]), [norte, centro], true, ms(11));
    expect(final.map((c) => c.id)).toEqual(["centro"]); // la respuesta intermedia no se «come» el llamado nuevo
  });
});
