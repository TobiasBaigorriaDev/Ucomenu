import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProductAvailability, loadSoldOutProducts, setProductAvailability } from "@/lib/carta/availability";
import { addMembership, anonClient, createCategory, createOrg, createUser, deleteOrg, deleteUser, DIA_MS, serviceClient, setSubscription, type TestUser } from "./helpers";

const service = serviceClient();
let owner: TestUser, staff: TestUser, stranger: TestUser;
const orgs: string[] = [];
type Scenario = Awaited<ReturnType<typeof scenario>>;

async function scenario(label: string) {
  const org = await createOrg(service, `tt-availability-${label}`, "pro");
  orgs.push(org);
  await addMembership(service, owner, org, "owner");
  await addMembership(service, staff, org, "staff");
  const category = await createCategory(service, org);
  const branches = await service.from("branches").insert([
    { organization_id: org, name: "Centro", slug: "centro" }, { organization_id: org, name: "Norte", slug: "norte" },
  ]).select("id, slug");
  if (branches.error) throw branches.error;
  const p = await service.from("products").insert({ organization_id: org, category_id: category, name: "Plato", price_cents: 2000 }).select("id").single();
  if (p.error) throw p.error;
  return { org, category, product: p.data.id, branch: branches.data.find((b) => b.slug === "centro")!.id, other: branches.data.find((b) => b.slug === "norte")!.id };
}
const row = (e: Scenario, available = false) => ({ organization_id: e.org, branch_id: e.branch, product_id: e.product, is_available: available });
const read = (e: Scenario) => service.from("product_availability").select("*").eq("organization_id", e.org);

beforeAll(async () => {
  [owner, staff, stranger] = await Promise.all([createUser(service, "av-owner"), createUser(service, "av-staff"), createUser(service, "av-ajeno")]);
});
afterAll(async () => {
  for (const org of orgs) await deleteOrg(service, org);
  await Promise.all([owner, staff, stranger].map((user) => deleteUser(service, user)));
});

describe("disponibilidad por sucursal: aislamiento y persistencia", () => {
  it("sin fila está disponible; Dueño y Staff agotan/restablecen solo una sucursal", async () => {
    const e = await scenario("roles");
    expect((await loadProductAvailability(staff.db, e.org, e.product)).every((b) => b.is_available)).toBe(true);
    expect(await setProductAvailability(owner.db, e.org, e.product, e.branch, false)).toMatchObject({ ok: true });
    expect(await loadSoldOutProducts(anonClient(), e.org, e.branch)).toEqual(new Set([e.product]));
    expect(await loadSoldOutProducts(anonClient(), e.org, e.other)).toEqual(new Set());
    expect(await setProductAvailability(staff.db, e.org, e.product, e.branch, true)).toMatchObject({ ok: true });
    expect(await loadSoldOutProducts(anonClient(), e.org, e.branch)).toEqual(new Set());
    expect((await service.from("products").select("is_active, price_cents").eq("id", e.product).single()).data).toEqual({ is_active: true, price_cents: 2000 });
    expect((await read(e)).data).toHaveLength(1);
  });

  it("repetir o crear en paralelo es idempotente: una fila y el estado deseado", async () => {
    const e = await scenario("race");
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => setProductAvailability(i % 2 ? owner.db : staff.db, e.org, e.product, e.branch, false)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await read(e)).data).toEqual([row(e)]);
    for (let i = 0; i < 2; i++) expect(await setProductAvailability(staff.db, e.org, e.product, e.branch, true)).toMatchObject({ ok: true });
    expect((await read(e)).data).toEqual([row(e, true)]);
  });

  it("anónimo y ajeno no insertan, actualizan ni borran, aunque lean la carta", async () => {
    const e = await scenario("forbidden");
    await setProductAvailability(owner.db, e.org, e.product, e.branch, false);
    for (const db of [anonClient(), stranger.db]) {
      expect((await db.from("product_availability").insert({ ...row(e), branch_id: e.other })).error?.code).toBe("42501");
      const changed = await db.from("product_availability").update({ is_available: true }).eq("branch_id", e.branch).eq("product_id", e.product).select();
      expect(changed.error !== null || changed.data?.length === 0).toBe(true);
      expect((await db.from("product_availability").delete().eq("branch_id", e.branch)).error?.code).toBe("42501");
    }
    expect((await read(e)).data).toEqual([row(e)]);
    expect((await setProductAvailability(stranger.db, e.org, e.product, e.branch, true)).ok).toBe(false);
  });

  it("las claves compuestas impiden mezclar organizaciones, incluso siendo miembro de ambas", async () => {
    const a = await scenario("fk-a"), b = await scenario("fk-b");
    for (const body of [{ ...row(a), branch_id: b.branch }, { ...row(a), product_id: b.product }]) {
      expect((await owner.db.from("product_availability").insert(body)).error?.code).toBe("23503");
    }
    expect(await setProductAvailability(owner.db, a.org, b.product, a.branch, false)).toEqual({ ok: false, error: "not_found" });
    expect(await setProductAvailability(staff.db, a.org, a.product, b.branch, false)).toEqual({ ok: false, error: "not_found" });
    expect((await read(a)).data).toEqual([]);
    expect((await read(b)).data).toEqual([]);
  });

  it("Dueño y Staff solo actualizan el estado: no mueven claves ni borran", async () => {
    const e = await scenario("immutable");
    await setProductAvailability(owner.db, e.org, e.product, e.branch, false);
    for (const user of [owner, staff]) {
      for (const change of [{ branch_id: e.other }, { product_id: e.product }, { organization_id: e.org }]) {
        expect((await user.db.from("product_availability").update(change).eq("branch_id", e.branch)).error?.code).toBe("42501");
      }
      expect((await user.db.from("product_availability").delete().eq("branch_id", e.branch)).error?.code).toBe("42501");
    }
    expect((await read(e)).data).toEqual([row(e)]);
  });

  it.each([10, 20])("mora de %i días bloquea INSERT y UPDATE directos y el módulo, sin falsos éxitos", async (days) => {
    const e = await scenario(`billing-${days}`);
    await setProductAvailability(owner.db, e.org, e.product, e.branch, false);
    await setSubscription(service, e.org, { finEnMs: -days * DIA_MS });
    for (const user of [owner, staff]) {
      expect((await user.db.from("product_availability").insert({ ...row(e), branch_id: e.other })).error?.code).toBe("42501");
      const changed = await user.db.from("product_availability").update({ is_available: true }).eq("branch_id", e.branch).select();
      expect(changed.error !== null || changed.data?.length === 0).toBe(true);
      expect(await setProductAvailability(user.db, e.org, e.product, e.branch, true)).toEqual({ ok: false, error: days === 20 ? "blocked_suspended" : "blocked_read_only" });
      expect((await loadProductAvailability(user.db, e.org, e.product)).find((b) => b.id === e.branch)?.is_available).toBe(false);
    }
    expect((await read(e)).data).toEqual([row(e)]);
    expect((await anonClient().from("product_availability").select().eq("organization_id", e.org)).data).toHaveLength(days === 20 ? 0 : 1);
  });

  it("gracia conserva edición; platos/categorías/organizaciones inactivos no filtran estados a anon", async () => {
    const e = await scenario("visibility");
    await setSubscription(service, e.org, { finEnMs: -3 * DIA_MS });
    expect(await setProductAvailability(staff.db, e.org, e.product, e.branch, false)).toMatchObject({ ok: true });
    const visible = () => anonClient().from("product_availability").select().eq("organization_id", e.org);
    expect((await visible()).data).toHaveLength(1);
    await service.from("products").update({ is_active: false }).eq("id", e.product);
    expect((await visible()).data).toEqual([]);
    await service.from("products").update({ is_active: true }).eq("id", e.product);
    await service.from("categories").update({ is_active: false }).eq("id", e.category);
    expect((await visible()).data).toEqual([]);
    await service.from("categories").update({ is_active: true }).eq("id", e.category);
    await service.from("organizations").update({ is_active: false }).eq("id", e.org);
    expect((await visible()).data).toEqual([]);
    expect((await loadProductAvailability(owner.db, e.org, e.product)).find((b) => b.id === e.branch)?.is_available).toBe(false);
  });
});
