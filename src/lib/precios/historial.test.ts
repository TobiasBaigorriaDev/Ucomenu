import { describe, expect, it } from "vitest";
import {
  authorLabel,
  describeChange,
  encodeCursor,
  formatWhen,
  parseCursor,
  TECHNICAL_AUTHOR,
  type AuthorLookup,
} from "./historial";

const ID = "16000000-0000-4000-8000-000000000001";
const OTRA = "a0000000-0000-4000-8000-000000000002";
const YO = "a0000000-0000-4000-8000-000000000001";
// Intl usa espacio duro entre el símbolo y el número: se normaliza para comparar.
const plain = <T extends { transition: string; difference: string }>(c: T): T => ({ ...c, transition: c.transition.replace(/\s/g, " "), difference: c.difference.replace(/\s/g, " ") });
const ROLES = { owner: "Dueño", staff: "Personal", cook: "Cocina" } as const;

describe("cursor de paginación", () => {
  it("ida y vuelta, con microsegundos y con desfase", () => {
    const cursor = encodeCursor({ changedAt: "2026-10-14T16:00:00.123456+00:00", id: ID });
    expect(parseCursor(cursor)).toEqual({ changedAt: "2026-10-14T16:00:00.123456+00:00", id: ID });
    expect(parseCursor(`2026-10-14T16:00:00Z|${ID}`)).toEqual({ changedAt: "2026-10-14T16:00:00Z", id: ID });
    // Bisiesto y bordes válidos.
    expect(parseCursor(`2028-02-29T23:59:59.999999-03:00|${ID}`)).not.toBeNull();
    expect(parseCursor(`2026-12-31T00:00:00+15:59|${ID}`)).not.toBeNull();
    expect(parseCursor(`2026-12-31T00:00:00-15:59|${ID}`)).not.toBeNull();
  });

  it.each([
    undefined,
    null,
    "",
    ["a", "b"],
    "no-es-un-cursor",
    `2026-10-14|${ID}`,
    `2026-10-14T16:00:00.123456+00:00|no-es-uuid`,
    `2026-10-14T16:00:00+00:00|${ID}|extra`,
    // Formato correcto pero instante imposible (la base lo rechazaría y la página mostraría un error).
    `2026-02-30T10:00:00+00:00|${ID}`,
    `2026-13-01T10:00:00+00:00|${ID}`,
    `2026-00-10T10:00:00+00:00|${ID}`,
    `2026-10-32T10:00:00+00:00|${ID}`,
    `2026-10-14T24:00:00+00:00|${ID}`,
    `2026-10-14T25:00:00+00:00|${ID}`,
    `2026-10-14T10:60:00+00:00|${ID}`,
    `2026-10-14T10:00:60+00:00|${ID}`,
    `2026-10-14T10:00:00+99:99|${ID}`,
    // PostgreSQL admite desfases de hasta ±15:59.
    `2026-10-14T10:00:00+16:00|${ID}`,
    `2026-10-14T10:00:00-16:00|${ID}`,
    `2026-10-14T10:00:00+23:59|${ID}`,
    `2026-10-14T10:00:00-24:00|${ID}`,
    `2025-02-29T10:00:00Z|${ID}`,
    // Intentos de colarse en la expresión or(...) de PostgREST.
    `2026-10-14T16:00:00+00:00),organization_id.neq.x,and(a.eq.1|${ID}`,
    `2026-10-14T16:00:00+00:00,id.gt.0|${ID}`,
    `2026-10-14T16:00:00+00:00|${ID},id.gt.0`,
  ])("descarta lo que no es exactamente «instante|uuid»: %j", (raw) => {
    expect(parseCursor(raw)).toBeNull();
  });
});

describe("describeChange", () => {
  it("sube y baja, con la diferencia en palabras", () => {
    expect(plain(describeChange(270000, 280000))).toEqual({ direction: "up", transition: "$ 2.700 → $ 2.800", difference: "Sube $ 100" });
    expect(plain(describeChange(280000, 270050))).toMatchObject({ direction: "down", difference: "Baja $ 99,50" });
  });

  it("de 0 a un precio y de un precio a 0", () => {
    expect(plain(describeChange(0, 150000))).toMatchObject({ direction: "up", transition: "$ 0 → $ 1.500" });
    expect(plain(describeChange(150000, 0))).toMatchObject({ direction: "down", difference: "Baja $ 1.500" });
  });
});

describe("formatWhen", () => {
  it("usa la hora de Argentina (UTC-3), no la del servidor", () => {
    // 02:30 UTC del 15 es 23:30 del 14 en Buenos Aires.
    expect(formatWhen("2026-10-15T02:30:00+00:00")).toMatch(/14.*23:30/);
  });
  it("un valor ilegible se muestra tal cual en vez de romper la página", () => {
    expect(formatWhen("basura")).toBe("basura");
  });
});

describe("authorLabel", () => {
  const members: AuthorLookup = {
    status: "ok",
    members: new Map([[OTRA, { email: "mozo@cafe-ejemplo.test", role: "staff" as const }]]),
  };

  it("sin usuario: operación técnica, para cualquier rol", () => {
    for (const role of ["owner", "staff"] as const) {
      expect(authorLabel(null, { id: YO, role }, members, ROLES)).toBe(TECHNICAL_AUTHOR);
    }
  });

  it("uno mismo es «Vos», sin email", () => {
    expect(authorLabel(YO, { id: YO, role: "owner" }, members, ROLES)).toBe("Vos");
    expect(authorLabel(YO, { id: YO, role: "staff" }, { status: "none" }, ROLES)).toBe("Vos");
  });

  it("el Dueño ve el email y el rol actual de quien sigue en el local", () => {
    expect(authorLabel(OTRA, { id: YO, role: "owner" }, members, ROLES)).toBe("mozo@cafe-ejemplo.test (Personal)");
  });

  it("el Dueño no identifica a quien ya no es miembro de este local", () => {
    const label = authorLabel("a0000000-0000-4000-8000-0000000000ff", { id: YO, role: "owner" }, members, ROLES);
    expect(label).toBe("Persona que ya no está en el local");
    expect(label).not.toContain("@");
  });

  it("si no se pudo resolver, etiqueta neutra y no «ya no está»", () => {
    expect(authorLabel(OTRA, { id: YO, role: "owner" }, { status: "failed" }, ROLES)).toBe("Otra persona (no se pudo identificar)");
  });

  it("el Staff nunca recibe el email, ni siquiera si la página le pasara el mapa", () => {
    expect(authorLabel(OTRA, { id: YO, role: "staff" }, { status: "none" }, ROLES)).toBe("Otra persona del equipo");
    expect(authorLabel(OTRA, { id: YO, role: "staff" }, members, ROLES)).toBe("Otra persona del equipo");
    expect(authorLabel(OTRA, { id: YO, role: "staff" }, { status: "failed" }, ROLES)).toBe("Otra persona del equipo");
  });
});
