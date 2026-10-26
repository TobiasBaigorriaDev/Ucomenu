import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMesas } from "@/lib/sala/mesas-loader";
import { loadSala } from "@/lib/sala/pending";
import {
  addMembership,
  createCategory,
  createOrg,
  createUser,
  DIA_MS,
  deleteOrg,
  deleteUser,
  serviceClient,
  setSubscription,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * Personal por sucursal, SOLO PANTALLA (ficha personal-por-sucursal). Un Staff o cocinero con sucursales asignadas ve en pantalla
 * (vista efectiva, Mesas, Sala, Cocina y avisos push) únicamente esas; el Dueño nunca se restringe; si todas las asignadas se
 * desactivan no se ve nada. NO cambia RLS ni las funciones que escriben: eso es el ítem [C] del tablero.
 */

const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);
const NINGUNA = "00000000-0000-0000-0000-000000000000";

let service: Db;
let owner: TestUser;
let staff: TestUser;
let cook: TestUser;
const orgs: string[] = [];
let contador = 0;

type Local = { id: string; centro: string; norte: string; mesaCentro: string; mesaNorte: string; tokenCentro: string; tokenNorte: string; producto: string };

/** Un local Pro con Centro y Norte (una mesa y un pedido abierto en cada una), un Dueño, un Staff y un cocinero. */
async function nuevoLocal(): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-personal-${Date.now()}-${contador}`, "pro");
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const ramas = await service
    .from("branches")
    .insert([
      { organization_id: id, slug: "centro", name: "Centro" },
      { organization_id: id, slug: "norte", name: "Norte" },
    ])
    .select("id, slug");
  if (ramas.error) throw new Error(ramas.error.message);
  const por = (slug: string) => ramas.data.find((r) => r.slug === slug)!.id;
  const mesas = await service
    .from("tables")
    .insert([
      { organization_id: id, branch_id: por("centro"), label: "Mesa C" },
      { organization_id: id, branch_id: por("norte"), label: "Mesa N" },
    ])
    .select("id, branch_id, qr_token");
  if (mesas.error) throw new Error(mesas.error.message);
  const category = await createCategory(service, id, "Platos");
  const plato = await service.from("products").insert({ organization_id: id, category_id: category, name: "Bife", price_cents: 10000 }).select("id").single();
  if (plato.error) throw new Error(plato.error.message);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  await addMembership(service, cook, id, "cook");

  const mesa = (branch: string) => mesas.data.find((m) => m.branch_id === branch)!;
  const local: Local = {
    id,
    centro: por("centro"),
    norte: por("norte"),
    mesaCentro: mesa(por("centro")).id,
    mesaNorte: mesa(por("norte")).id,
    tokenCentro: mesa(por("centro")).qr_token,
    tokenNorte: mesa(por("norte")).qr_token,
    producto: plato.data.id,
  };
  for (const [branch, table] of [[local.centro, local.mesaCentro], [local.norte, local.mesaNorte]]) {
    const r = await owner.db.rpc("add_order_item", { p_branch: branch, p_table: table, p_product: local.producto, p_quantity: 1, p_client_key: randomUUID() } as never);
    expect(r.error).toBeNull();
  }
  return local;
}

/** Asigna sucursales (vacío = ninguna) como lo hace el servidor desde Personal. */
async function asignar(org: string, user: TestUser, branches: string[]) {
  const r = await service.from("memberships").update({ assigned_branch_ids: branches }).eq("organization_id", org).eq("user_id", user.id);
  expect(r.error).toBeNull();
}

const acceso = async (db: Db, org: string) => (await db.rpc("my_branch_access", { p_org: org })).data as { view: string[]; assigned: string[] };
const ramasCocina = async (db: Db, org: string) => ((await db.rpc("kitchen_branches", { p_org: org })).data as { id: string }[]).map((b) => b.id).sort();
const pedidosCocina = async (db: Db, org: string, branch: string | null = null) => {
  const r = await db.rpc("kitchen_orders", { p_org: org, p_branch: branch } as never);
  expect(r.error).toBeNull();
  return ((r.data as { orders: { branch_id: string }[] }).orders ?? []).map((o) => o.branch_id).sort();
};

async function llamar(token: string) {
  const { data, error } = await service.rpc("create_waiter_call", { p_token: token, p_kind: "waiter" });
  expect(error).toBeNull();
  expect(data).toEqual({ status: "created" });
}
async function suscribir(db: Db, org: string) {
  const endpoint = `https://fcm.googleapis.com/fcm/send/rls-${randomUUID()}`;
  const r = await db.rpc("register_push_subscription", { p_org: org, p_endpoint: endpoint, p_p256dh: P256DH, p_auth: AUTH });
  expect(r.data).toBe("ok");
  return endpoint;
}
async function avisados(token: string) {
  const { data, error } = await service.rpc("push_targets_for_call", { p_token: token, p_kind: "waiter" });
  expect(error).toBeNull();
  return ((data as { subscriptions: { endpoint: string }[] } | null)?.subscriptions ?? []).map((s) => s.endpoint).sort();
}

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, cook] = await Promise.all([createUser(service, "personal-owner"), createUser(service, "personal-staff"), createUser(service, "personal-cook")]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, cook].map((u) => deleteUser(service, u)));
});

describe("sin asignación todo sigue igual", () => {
  it("Staff, cocinero y Dueño ven todas las sucursales", async () => {
    const l = await nuevoLocal();
    expect(await acceso(staff.db, l.id)).toEqual({ view: [], assigned: [] });
    expect(await ramasCocina(cook.db, l.id)).toEqual([l.centro, l.norte].sort());
    expect(await pedidosCocina(cook.db, l.id)).toEqual([l.centro, l.norte].sort());
  });
});

describe("Staff con sucursales asignadas", () => {
  it("la vista efectiva y las sucursales asignadas son las suyas; solo puede elegir entre ellas", async () => {
    const l = await nuevoLocal();
    await asignar(l.id, staff, [l.centro]);
    expect(await acceso(staff.db, l.id)).toEqual({ view: [l.centro], assigned: [l.centro] });

    expect((await staff.db.rpc("set_my_branch_view", { p_org: l.id, p_branches: [l.norte] })).data).toBe("invalid");
    expect((await staff.db.rpc("set_my_branch_view", { p_org: l.id, p_branches: [l.centro, l.norte] })).data).toBe("invalid");
    expect((await staff.db.rpc("set_my_branch_view", { p_org: l.id, p_branches: [l.centro] })).data).toBe("ok");
    // «Todas» (vacío) sigue siendo todas LAS ASIGNADAS.
    expect((await staff.db.rpc("set_my_branch_view", { p_org: l.id, p_branches: [] })).data).toBe("ok");
    expect(await acceso(staff.db, l.id)).toEqual({ view: [l.centro], assigned: [l.centro] });
  });

  it("una preferencia vieja fuera de lo asignado se ignora", async () => {
    const l = await nuevoLocal();
    expect((await staff.db.rpc("set_my_branch_view", { p_org: l.id, p_branches: [l.norte] })).data).toBe("ok");
    await asignar(l.id, staff, [l.centro]);
    expect((await acceso(staff.db, l.id)).view).toEqual([l.centro]);
  });

  it("con dos asignadas elige una de las dos", async () => {
    const l = await nuevoLocal();
    await asignar(l.id, staff, [l.centro, l.norte]);
    expect((await staff.db.rpc("set_my_branch_view", { p_org: l.id, p_branches: [l.norte] })).data).toBe("ok");
    expect((await acceso(staff.db, l.id)).view).toEqual([l.norte]);
  });

  it("Mesas y Sala solo muestran sus sucursales, sin nombres ni conteos de las ajenas", async () => {
    const l = await nuevoLocal();
    await llamar(l.tokenCentro);
    await llamar(l.tokenNorte);
    await asignar(l.id, staff, [l.centro]);

    const mesas = await loadMesas(staff.db, l.id);
    expect(mesas.mesas.map((m) => m.tableLabel)).toEqual(["Mesa C"]);
    expect(mesas.branches.map((b) => b.id)).toEqual([l.centro]);
    expect(mesas.othersPending).toBe(0);

    const sala = await loadSala(staff.db, l.id);
    expect(sala.calls.map((c) => c.tableLabel)).toEqual(["Mesa C"]);
    expect(sala.branches.map((b) => b.id)).toEqual([l.centro]);
    expect(sala.othersPending).toBe(0);

    // El Dueño, con la misma columna cargada, no se restringe.
    await asignar(l.id, owner, [l.centro]);
    expect((await loadMesas(owner.db, l.id)).mesas).toHaveLength(2);
    expect((await acceso(owner.db, l.id)).assigned).toEqual([]);
  });

  it("si todas las asignadas se desactivan, no ve nada (nunca todas)", async () => {
    const l = await nuevoLocal();
    await asignar(l.id, staff, [l.norte]);
    const off = await service.from("branches").update({ is_active: false }).eq("id", l.norte);
    expect(off.error).toBeNull();
    expect(await acceso(staff.db, l.id)).toEqual({ view: [NINGUNA], assigned: [NINGUNA] });
    const mesas = await loadMesas(staff.db, l.id);
    expect(mesas.mesas).toEqual([]);
    expect(mesas.branches).toEqual([]);
  });

  it("no puede cambiar sus propias sucursales asignadas", async () => {
    const l = await nuevoLocal();
    await asignar(l.id, staff, [l.centro]);
    await staff.db.from("memberships").update({ assigned_branch_ids: [] }).eq("organization_id", l.id).eq("user_id", staff.id);
    const fila = await service.from("memberships").select("assigned_branch_ids").eq("organization_id", l.id).eq("user_id", staff.id).single();
    expect(fila.data?.assigned_branch_ids).toEqual([l.centro]);
  });
});

describe("cocinero con sucursales asignadas", () => {
  it("solo ve las sucursales y los pedidos de las suyas", async () => {
    const l = await nuevoLocal();
    await asignar(l.id, cook, [l.centro]);
    expect(await ramasCocina(cook.db, l.id)).toEqual([l.centro]);
    expect(await pedidosCocina(cook.db, l.id)).toEqual([l.centro]);
    // Pedir expresamente la sucursal ajena no devuelve nada.
    expect(await pedidosCocina(cook.db, l.id, l.norte)).toEqual([]);
  });

  it("la carta de cocina de una sucursal ajena no se abre; la propia sí", async () => {
    const l = await nuevoLocal();
    await asignar(l.id, cook, [l.centro]);
    expect((await cook.db.rpc("kitchen_menu", { p_org: l.id, p_branch: l.norte })).error?.message).toContain("branch_not_found");
    expect((await cook.db.rpc("kitchen_menu", { p_org: l.id, p_branch: l.centro })).error).toBeNull();
  });

  it("Dueño y Staff sin asignación leen la cocina completa", async () => {
    const l = await nuevoLocal();
    await asignar(l.id, cook, [l.centro]);
    expect(await pedidosCocina(owner.db, l.id)).toEqual([l.centro, l.norte].sort());
    expect(await pedidosCocina(staff.db, l.id)).toEqual([l.centro, l.norte].sort());
  });
});

describe("avisos push", () => {
  it("un Staff asignado a Centro no recibe los llamados de Norte; el Dueño y el Staff sin asignación, sí", async () => {
    const l = await nuevoLocal();
    const otroStaff = await createUser(service, "personal-staff-2");
    try {
      await addMembership(service, otroStaff, l.id, "staff");
      const delStaff = await suscribir(staff.db, l.id);
      const delOtro = await suscribir(otroStaff.db, l.id);
      const delDueno = await suscribir(owner.db, l.id);

      await asignar(l.id, staff, [l.centro]);
      await llamar(l.tokenNorte);
      expect(await avisados(l.tokenNorte)).toEqual([delOtro, delDueno].sort());

      await llamar(l.tokenCentro);
      expect(await avisados(l.tokenCentro)).toEqual([delStaff, delOtro, delDueno].sort());
    } finally {
      await deleteUser(service, otroStaff);
    }
  });

  it("una preferencia vieja en otra sucursal no deja sin aviso al Staff asignado", async () => {
    const l = await nuevoLocal();
    const antes = await suscribir(staff.db, l.id);
    expect((await staff.db.rpc("set_my_branch_view", { p_org: l.id, p_branches: [l.norte] })).data).toBe("ok");
    await asignar(l.id, staff, [l.centro]);
    await llamar(l.tokenCentro);
    expect(await avisados(l.tokenCentro)).toContain(antes);
  });
});
