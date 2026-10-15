import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { Entitlements } from "@/lib/entitlements";
import { muteTable, setBranchCooldown, unmuteTable } from "./config";
import { configBlockNotice, configErrorMessage, configWriteBlock } from "./config-messages";
import { COOLDOWN_MAX, COOLDOWN_MIN, formatMuteEnd, isMuted, MUTE_OPTIONS, muteUntil, parseCooldown, parseMuteMinutes } from "./config-rules";

const ID = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-14T18:00:00.000Z"); // 15:00 en Argentina

describe("duración del silencio", () => {
  it("solo acepta las opciones que ofrece la pantalla", () => {
    for (const option of MUTE_OPTIONS) expect(parseMuteMinutes(String(option.minutes))).toBe(option.minutes);
    for (const raw of ["", "0", "-15", "14", "1441", "99999", "15.5", "1e3", " 15", "quince", null, undefined, 15, {}]) {
      expect(parseMuteMinutes(raw)).toBeNull();
    }
  });

  it("ninguna opción pasa del tope de 24 horas de la base", () => {
    expect(Math.max(...MUTE_OPTIONS.map((option) => option.minutes))).toBeLessThanOrEqual(24 * 60);
  });

  it("calcula el fin del silencio sumando los minutos al instante dado", () => {
    expect(muteUntil(15, NOW)).toBe("2026-10-14T18:15:00.000Z");
    expect(muteUntil(1440, NOW)).toBe("2026-10-15T18:00:00.000Z");
  });
});

describe("estado «silenciada»", () => {
  it("lo está solo mientras la fecha sea futura", () => {
    expect(isMuted("2026-10-14T18:00:01.000Z", NOW)).toBe(true);
    expect(isMuted("2026-10-14T18:00:00.000Z", NOW)).toBe(false); // el borde ya no cuenta
    expect(isMuted("2026-10-14T17:00:00.000Z", NOW)).toBe(false);
    expect(isMuted(null, NOW)).toBe(false);
    expect(isMuted("no es una fecha", NOW)).toBe(false);
  });

  it("muestra la hora de Argentina, con el día si no es hoy", () => {
    expect(formatMuteEnd("2026-10-14T18:30:00.000Z", NOW)).toBe("las 15:30");
    expect(formatMuteEnd("2026-10-15T01:00:00.000Z", NOW)).toBe("las 22:00"); // sigue siendo el 14 allá
    expect(formatMuteEnd("2026-10-15T18:00:00.000Z", NOW)).toBe("el 15/10 a las 15:00");
  });
});

describe("cooldown", () => {
  it("acepta enteros entre 10 y 3600 (bordes inclusivos)", () => {
    expect(parseCooldown(String(COOLDOWN_MIN))).toEqual({ ok: true, seconds: COOLDOWN_MIN });
    expect(parseCooldown(String(COOLDOWN_MAX))).toEqual({ ok: true, seconds: COOLDOWN_MAX });
    expect(parseCooldown(" 90 ")).toEqual({ ok: true, seconds: 90 });
    expect(parseCooldown("0090")).toEqual({ ok: true, seconds: 90 });
  });

  it("rechaza vacío, fuera de rango y lo que no es un entero", () => {
    expect(parseCooldown("")).toEqual({ ok: false, problem: "blank" });
    expect(parseCooldown("   ")).toEqual({ ok: false, problem: "blank" });
    expect(parseCooldown(null)).toEqual({ ok: false, problem: "blank" });
    for (const raw of ["9", "3601", "0", "99999"]) expect(parseCooldown(raw)).toEqual({ ok: false, problem: "out_of_range" });
    for (const raw of ["-60", "60.5", "6e1", "sesenta", "60 s", "123456"]) {
      expect(parseCooldown(raw)).toEqual({ ok: false, problem: "not_integer" });
    }
  });
});

describe("mensajes", () => {
  const ent = (over: Partial<Entitlements>): Entitlements => ({ state: "active", canWrite: true, features: [], limits: {}, usage: {}, ...over });

  it("cada error tiene un texto y ninguno revela datos internos", () => {
    for (const error of ["cooldown_blank", "cooldown_invalid", "mute_invalid", "blocked_read_only", "blocked_suspended", "forbidden", "not_found", "unexpected"] as const) {
      expect(configErrorMessage(error).length).toBeGreaterThan(10);
    }
    expect(configErrorMessage("cooldown_invalid")).toContain(`${COOLDOWN_MIN}`);
    expect(configErrorMessage("cooldown_invalid")).toContain(`${COOLDOWN_MAX}`);
  });

  it("la cuenta bloquea según su estado y falla cerrado si no se pudo leer", () => {
    expect(configWriteBlock(ent({}))).toBeNull();
    expect(configWriteBlock(ent({ state: "grace" }))).toBeNull();
    expect(configWriteBlock(ent({ state: "read_only", canWrite: false }))).toBe("blocked_read_only");
    expect(configWriteBlock(ent({ state: "suspended", canWrite: false }))).toBe("blocked_suspended");
    expect(configWriteBlock(null)).toBe("unexpected");
    expect(configBlockNotice(ent({}))).toBeNull();
    expect(configBlockNotice(ent({ state: "read_only", canWrite: false }))).toMatch(/solo lectura/);
    expect(configBlockNotice(ent({ state: "suspended", canWrite: false }))).toMatch(/suspendida/);
  });
});

/** Cliente simulado: cada `from(tabla)` devuelve un encadenable que registra el UPDATE y resuelve con lo configurado. */
function fakeDb(opts: { update?: { data: unknown[] | null; error: { code?: string; message?: string } | null }; exists?: boolean; entitlements?: unknown }) {
  const updates: { table: string; values: unknown }[] = [];
  const entitlements = opts.entitlements ?? { state: "active", can_write: true, features: ["waiter_call"], limits: {}, usage: {} };

  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    const settle = () => Promise.resolve(opts.update ?? { data: [], error: null });
    chain.update = (values: unknown) => {
      updates.push({ table, values });
      return chain;
    };
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.maybeSingle = () => Promise.resolve({ data: opts.exists === false ? null : { id: ID }, error: null });
    chain.then = (resolve: (value: unknown) => unknown) => settle().then(resolve);
    return chain;
  });
  const rpc = vi.fn().mockResolvedValue({ data: entitlements, error: null });
  return { db: { from, rpc } as unknown as SupabaseClient<Database>, updates };
}

describe("muteTable / unmuteTable", () => {
  it("manda solo muted_until, calculado desde el reloj dado, y confirma la fila", async () => {
    const { db, updates } = fakeDb({ update: { data: [{ id: ID, muted_until: "x" }], error: null } });
    expect(await muteTable(db, ORG, ID, "60", NOW)).toEqual({ ok: true, data: undefined });
    expect(updates).toEqual([{ table: "tables", values: { muted_until: "2026-10-14T19:00:00.000Z" } }]);
  });

  it("una duración inválida no llega a la base", async () => {
    const { db, updates } = fakeDb({});
    expect(await muteTable(db, ORG, ID, "99999", NOW)).toEqual({ ok: false, error: "mute_invalid" });
    expect(await muteTable(db, ORG, ID, undefined, NOW)).toEqual({ ok: false, error: "mute_invalid" });
    expect(updates).toEqual([]);
  });

  it("quitar el silencio manda null", async () => {
    const { db, updates } = fakeDb({ update: { data: [{ id: ID }], error: null } });
    expect((await unmuteTable(db, ORG, ID)).ok).toBe(true);
    expect(updates).toEqual([{ table: "tables", values: { muted_until: null } }]);
  });

  it("0 filas no es un éxito: mesa inexistente → not_found; existente con la cuenta al día → forbidden", async () => {
    expect(await unmuteTable(fakeDb({ exists: false }).db, ORG, ID)).toEqual({ ok: false, error: "not_found" });
    expect(await unmuteTable(fakeDb({ exists: true }).db, ORG, ID)).toEqual({ ok: false, error: "forbidden" });
  });

  it("con la cuenta en solo lectura o suspendida no escribe y dice el motivo", async () => {
    for (const [state, error] of [["read_only", "blocked_read_only"], ["suspended", "blocked_suspended"]] as const) {
      const { db, updates } = fakeDb({ entitlements: { state, can_write: false, features: [], limits: {}, usage: {} } });
      expect(await muteTable(db, ORG, ID, "15", NOW)).toEqual({ ok: false, error });
      expect(updates).toEqual([]);
    }
  });

  it("el tope de 24 horas de la base (22023) se traduce a un mensaje claro", async () => {
    const { db } = fakeDb({ update: { data: null, error: { code: "22023", message: "mute_too_long" } } });
    expect(await muteTable(db, ORG, ID, "15", NOW)).toEqual({ ok: false, error: "mute_invalid" });
  });
});

describe("setBranchCooldown", () => {
  it("valida el rango antes de tocar la base y devuelve el valor guardado", async () => {
    const mala = fakeDb({});
    expect(await setBranchCooldown(mala.db, ORG, ID, "5")).toEqual({ ok: false, error: "cooldown_invalid" });
    expect(await setBranchCooldown(mala.db, ORG, ID, "")).toEqual({ ok: false, error: "cooldown_blank" });
    expect(mala.updates).toEqual([]);

    const buena = fakeDb({ update: { data: [{ id: ID, waiter_call_cooldown_seconds: 90 }], error: null } });
    expect(await setBranchCooldown(buena.db, ORG, ID, "90")).toEqual({ ok: true, data: { seconds: 90 } });
    expect(buena.updates).toEqual([{ table: "branches", values: { waiter_call_cooldown_seconds: 90 } }]);
  });

  it("el Staff (0 filas por la política de sucursales) recibe «forbidden», no un éxito falso", async () => {
    expect(await setBranchCooldown(fakeDb({ exists: true }).db, ORG, ID, "90")).toEqual({ ok: false, error: "forbidden" });
  });

  it("sin permiso de columna (42501) con la cuenta al día → forbidden", async () => {
    const { db } = fakeDb({ update: { data: null, error: { code: "42501" } } });
    expect(await setBranchCooldown(db, ORG, ID, "90")).toEqual({ ok: false, error: "forbidden" });
  });
});
