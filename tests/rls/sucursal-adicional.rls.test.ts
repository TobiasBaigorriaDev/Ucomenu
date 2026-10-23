import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminContext } from "@/lib/admin/organizations";
import { changePlan, getOrganizationDetail, setAddon, setExtraBranches } from "@/lib/admin/subscriptions";
import { parseEntitlements } from "@/lib/entitlements";
import { describeHistory, parseHistory } from "@/lib/cuenta/lectura";
import { createBranch, setBranchActive } from "@/lib/sucursales/branches";
import { purgeAuditLogWhere } from "./purge-price-history";
import {
  addMembership,
  anonClient,
  createOrg,
  createUser,
  deleteOrg,
  deleteUser,
  DIA_MS,
  serviceClient,
  setSubscription,
  sql,
  type Db,
  type PlanCode,
  type TestUser,
} from "./helpers";

/**
 * Sucursal adicional para Pro (nivel C, ficha sucursal-adicional, ADR 0039) contra el Supabase local, con los mismos
 * clientes que usa el servidor. Foco: quién puede, la fórmula de desactivaciones exigidas, que cada rechazo no deje huella,
 * el tope bajo concurrencia (alta contra alta y alta contra baja del add-on) y lo que ve cada rol.
 */

const LIMIT_EXCEEDED = "53400";
const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

let service: Db;
let admin: TestUser;
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

const ctx = (user: TestUser): AdminContext => ({ session: user.db, admin: service, actorId: user.id });

type Local = { id: string; slug: string; owner: TestUser; staff: TestUser; branches: { id: string; slug: string }[] };

/** Un local al día con `activas` sucursales (`s1`, `s2`…), un Dueño y un Staff. */
async function crearLocal(plan: PlanCode, activas: number): Promise<Local> {
  contador += 1;
  const slug = `tt-xb-${sufijo}-${contador}`;
  const id = await createOrg(service, slug, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const owner = await createUser(service, `xb-d${contador}`);
  const staff = await createUser(service, `xb-s${contador}`);
  users.push(owner, staff);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  const local: Local = { id, slug, owner, staff, branches: [] };
  for (let i = 1; i <= activas; i++) await agregarSucursal(local, `s${i}`, true);
  return local;
}

/** Inserta una sucursal con el servidor (el trigger del tope corre igual). Devuelve el error, si lo hubo. */
async function agregarSucursal(local: Local, slug: string, activa = true) {
  const r = await service
    .from("branches")
    .insert({ organization_id: local.id, slug, name: slug.toUpperCase(), is_active: activa })
    .select("id")
    .single();
  if (!r.error) local.branches.push({ id: r.data.id, slug });
  return r.error;
}

const idDe = (local: Local, slug: string) => local.branches.find((b) => b.slug === slug)!.id;
const activasDe = async (orgId: string) =>
  (await service.from("branches").select("slug").eq("organization_id", orgId).eq("is_active", true).order("slug")).data!.map((b) => b.slug);
const contratos = async (orgId: string) => (await service.from("subscription_addons").select("*").eq("organization_id", orgId)).data!;
const suscripcion = async (orgId: string) => (await service.from("subscriptions").select("*").eq("organization_id", orgId).single()).data!;
const auditoria = async (orgId: string) =>
  (await service.from("audit_log").select("*").eq("organization_id", orgId).order("created_at", { ascending: true })).data!;
const acciones = async (orgId: string) => (await auditoria(orgId)).map((a) => a.action);

const poner = (
  local: Pick<Local, "slug">,
  quantity: unknown,
  deactivate: string[] = [],
  reason: unknown = "Contrató sucursales",
  quien: TestUser = admin,
) => setExtraBranches(ctx(quien), { slug: local.slug, quantity, deactivate, reason });

const tope = async (local: Local) => {
  const { data, error } = await local.owner.db.rpc("org_entitlements", { p_org: local.id });
  expect(error).toBeNull();
  return parseEntitlements(data)!.limits.branches;
};

beforeAll(async () => {
  service = serviceClient();
  admin = await createUser(service, "xb-admin");
  users.push(admin);
  sql(`insert into public.platform_admins (user_id) values ('${admin.id}')`);
});

afterAll(async () => {
  purgeAuditLogWhere(`after->>'slug' like 'tt-xb-%'`);
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("catálogo", () => {
  it("la fila extra_branch concede sucursales: 1 por pack, hasta 3, ARS 12.000, solo Pro", async () => {
    const { data } = await service.from("addons").select("*").eq("code", "extra_branch").single();
    expect(data).toMatchObject({
      grants_limit: "branches",
      quota_per_pack: 1,
      max_packs: 3,
      price_cents: 1_200_000,
      currency: "ARS",
      allowed_plans: ["pro"],
    });
  });
});

describe("vender sucursales adicionales", () => {
  it("un Pro con 2 activas pone 1: el Dueño crea la 3.ª y la 4.ª da 53400 (por la API y por el servidor)", async () => {
    const local = await crearLocal("pro", 2);
    expect(await tope(local)).toBe(2);
    expect((await createBranch(local.owner.db, local.id, { name: "Tercera", slug: "tercera" })).ok).toBe(false); // sin cupo todavía

    expect(await poner(local, "1")).toEqual({ ok: true, data: undefined });
    expect(await tope(local)).toBe(3);
    expect((await createBranch(local.owner.db, local.id, { name: "Tercera", slug: "tercera" })).ok).toBe(true);

    const cuarta = await local.owner.db.from("branches").insert({ organization_id: local.id, slug: "cuarta", name: "Cuarta" });
    expect(cuarta.error?.code).toBe(LIMIT_EXCEEDED);
    expect((await agregarSucursal(local, "cuarta-srv"))?.code).toBe(LIMIT_EXCEEDED);
    expect(await activasDe(local.id)).toEqual(["s1", "s2", "tercera"]);
    expect(await acciones(local.id)).toEqual(["addon.activated"]);
  });

  it("Básico y Premium: addon_not_allowed y no cambia nada", async () => {
    for (const plan of ["basic", "premium"] as const) {
      const local = await crearLocal(plan, 1);
      const antes = await suscripcion(local.id);
      const r = await poner(local, "1");
      expect(r).toEqual({ ok: false, error: "addon_not_allowed" });
      expect(await contratos(local.id)).toEqual([]);
      expect(await suscripcion(local.id)).toEqual(antes);
      expect(await auditoria(local.id)).toEqual([]);
    }
  });

  it("4 sucursales: invalid_packs (la validación local y la base) y sin huella", async () => {
    const local = await crearLocal("pro", 1);
    expect(await poner(local, "4")).toEqual({ ok: false, error: "invalid_extra_branches" });
    const base = await service.rpc("admin_set_extra_branches", {
      p_actor: admin.id,
      p_org: local.id,
      p_quantity: 4,
      p_deactivate: [],
      p_reason: "x",
    });
    expect(base.error?.message).toBe("invalid_packs");
    expect(await contratos(local.id)).toEqual([]);
    expect(await auditoria(local.id)).toEqual([]);
  });

  it("sin cambios, motivo vacío o actor que no es SuperAdmin: rechazado sin huella", async () => {
    const local = await crearLocal("pro", 1);
    expect(await poner(local, "0")).toEqual({ ok: false, error: "addon_unchanged" });
    expect(await poner(local, "1", [], "   ")).toEqual({ ok: false, error: "invalid_reason" });
    expect(await poner(local, "1", [], "x", local.owner)).toEqual({ ok: false, error: "forbidden" });
    for (const actor of [local.owner.id, local.staff.id, randomUUID()]) {
      const r = await service.rpc("admin_set_extra_branches", { p_actor: actor, p_org: local.id, p_quantity: 1, p_deactivate: [], p_reason: "x" });
      expect(r.error?.code).toBe("42501");
    }
    expect(await contratos(local.id)).toEqual([]);
    expect(await auditoria(local.id)).toEqual([]);
  });
});

describe("quitar sucursales adicionales: desactivaciones exigidas", () => {
  it("3 activas y 1 adicional: finalizar sin elegir da branches_selection_invalid y no cambia nada; eligiendo una, queda todo registrado", async () => {
    const local = await crearLocal("pro", 2);
    expect((await poner(local, "1")).ok).toBe(true);
    await agregarSucursal(local, "s3");
    const antes = { contratos: await contratos(local.id), auditoria: (await auditoria(local.id)).length };

    expect(await poner(local, "0")).toEqual({ ok: false, error: "branches_selection_invalid" });
    expect(await poner(local, "0", [idDe(local, "s1"), idDe(local, "s2")])).toEqual({ ok: false, error: "branches_selection_invalid" }); // de más
    expect(await contratos(local.id)).toEqual(antes.contratos);
    expect((await auditoria(local.id)).length).toBe(antes.auditoria);
    expect(await activasDe(local.id)).toEqual(["s1", "s2", "s3"]);

    expect((await poner(local, "0", [idDe(local, "s3")], "Dejó de pagar")).ok).toBe(true);
    expect(await activasDe(local.id)).toEqual(["s1", "s2"]);
    expect(await tope(local)).toBe(2);
    const fila = (await contratos(local.id))[0];
    expect(new Date(fila.ends_at!).getTime()).toBeLessThanOrEqual(Date.now());
    const finales = (await auditoria(local.id)).filter((a) => a.action === "addon.ended");
    expect(finales).toHaveLength(1);
    expect(finales[0].after).toMatchObject({ addon: "extra_branch", deactivated_branches: [{ slug: "s3" }], reason: "Dejó de pagar" });
    // La sucursal desactivada conserva su fila (no se borra) y el Dueño la reactiva cuando hay cupo.
    expect((await setBranchActive(local.owner.db, local.id, idDe(local, "s3"), true)).ok).toBe(false);
    expect(await activasDe(local.id)).toEqual(["s1", "s2"]);
  });

  it("2 activas y 1 adicional: finalizar no exige desactivar nada (y una selección sobrante se rechaza)", async () => {
    const local = await crearLocal("pro", 2);
    expect((await poner(local, "1")).ok).toBe(true);
    expect(await poner(local, "0", [idDe(local, "s1")])).toEqual({ ok: false, error: "branches_selection_invalid" });
    expect((await poner(local, "0")).ok).toBe(true);
    expect(await activasDe(local.id)).toEqual(["s1", "s2"]);
    expect(await tope(local)).toBe(2);
    expect(await acciones(local.id)).toEqual(["addon.activated", "addon.ended"]);
  });

  it("la selección tiene que ser de la organización, estar activa y no repetirse", async () => {
    const local = await crearLocal("pro", 2);
    const otro = await crearLocal("pro", 1);
    expect((await poner(local, "1")).ok).toBe(true);
    await agregarSucursal(local, "s3");
    await agregarSucursal(local, "inactiva", false);

    expect(await poner(local, "0", [idDe(otro, "s1")])).toEqual({ ok: false, error: "branches_selection_invalid" });
    expect(await poner(local, "0", [idDe(local, "inactiva")])).toEqual({ ok: false, error: "branches_selection_invalid" });
    expect(await poner(local, "0", [randomUUID()])).toEqual({ ok: false, error: "branches_selection_invalid" });
    expect(await poner(local, "0", ["no-es-un-id"])).toEqual({ ok: false, error: "branches_selection_invalid" });
    const repetida = await service.rpc("admin_set_extra_branches", {
      p_actor: admin.id,
      p_org: local.id,
      p_quantity: 0,
      p_deactivate: [idDe(local, "s3"), idDe(local, "s3")],
      p_reason: "x",
    });
    expect(repetida.error?.message).toBe("branches_selection_invalid");
    expect(await activasDe(local.id)).toEqual(["s1", "s2", "s3"]);
    expect(await activasDe(otro.id)).toEqual(["s1"]);
    expect((await contratos(local.id))[0].ends_at).toBeNull();
  });

  it("bajar de 2 a 1 con 4 activas exige una; subir nunca exige nada", async () => {
    const local = await crearLocal("pro", 2);
    expect((await poner(local, "2")).ok).toBe(true);
    await agregarSucursal(local, "s3");
    await agregarSucursal(local, "s4");
    expect(await poner(local, "1")).toEqual({ ok: false, error: "branches_selection_invalid" });
    expect((await poner(local, "1", [idDe(local, "s4")])).ok).toBe(true);
    expect(await tope(local)).toBe(3);
    expect(await activasDe(local.id)).toEqual(["s1", "s2", "s3"]);
    expect(await poner(local, "3", [idDe(local, "s1")])).toEqual({ ok: false, error: "branches_selection_invalid" });
    expect((await poner(local, "3")).ok).toBe(true);
    expect(await tope(local)).toBe(5);
    expect(await acciones(local.id)).toEqual(["addon.activated", "addon.changed", "addon.changed"]);
  });

  it("el exceso heredado de un cambio de plan no se arrastra: solo se exigen las que se quitan", async () => {
    // Premium con 5 activas baja a Pro (tolerado: bajar de plan no borra) y recién entonces compra 1 adicional.
    const local = await crearLocal("premium", 5);
    expect((await changePlan(ctx(admin), { slug: local.slug, plan: "pro", billingCycle: "monthly", reason: "Baja a Pro" })).ok).toBe(true);
    expect(await tope(local)).toBe(2);
    expect((await poner(local, "1")).ok).toBe(true);
    expect(await tope(local)).toBe(3);
    // Quitarla exige UNA (la que se quita), no las 3 de exceso.
    expect(await poner(local, "0")).toEqual({ ok: false, error: "branches_selection_invalid" });
    expect((await poner(local, "0", [idDe(local, "s5")])).ok).toBe(true);
    expect(await activasDe(local.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(await tope(local)).toBe(2);
  });
});

describe("cambio de plan con sucursales adicionales vigentes", () => {
  it("a Premium las finaliza en la misma transacción y las 3 siguen activas; a Básico responde extra_branches_must_end", async () => {
    const local = await crearLocal("pro", 2);
    expect((await poner(local, "1")).ok).toBe(true);
    await agregarSucursal(local, "s3");

    const alBasico = await changePlan(ctx(admin), { slug: local.slug, plan: "basic", billingCycle: "monthly", reason: "Baja" });
    expect(alBasico).toEqual({ ok: false, error: "extra_branches_must_end" });
    expect((await suscripcion(local.id)).plan_code).toBe("pro");
    expect((await contratos(local.id))[0].ends_at).toBeNull();
    expect(await acciones(local.id)).toEqual(["addon.activated"]);

    const aPremium = await changePlan(ctx(admin), { slug: local.slug, plan: "premium", billingCycle: "monthly", reason: "Sube" });
    expect(aPremium.ok).toBe(true);
    expect((await suscripcion(local.id)).plan_code).toBe("premium");
    expect(await activasDe(local.id)).toEqual(["s1", "s2", "s3"]);
    expect(new Date((await contratos(local.id))[0].ends_at!).getTime()).toBeLessThanOrEqual(Date.now());
    expect(await acciones(local.id)).toEqual(["addon.activated", "addon.ended", "subscription.plan_changed"]);
    expect(await tope(local)).toBeNull();
  });

  it("después de finalizar, un Básico sí puede bajar; cambiar solo el ciclo de un Pro con adicionales no las toca", async () => {
    const local = await crearLocal("pro", 2);
    expect((await poner(local, "1")).ok).toBe(true);
    expect((await changePlan(ctx(admin), { slug: local.slug, plan: "pro", billingCycle: "yearly", reason: "Anual" })).ok).toBe(true);
    expect(await tope(local)).toBe(3);
    expect((await poner(local, "0")).ok).toBe(true);
    expect((await changePlan(ctx(admin), { slug: local.slug, plan: "basic", billingCycle: "monthly", reason: "Baja" })).ok).toBe(true);
    expect(await tope(local)).toBe(1);
  });

  it("un contrato vigente sobre un plan que no lo admite no da cupo", async () => {
    const local = await crearLocal("pro", 2);
    expect((await poner(local, "1")).ok).toBe(true);
    // Forzado a mano (la función se negaría): el cupo se calcula por plan admitido, no solo por la fila.
    await service.from("subscriptions").update({ plan_code: "basic" }).eq("organization_id", local.id);
    expect(await tope(local)).toBe(1);
  });
});

describe("el tope bajo concurrencia", () => {
  it("dos altas que compiten por el último cupo: entra a lo sumo una", async () => {
    const local = await crearLocal("pro", 2);
    expect((await poner(local, "1")).ok).toBe(true);
    const resultados = await Promise.all([agregarSucursal(local, "a"), agregarSucursal(local, "b"), agregarSucursal(local, "c")]);
    expect(resultados.filter((e) => e === null)).toHaveLength(1);
    for (const e of resultados.filter((r) => r !== null)) expect(e?.code).toBe(LIMIT_EXCEEDED);
    expect(await activasDe(local.id)).toHaveLength(3);
  });

  it("un alta que compite con la baja del add-on: el resultado respeta el tope final", async () => {
    for (let i = 0; i < 4; i++) {
      const local = await crearLocal("pro", 2);
      expect((await poner(local, "1")).ok).toBe(true);
      const [alta, baja] = await Promise.all([agregarSucursal(local, "nueva"), poner(local, "0")]);
      const activas = await activasDe(local.id);
      const limite = await tope(local);
      expect(activas.length, `iteración ${i}`).toBeLessThanOrEqual(limite!);
      if (alta === null) {
        // Entró la tercera: la baja ya no podía terminar sin elegir cuál desactivar.
        expect(baja, `iteración ${i}`).toEqual({ ok: false, error: "branches_selection_invalid" });
        expect(limite).toBe(3);
      } else {
        expect(alta.code, `iteración ${i}`).toBe(LIMIT_EXCEEDED);
        expect(baja.ok, `iteración ${i}`).toBe(true);
        expect(limite).toBe(2);
      }
    }
  });

  it("una reactivación que compite con la baja del add-on tampoco se pasa del tope", async () => {
    const local = await crearLocal("pro", 2);
    await agregarSucursal(local, "dormida", false);
    expect((await poner(local, "1")).ok).toBe(true);
    const [reactivar, baja] = await Promise.all([
      setBranchActive(local.owner.db, local.id, idDe(local, "dormida"), true),
      poner(local, "0"),
    ]);
    const activas = await activasDe(local.id);
    expect(activas.length).toBeLessThanOrEqual((await tope(local))!);
    expect(reactivar.ok || baja.ok).toBe(true);
    expect(reactivar.ok && baja.ok).toBe(false);
  });
});

describe("lo que ve y puede cada uno", () => {
  it("el Dueño ve la cantidad y el precio; el Staff y otra organización no", async () => {
    const local = await crearLocal("pro", 2);
    const otra = await crearLocal("pro", 1);
    expect((await poner(local, "2")).ok).toBe(true);

    const dueno = parseEntitlements((await local.owner.db.rpc("org_entitlements", { p_org: local.id })).data)!;
    expect(dueno).toMatchObject({ extraBranches: 2, extraBranchPriceCents: 1_200_000, extraBranchCurrency: "ARS", extraBranchMax: 3 });
    expect(dueno.limits.branches).toBe(4);

    const staff = parseEntitlements((await local.staff.db.rpc("org_entitlements", { p_org: local.id })).data)!;
    expect(staff.limits.branches).toBe(4);
    expect(staff.extraBranches).toBeUndefined();
    expect(staff.extraBranchPriceCents).toBeUndefined();
    expect(staff.extraBranchCurrency).toBeUndefined();
    expect(staff.extraBranchMax).toBeUndefined();

    expect((await local.owner.db.rpc("org_entitlements", { p_org: otra.id })).data).toBeNull();
    // Su contrato es lectura del Dueño; Staff y ajenos no lo leen.
    expect((await local.owner.db.from("subscription_addons").select("extra_packs").eq("organization_id", local.id)).data).toEqual([{ extra_packs: 2 }]);
    expect((await local.staff.db.from("subscription_addons").select("extra_packs").eq("organization_id", local.id)).data).toEqual([]);
    expect((await otra.owner.db.from("subscription_addons").select("extra_packs").eq("organization_id", local.id)).data).toEqual([]);
  });

  it("el Dueño de Básico o Premium no recibe datos del add-on", async () => {
    for (const plan of ["basic", "premium"] as const) {
      const local = await crearLocal(plan, 1);
      const ent = parseEntitlements((await local.owner.db.rpc("org_entitlements", { p_org: local.id })).data)!;
      expect(ent.extraBranches).toBeUndefined();
      expect(ent.extraBranchMax).toBeUndefined();
    }
  });

  it("el Dueño ve el movimiento en su historial con la cantidad, sin motivo ni sucursales", async () => {
    const local = await crearLocal("pro", 2);
    expect((await poner(local, "1", [], "motivo interno")).ok).toBe(true);
    await agregarSucursal(local, "s3");
    expect((await poner(local, "0", [idDe(local, "s3")], "otro motivo interno")).ok).toBe(true);

    const { data, error } = await local.owner.db.rpc("owner_account_history", { p_org: local.id });
    expect(error).toBeNull();
    const filas = parseHistory(data)!;
    const titulos = filas.map((f) => describeHistory(f).title);
    expect(titulos).toContain("Sucursales adicionales activadas por UcoMenu");
    expect(titulos).toContain("Sucursales adicionales finalizadas por UcoMenu");
    const texto = JSON.stringify(data);
    expect(texto).not.toContain("motivo interno");
    expect(texto).not.toContain("deactivated_branches");
    expect(describeHistory(filas.find((f) => f.action === "addon.activated")!).lines).toContain("1 sucursal adicional");
    const staff = await local.staff.db.rpc("owner_account_history", { p_org: local.id });
    expect(staff.data).toEqual([]);
  });

  it("ni el Dueño ni Staff ni anon escriben el catálogo o los contratos, ni ejecutan la función", async () => {
    const local = await crearLocal("pro", 2);
    for (const [nombre, db] of [
      ["Dueño", local.owner.db],
      ["Staff", local.staff.db],
      ["anon", anonClient()],
    ] as const) {
      const f = await db.rpc("admin_set_extra_branches", { p_actor: admin.id, p_org: local.id, p_quantity: 1, p_deactivate: [], p_reason: "x" });
      expect(f.error?.code, nombre).toBe("42501");
      const insertar = await db.from("subscription_addons").insert({ organization_id: local.id, addon_code: "extra_branch", extra_packs: 3 });
      expect(insertar.error, nombre).not.toBeNull();
      await db.from("addons").update({ price_cents: 1 }).eq("code", "extra_branch");
      await db.from("subscription_addons").update({ extra_packs: 3 }).eq("organization_id", local.id);
    }
    const sinCambios = (await service.from("addons").select("price_cents").eq("code", "extra_branch").single()).data;
    expect(sinCambios?.price_cents).toBe(1_200_000);
    expect(await contratos(local.id)).toEqual([]);
    expect(await tope(local)).toBe(2);
  });

  it("la acción genérica de add-ons se niega a tocar sucursales adicionales", async () => {
    const local = await crearLocal("pro", 2);
    const r = await setAddon(ctx(admin), { slug: local.slug, addon: "extra_branch", extraPacks: "3", endsOn: "", reason: "x" });
    expect(r).toEqual({ ok: false, error: "addon_has_own_action" });
    const fin = await service.rpc("admin_end_addon", { p_actor: admin.id, p_org: local.id, p_addon: "extra_branch", p_reason: "x" });
    expect(fin.error?.message).toBe("addon_has_own_action");
    expect(await contratos(local.id)).toEqual([]);
    expect(await auditoria(local.id)).toEqual([]);
  });

  it("la ficha del SuperAdmin trae la cantidad, el precio y las sucursales activas", async () => {
    const local = await crearLocal("pro", 2);
    expect((await poner(local, "1")).ok).toBe(true);
    const detalle = await getOrganizationDetail(ctx(admin), local.slug);
    if (!detalle.ok) throw new Error(detalle.error);
    expect(detalle.data.extraBranches).toMatchObject({
      allowedByPlan: true,
      quantity: 1,
      max: 3,
      priceCents: 1_200_000,
      currency: "ARS",
      planBranches: 2,
    });
    expect(detalle.data.extraBranches?.activeBranches.map((b) => b.slug)).toEqual(["s1", "s2"]);
    expect(detalle.data.addons.find((a) => a.code === "extra_branch")).toBeUndefined();
  });
});

describe("mora", () => {
  it("el cupo no cambia y las escrituras del Dueño siguen bloqueadas por org_can_write", async () => {
    const local = await crearLocal("pro", 2);
    expect((await poner(local, "1")).ok).toBe(true);
    await setSubscription(service, local.id, { finEnMs: -20 * DIA_MS }); // solo lectura
    expect(await tope(local)).toBe(3);
    const r = await local.owner.db.from("branches").insert({ organization_id: local.id, slug: "x", name: "X" });
    expect(r.error).not.toBeNull();
    expect(await activasDe(local.id)).toEqual(["s1", "s2"]);
  });
});
