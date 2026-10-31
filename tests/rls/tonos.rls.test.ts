import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAlertTones } from "@/lib/llamados/config";
import { TONES } from "@/lib/sala/tonos";
import { addMembership, anonClient, createOrg, createUser, deleteOrg, deleteUser, DIA_MS, serviceClient, setSubscription, type Db, type TestUser } from "./helpers";

let service: Db;
let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
let org: string;
let other: string;

const tonesOf = async (id: string) => {
  const { data, error } = await service.from("organizations").select("call_tone, ready_tone").eq("id", id).single();
  expect(error).toBeNull();
  return data;
};

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([createUser(service, "tonos-owner"), createUser(service, "tonos-staff"), createUser(service, "tonos-ajeno")]);
  org = await createOrg(service, "tt-tonos");
  other = await createOrg(service, "tt-tonos-otra");
  await addMembership(service, owner, org, "owner");
  await addMembership(service, staff, org, "staff");
});

afterAll(async () => {
  if (service) {
    await deleteOrg(service, org);
    await deleteOrg(service, other);
    await Promise.all([owner, staff, stranger].map(person => deleteUser(service, person)));
  }
});

describe("tonos de aviso (ficha tonos-de-aviso)", () => {
  it("un local nuevo conserva los MP3 de siempre", async () => {
    expect(await tonesOf(org)).toEqual({ call_tone: "llamado", ready_tone: "plato-listo" });
  });

  it("el Dueño elige cualquier tono del catálogo para cada aviso sin afectar a otro local", async () => {
    for (const tone of TONES) {
      expect(await setAlertTones(owner.db, org, tone.id, "campana")).toEqual({ ok: true, data: { call: tone.id, ready: "campana" } });
      expect(await tonesOf(org)).toEqual({ call_tone: tone.id, ready_tone: "campana" });
    }
    expect(await tonesOf(other)).toEqual({ call_tone: "llamado", ready_tone: "plato-listo" });
  });

  it("la lectura de un miembro devuelve lo guardado", async () => {
    await setAlertTones(owner.db, org, "timbre", "marimba");
    const read = await staff.db.from("organizations").select("call_tone, ready_tone").eq("id", org).single();
    expect(read.data).toEqual({ call_tone: "timbre", ready_tone: "marimba" });
  });

  it("la aplicación y la base rechazan un valor fuera del catálogo y conservan el anterior", async () => {
    await setAlertTones(owner.db, org, "digital", "alerta");
    for (const bad of ["", "Campana", "/notificacion.mp3", "https://evil.example/a.mp3", "campana "]) {
      expect(await setAlertTones(owner.db, org, bad, "alerta")).toEqual({ ok: false, error: "tone_invalid" });
      const raw = await owner.db.from("organizations").update({ call_tone: bad }).eq("id", org).select("id");
      expect(raw.error?.code, bad).toBe("23514");
    }
    expect((await owner.db.from("organizations").update({ ready_tone: null as unknown as string }).eq("id", org)).error?.code).toBe("23502");
    expect(await tonesOf(org)).toEqual({ call_tone: "digital", ready_tone: "alerta" });
  });

  it("el Staff, otro Dueño y un anónimo no pueden cambiarlos", async () => {
    await setAlertTones(owner.db, org, "llamado", "plato-listo");
    expect(await setAlertTones(staff.db, org, "alerta", "alerta")).toEqual({ ok: false, error: "forbidden" });
    // Quien no es miembro ni siquiera puede leer el estado de la cuenta: falla cerrado.
    expect((await setAlertTones(stranger.db, org, "alerta", "alerta")).ok).toBe(false);
    const forced = await staff.db.from("organizations").update({ call_tone: "alerta" }).eq("id", org).select("id");
    expect(forced.data).toEqual([]);
    expect((await anonClient().from("organizations").update({ call_tone: "alerta" }).eq("id", org)).error?.code).toBe("42501");
    expect(await tonesOf(org)).toEqual({ call_tone: "llamado", ready_tone: "plato-listo" });
  });

  it("la cuenta en solo lectura no cambia los tonos, aunque se fuerce la API", async () => {
    await setSubscription(service, org, { finEnMs: -10 * DIA_MS });
    try {
      expect((await setAlertTones(owner.db, org, "alerta", "alerta")).ok).toBe(false);
      const forced = await owner.db.from("organizations").update({ call_tone: "alerta" }).eq("id", org).select("id");
      expect(forced.error).toBeNull();
      expect(forced.data).toEqual([]);
      expect(await tonesOf(org)).toEqual({ call_tone: "llamado", ready_tone: "plato-listo" });
    } finally {
      await setSubscription(service, org, { finEnMs: 5 * DIA_MS });
    }
  });

  it("no abre otras columnas de la organización al escribir", async () => {
    const forced = await owner.db.from("organizations").update({ slug: "tomado", is_active: false }).eq("id", org).select("id");
    expect(forced.error?.code).toBe("42501");
  });
});
