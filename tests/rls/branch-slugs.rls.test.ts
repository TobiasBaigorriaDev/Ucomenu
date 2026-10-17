import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { correctBranchSlug, listAdminBranches } from "@/lib/admin/branches";
import type { AdminContext } from "@/lib/admin/organizations";
import { addMembership, anonClient, createOrg, createUser, deleteOrg, deleteUser, DIA_MS, serviceClient, setSubscription, sql, type TestUser } from "./helpers";

const service = serviceClient();
let admin: TestUser, owner: TestUser, staff: TestUser;
const orgs: string[] = [];
const ctx = (user: TestUser): AdminContext => ({ session: user.db, admin: service, actorId: user.id });

async function scenario(label: string) {
  const slug = `tt-slug-${label}`;
  const org = await createOrg(service, slug, "premium");
  orgs.push(org);
  await addMembership(service, owner, org, "owner");
  await addMembership(service, staff, org, "staff");
  const branches = await service.from("branches").insert([
    { organization_id: org, slug: "centro", name: "Centro" }, { organization_id: org, slug: "norte", name: "Norte" },
  ]).select("id, slug");
  if (branches.error) throw branches.error;
  return { org, slug, branch: branches.data.find((b) => b.slug === "centro")!.id, other: branches.data.find((b) => b.slug === "norte")!.id };
}
type Scenario = Awaited<ReturnType<typeof scenario>>;
const correct = (s: Scenario, expectedSlug: string, newSlug: string, branchId = s.branch) =>
  correctBranchSlug(ctx(admin), { orgSlug: s.slug, branchId, expectedSlug, newSlug });
const read = (s: Scenario) => service.from("branches").select("slug, slug_aliases").eq("id", s.branch).single();

beforeAll(async () => {
  [admin, owner, staff] = await Promise.all([createUser(service, "slug-admin"), createUser(service, "slug-owner"), createUser(service, "slug-staff")]);
  sql(`insert into public.platform_admins (user_id) values ('${admin.id}')`);
});
afterAll(async () => {
  for (const org of orgs) await deleteOrg(service, org);
  await Promise.all([admin, owner, staff].map((user) => deleteUser(service, user)));
});

describe("corrección administrativa de identificadores de sucursal", () => {
  it("SuperAdmin corrige, conserva históricos y admite volver a uno propio sin ciclos", async () => {
    const s = await scenario("history");
    expect((await listAdminBranches(ctx(admin), s.org)).ok).toBe(true);
    expect(await correct(s, "centro", " Central ")).toMatchObject({ ok: true, data: { slug: "central" } });
    expect((await read(s)).data).toEqual({ slug: "central", slug_aliases: ["centro"] });
    expect((await correct(s, "central", "matriz")).ok).toBe(true);
    expect((await correct(s, "matriz", "centro")).ok).toBe(true);
    expect((await read(s)).data).toEqual({ slug: "centro", slug_aliases: ["central", "matriz"] });
    // Los históricos nunca se editan a mano: el trigger conserva lo calculado.
    await service.from("branches").update({ slug_aliases: ["inventado"] }).eq("id", s.branch);
    expect((await read(s)).data?.slug_aliases).toEqual(["central", "matriz"]);
  });

  it("ni otra sucursal ni un alta se apropian de un identificador histórico", async () => {
    const s = await scenario("reserved");
    await correct(s, "centro", "central");
    expect(await correct(s, "norte", "centro", s.other)).toEqual({ ok: false, error: "branch_slug_taken" });
    expect((await owner.db.from("branches").insert({ organization_id: s.org, slug: "centro", name: "Otra" })).error?.code).toBe("23505");
    expect(await correct(s, "central", "norte")).toEqual({ ok: false, error: "branch_slug_taken" });
    expect((await read(s)).data).toEqual({ slug: "central", slug_aliases: ["centro"] });
    const other = await scenario("another-org");
    expect((await correct(other, "centro", "central")).ok).toBe(true); // el espacio de nombres es por organización.
  });

  it("dos correcciones sobre una pantalla vieja confirman una sola escritura", async () => {
    const s = await scenario("optimistic");
    const results = await Promise.all([correct(s, "centro", "central"), correct(s, "centro", "matriz")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, error: "branch_changed" });
    expect((await read(s)).data?.slug_aliases).toEqual(["centro"]);
  });

  it("altas y correcciones concurrentes no roban históricos ni duplican direcciones", async () => {
    const s = await scenario("concurrent");
    const [renamed, inserted] = await Promise.all([
      correct(s, "centro", "central"),
      owner.db.from("branches").insert({ organization_id: s.org, slug: "centro", name: "Duplicada" }),
    ]);
    expect(renamed.ok).toBe(true);
    expect(inserted.error?.code).toBe("23505");
    const results = await Promise.all([correct(s, "central", "comun"), correct(s, "norte", "comun", s.other)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, error: "branch_slug_taken" });
  });

  it("Dueño, Staff y actor falsificado no usan el cambio administrativo ni reciben nuevos permisos", async () => {
    const s = await scenario("roles");
    for (const user of [owner, staff]) {
      expect(await correctBranchSlug(ctx(user), { orgSlug: s.slug, branchId: s.branch, expectedSlug: "centro", newSlug: "central" })).toEqual({ ok: false, error: "forbidden" });
      expect(await listAdminBranches(ctx(user), s.org)).toEqual({ ok: false, error: "forbidden" });
      for (const update of [{ slug: "central" }, { slug_aliases: ["alias"] }]) {
        expect((await user.db.from("branches").update(update).eq("id", s.branch)).error?.code).toBe("42501");
      }
    }
    expect(await correctBranchSlug({ ...ctx(owner), actorId: admin.id }, { orgSlug: s.slug, branchId: s.branch, expectedSlug: "centro", newSlug: "central" })).toEqual({ ok: false, error: "forbidden" });
    expect((await anonClient().from("branches").update({ slug: "central" }).eq("id", s.branch)).error?.code).toBe("42501");
    expect((await read(s)).data).toEqual({ slug: "centro", slug_aliases: [] });
  });

  it("no-op, entrada inválida, sucursal ajena y estado obsoleto no anuncian éxito", async () => {
    const s = await scenario("invalid"), other = await scenario("foreign");
    expect(await correct(s, "centro", "centro")).toEqual({ ok: false, error: "branch_slug_unchanged" });
    for (const value of ["", "con espacio", "a".repeat(65), "https://ajeno.test"]) expect(await correct(s, "centro", value)).toEqual({ ok: false, error: "invalid_branch_slug" });
    expect(await correct(s, "centro", "central", other.branch)).toEqual({ ok: false, error: "branch_changed" });
    await correct(s, "centro", "central");
    expect(await correct(s, "centro", "matriz")).toEqual({ ok: false, error: "branch_changed" });
    expect(await correct(s, "centro", "centro")).toEqual({ ok: false, error: "branch_changed" });
    expect((await read(s)).data).toEqual({ slug: "central", slug_aliases: ["centro"] });
  });

  it("la corrección conserva el QR y los alias respetan suspensión e inactividad", async () => {
    const s = await scenario("publication");
    const table = await service.from("tables").insert({ organization_id: s.org, branch_id: s.branch, label: "Mesa" }).select("qr_token").single();
    if (table.error) throw table.error;
    await correct(s, "centro", "central");
    const qr = await anonClient().rpc("resolve_table_qr", { p_token: table.data.qr_token });
    expect(qr.data).toMatchObject({ branch_slug: "central" });
    const status = (branch = "centro") => anonClient().rpc("public_menu_status", { p_org_slug: s.slug, p_branch_slug: branch });
    expect((await status()).data).toBe("available");
    await setSubscription(service, s.org, { finEnMs: -20 * DIA_MS });
    expect((await correct(s, "central", "matriz")).ok).toBe(true); // soporte no depende de la mora del local.
    expect((await status()).data).toBe("suspended");
    expect((await status("central")).data).toBe("suspended");
    expect((await status("inventada")).data).toBeNull();
    await service.from("organizations").update({ is_active: false }).eq("id", s.org);
    expect((await status()).data).toBeNull();
  });
});
