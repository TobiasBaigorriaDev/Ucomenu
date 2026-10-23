import { describe, expect, it } from "vitest";
import type { Entitlements } from "@/lib/entitlements";
import { buildGuide, type GuideBranch, type GuideCounts } from "./primeros-pasos";

const ACTIVE: Entitlements = { state: "active", canWrite: true, features: ["menu"], limits: {}, usage: {} };
const PRO: Entitlements = { ...ACTIVE, features: ["menu", "waiter_call"] };
const READ_ONLY: Entitlements = { ...ACTIVE, state: "read_only", canWrite: false };
const SUSPENDED: Entitlements = { ...ACTIVE, state: "suspended", canWrite: false };

const EMPTY: GuideCounts = {
  categories: 0,
  visibleProducts: 0,
  visibleWithoutPhoto: 0,
  tables: 0,
  activeTables: 0,
  branchIdsWithActiveTables: [],
  activeTablesByBranch: {},
};
const FULL: GuideCounts = {
  categories: 2,
  visibleProducts: 5,
  visibleWithoutPhoto: 0,
  tables: 4,
  activeTables: 4,
  branchIdsWithActiveTables: ["b1"],
  activeTablesByBranch: { b1: 4 },
};

const build = (counts: GuideCounts, ent: Entitlements | null = ACTIVE, role: "owner" | "staff" = "owner", branchCount = 1) =>
  buildGuide({ counts, branchCount, ent, role, slug: "cafe" });

function steps(guide: ReturnType<typeof build>) {
  if (guide?.kind !== "steps") throw new Error("se esperaba la lista de pasos");
  return guide;
}

describe("buildGuide: local recién dado de alta", () => {
  it("muestra los tres pasos, el de la carta primero y los QR a la espera", () => {
    const guide = steps(build(EMPTY));
    expect(guide.steps.map((s) => [s.id, s.status])).toEqual([
      ["carta", "todo"],
      ["mesas", "todo"],
      ["qr", "waiting"],
    ]);
    expect(guide.blockedNotice).toBeNull();
    expect(guide.steps[0].href).toBe("/panel/cafe/carta");
    expect(guide.steps[1].href).toBe("/panel/cafe/mesas");
    expect(guide.steps[2].href).toBeUndefined();
  });

  it("sin sucursales no hay guía (el Resumen ya lo avisa)", () => {
    expect(build(EMPTY, ACTIVE, "owner", 0)).toBeNull();
  });
});

describe("buildGuide: avance deducido de los datos", () => {
  it("categorías sin platos visibles: el paso de la carta sigue pendiente y lo explica", () => {
    const [carta] = steps(build({ ...EMPTY, categories: 2 })).steps;
    expect(carta.status).toBe("todo");
    expect(carta.detail).toContain("2 categorías");
    expect(carta.cta).toBe("Agregar platos");
  });

  it("platos visibles marcan la carta como lista", () => {
    const [carta, mesas] = steps(build({ ...EMPTY, categories: 1, visibleProducts: 3 })).steps;
    expect(carta.status).toBe("done");
    expect(carta.detail).toBe("3 platos se ven en tu carta.");
    expect(mesas.status).toBe("todo");
  });

  it("solo mesas inactivas no cuentan: se pide activarlas", () => {
    const [, mesas, qr] = steps(build({ ...EMPTY, tables: 3 })).steps;
    expect(mesas.status).toBe("todo");
    expect(mesas.cta).toBe("Activar mesas");
    expect(qr.status).toBe("waiting");
  });

  it("con mesas activas el paso de QR queda disponible, con la hoja de la única sucursal", () => {
    const guide = steps(build({ ...EMPTY, tables: 2, activeTables: 2, branchIdsWithActiveTables: ["b1"] }));
    expect(guide.steps.map((s) => s.status)).toEqual(["todo", "done", "todo"]);
    expect(guide.steps[2].href).toBe("/panel/cafe/mesas/imprimir/b1");
  });

  it("con mesas activas en varias sucursales el QR lleva a la pantalla de mesas", () => {
    const guide = steps(build({ ...EMPTY, tables: 2, activeTables: 2, branchIdsWithActiveTables: ["b1", "b2"] }));
    expect(guide.steps[2].href).toBe("/panel/cafe/mesas");
  });
});

describe("buildGuide: todo hecho", () => {
  it("se resume y ofrece atajos, sin llamados en el plan Básico", () => {
    const guide = build(FULL);
    if (guide?.kind !== "ready") throw new Error("se esperaba el resumen");
    expect(guide.summary).toBe("Tu local está listo: 5 platos en la carta y 4 mesas activas con su QR.");
    expect(guide.links.map((l) => l.href)).toEqual(["/panel/cafe/mesas/imprimir/b1", "/panel/cafe/carta"]);
    expect(guide.hints).toEqual([]);
  });

  it("con llamado al mozo en el plan suma el enlace a la sala", () => {
    const guide = build(FULL, PRO);
    if (guide?.kind !== "ready") throw new Error("se esperaba el resumen");
    expect(guide.links.map((l) => l.href)).toContain("/sala/cafe");
  });

  it("no ofrece la sala si la cuenta no deja operar", () => {
    const guide = build(FULL, { ...PRO, canWrite: false, state: "read_only" });
    if (guide?.kind !== "ready") throw new Error("se esperaba el resumen");
    expect(guide.links.map((l) => l.href)).not.toContain("/sala/cafe");
  });

  it("sugiere fotos sin impedir que la guía esté completa", () => {
    const guide = build({ ...FULL, visibleWithoutPhoto: 1 });
    if (guide?.kind !== "ready") throw new Error("se esperaba el resumen");
    expect(guide.hints).toEqual(["1 plato sin foto: una foto ayuda a elegir. Sumala desde la carta."]);
  });

  it("el singular de una mesa y un plato", () => {
    const guide = build({ ...FULL, visibleProducts: 1, activeTables: 1 });
    if (guide?.kind !== "ready") throw new Error("se esperaba el resumen");
    expect(guide.summary).toBe("Tu local está listo: 1 plato en la carta y 1 mesa activa con su QR.");
  });
});

describe("buildGuide: cuenta que no deja escribir", () => {
  it("en solo lectura o suspendida no ofrece acciones de escritura y lo dice", () => {
    for (const ent of [READ_ONLY, SUSPENDED]) {
      const guide = steps(build(EMPTY, ent));
      expect(guide.blockedNotice, ent.state).toContain(ent.state === "suspended" ? "suspendida" : "solo lectura");
      expect(guide.steps.map((s) => [s.status, s.href ?? null]), ent.state).toEqual([
        ["paused", null],
        ["paused", null],
        ["waiting", null],
      ]);
    }
  });

  it("imprimir los QR sigue disponible aunque no se pueda editar", () => {
    const guide = steps(build({ ...EMPTY, tables: 1, activeTables: 1, branchIdsWithActiveTables: ["b1"] }, READ_ONLY));
    expect(guide.steps[2]).toMatchObject({ status: "todo", href: "/panel/cafe/mesas/imprimir/b1" });
    expect(guide.steps[0].status).toBe("paused");
  });

  it("el aviso depende del rol y nunca menciona plan ni fechas", () => {
    expect(steps(build(EMPTY, READ_ONLY, "owner")).blockedNotice).toContain("Suscripción");
    const staff = steps(build(EMPTY, READ_ONLY, "staff")).blockedNotice;
    expect(staff).toContain("Avisale al dueño");
    expect(staff).not.toContain("Suscripción");
  });

  it("falla cerrado si no se pudo leer el estado de la cuenta", () => {
    const guide = steps(build(EMPTY, null));
    expect(guide.blockedNotice).toContain("No pudimos comprobar");
    expect(guide.steps[0]).toMatchObject({ status: "paused" });
    expect(guide.steps[0].href).toBeUndefined();
  });
});

describe("buildGuide: varias sucursales", () => {
  const CENTRO: GuideBranch = { id: "b1", name: "Centro" };
  const NORTE: GuideBranch = { id: "b2", name: "Norte" };
  const dos = (counts: GuideCounts, branches: readonly GuideBranch[] = [CENTRO, NORTE]) =>
    buildGuide({ counts, branchCount: branches.length, branches, ent: ACTIVE, role: "owner", slug: "cafe" });

  it("con una sola sucursal no suma el resumen por sucursal", () => {
    const guide = buildGuide({ counts: FULL, branchCount: 1, branches: [CENTRO], ent: ACTIVE, role: "owner", slug: "cafe" });
    expect(guide).toMatchObject({ kind: "ready" });
    expect(JSON.stringify(guide)).not.toContain("Por sucursal");
  });

  it("completa: el resumen nombra las mesas de cada sucursal y avisa de la que no tiene", () => {
    const guide = dos({ ...FULL, tables: 4, activeTables: 4, branchIdsWithActiveTables: ["b1"], activeTablesByBranch: { b1: 4 } });
    if (guide?.kind !== "ready") throw new Error("se esperaba la guía completa");
    expect(guide.summary).toContain("Por sucursal: Centro: 4 mesas activas · Norte: sin mesas activas.");
    expect(guide.hints).toEqual(["La sucursal «Norte» todavía no tiene mesas activas, así que no tiene QR."]);
  });

  it("completa con mesas en las dos: sin avisos", () => {
    const guide = dos({ ...FULL, activeTables: 5, branchIdsWithActiveTables: ["b1", "b2"], activeTablesByBranch: { b1: 4, b2: 1 } });
    if (guide?.kind !== "ready") throw new Error("se esperaba la guía completa");
    expect(guide.summary).toContain("Centro: 4 mesas activas · Norte: 1 mesa activa.");
    expect(guide.hints).toEqual([]);
  });

  it("en pasos: el paso de las mesas muestra el avance de cada sucursal y aclara que cada una tiene las suyas", () => {
    const sinMesas = steps(dos(EMPTY));
    expect(sinMesas.steps[1].detail).toContain("cada sucursal tiene las suyas");
    const conUna = steps(dos({ ...EMPTY, tables: 2, activeTables: 2, branchIdsWithActiveTables: ["b2"], activeTablesByBranch: { b2: 2 } }));
    expect(conUna.steps[1]).toMatchObject({ id: "mesas", status: "done" });
    expect(conUna.steps[1].detail).toContain("Por sucursal: Centro: sin mesas activas · Norte: 2 mesas activas.");
  });
});
