import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership, anonClient, createOrg, createUser, DIA_MS, deleteOrg, deleteUser,
  serviceClient, setSubscription, type Db, type TestUser,
} from "./helpers";

let service: Db;
let owner: TestUser;
let staff: TestUser;
let cook: TestUser;
let stranger: TestUser;
const orgs: string[] = [];
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function local() {
  const id = await createOrg(service, `tt-tip-${suffix}-${orgs.length}`, "pro");
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const b = await service.from("branches").insert({ organization_id: id, slug: "centro", name: "Centro" }).select("id").single();
  if (b.error) throw b.error;
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  await addMembership(service, cook, id, "cook");
  return { id, branch: b.data.id };
}

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, cook, stranger] = await Promise.all(
    ["tip-owner", "tip-staff", "tip-cook", "tip-ajeno"].map((name) => createUser(service, name)),
  );
});
afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, cook, stranger].map((u) => deleteUser(service, u)));
});

describe("propina sugerida: persistencia y permisos", () => {
  it("nace desactivada; Dueño activa, modifica y desactiva sin afectar otra sucursal", async () => {
    const l = await local();
    const other = await service.from("branches").insert({ organization_id: l.id, slug: "otra", name: "Otra" }).select("id").single();
    expect(other.error).toBeNull();
    const read = () => service.from("branches").select("tip_percent").eq("id", l.branch).single();
    expect((await read()).data?.tip_percent).toBeNull();
    for (const percent of [1, 10, 15, 100, null]) {
      const result = await owner.db.from("branches").update({ tip_percent: percent }).eq("id", l.branch).select("tip_percent");
      expect(result.error).toBeNull();
      expect(result.data).toEqual([{ tip_percent: percent }]);
      expect((await read()).data?.tip_percent).toBe(percent);
    }
    expect((await service.from("branches").select("tip_percent").eq("id", other.data!.id).single()).data?.tip_percent).toBeNull();
  });

  it("la API rechaza valores fuera de rango y no deja fijarlo al crear sucursales", async () => {
    const l = await local();
    for (const percent of [-1, 0, 101]) {
      expect((await owner.db.from("branches").update({ tip_percent: percent }).eq("id", l.branch)).error?.code).toBe("23514");
    }
    expect((await owner.db.from("branches").insert({ organization_id: l.id, slug: "inyectada", name: "Inyectada", tip_percent: 10 })).error?.code).toBe("42501");
  });

  it("Staff, cocinero, otro Dueño y anónimo no pueden escribir por API directa", async () => {
    const l = await local();
    const other = await createOrg(service, `tt-tip-other-${suffix}`, "pro");
    orgs.push(other);
    await addMembership(service, stranger, other, "owner");
    for (const db of [staff.db, cook.db, stranger.db, anonClient()]) {
      const r = await db.from("branches").update({ tip_percent: 20 }).eq("id", l.branch).select("id");
      expect(r.data ?? []).toEqual([]);
    }
    expect((await service.from("branches").select("tip_percent").eq("id", l.branch).single()).data?.tip_percent).toBeNull();
  });

  it("cuentas en solo lectura, suspendidas o locales inactivos no lo modifican", async () => {
    for (const days of [-10, -20]) {
      const l = await local();
      await setSubscription(service, l.id, { finEnMs: days * DIA_MS });
      const r = await owner.db.from("branches").update({ tip_percent: 10 }).eq("id", l.branch).select("id");
      expect(r.data ?? []).toEqual([]);
    }
    const l = await local();
    expect((await service.from("organizations").update({ is_active: false }).eq("id", l.id)).error).toBeNull();
    expect((await owner.db.from("branches").update({ tip_percent: 10 }).eq("id", l.branch).select("id")).data ?? []).toEqual([]);
  });
});
