import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSala } from "@/lib/sala/pending";
import { readBranchView, setBranchView } from "@/lib/sucursales/vista";
import {
  addMembership,
  anonClient,
  createOrg,
  createUser,
  DIA_MS,
  deleteOrg,
  deleteUser,
  serviceClient,
  setSubscription,
  sql,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * Vista por sucursal de cada persona (nivel C; ficha vista-por-sucursal, ADR 0034) contra el Supabase local. Es una PREFERENCIA:
 * cada quien guarda la suya (solo con sucursales activas de su local), la efectiva ignora lo que dejó de existir y vacío = todas;
 * la sala y el aviso push la siguen, y NO cambia lo que la persona puede leer ni atender.
 */

const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);
const endpointNuevo = () => `https://fcm.googleapis.com/fcm/send/rls-${randomUUID()}`;

let service: Db;
let owner: TestUser;
let staff: TestUser;
let ajeno: TestUser;
const orgs: string[] = [];
let contador = 0;

type Local = { id: string; centro: string; norte: string; vieja: string; tokenCentro: string; tokenNorte: string };

/** Un local Pro con Centro y Norte activas (una mesa en cada una) y una sucursal inactiva. */
async function nuevoLocal(): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-vista-${Date.now()}-${contador}`, "pro");
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 5 * DIA_MS });
  const ramas = await service
    .from("branches")
    .insert([
      { organization_id: id, slug: "centro", name: "Centro", is_active: true },
      { organization_id: id, slug: "norte", name: "Norte", is_active: true },
      { organization_id: id, slug: "vieja", name: "Vieja", is_active: false },
    ])
    .select("id, slug");
  if (ramas.error) throw new Error(ramas.error.message);
  const por = (slug: string) => ramas.data.find((r) => r.slug === slug)!.id;
  const mesas = await service
    .from("tables")
    .insert([
      { organization_id: id, branch_id: por("centro"), label: "Mesa 1" },
      { organization_id: id, branch_id: por("norte"), label: "Mesa 1" },
    ])
    .select("branch_id, qr_token");
  if (mesas.error) throw new Error(mesas.error.message);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return {
    id,
    centro: por("centro"),
    norte: por("norte"),
    vieja: por("vieja"),
    tokenCentro: mesas.data.find((m) => m.branch_id === por("centro"))!.qr_token,
    tokenNorte: mesas.data.find((m) => m.branch_id === por("norte"))!.qr_token,
  };
}

const guardar = (db: Db, org: string, ids: string[]) => db.rpc("set_my_branch_view", { p_org: org, p_branches: ids });
const vista = async (db: Db, org: string) => ((await db.rpc("my_branch_view", { p_org: org })).data ?? []) as string[];
const filasDeVista = (org: string) => Number(sql(`select count(*) from public.member_branch_views where organization_id = '${org}'`)[0][0]);

async function llamar(token: string, kind: "waiter" | "bill" = "waiter") {
  const { data, error } = await serviceClient().rpc("create_waiter_call", { p_token: token, p_kind: kind });
  expect(error).toBeNull();
  expect(data).toEqual({ status: "created" });
}

async function suscribir(db: Db, org: string) {
  const endpoint = endpointNuevo();
  const r = await db.rpc("register_push_subscription", { p_org: org, p_endpoint: endpoint, p_p256dh: P256DH, p_auth: AUTH });
  expect(r.data).toBe("ok");
  return endpoint;
}

/** Endpoints de los dispositivos a los que se avisaría del llamado pendiente de esa mesa. */
async function avisados(token: string) {
  const { data, error } = await service.rpc("push_targets_for_call", { p_token: token, p_kind: "waiter" });
  expect(error).toBeNull();
  const subs = (data as { subscriptions: { endpoint: string }[] } | null)?.subscriptions ?? [];
  return subs.map((s) => s.endpoint).sort();
}

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, ajeno] = await Promise.all([
    createUser(service, "vista-owner"),
    createUser(service, "vista-staff"),
    createUser(service, "vista-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, ajeno].map((u) => deleteUser(service, u)));
});

describe("guardar y leer la vista propia", () => {
  it("sin nada guardado se ve todo; cada persona guarda la suya sin tocar la de otra; vacío vuelve a «todas»", async () => {
    const l = await nuevoLocal();
    expect(await vista(owner.db, l.id)).toEqual([]);

    expect((await guardar(staff.db, l.id, [l.norte])).data).toBe("ok");
    expect(await vista(staff.db, l.id)).toEqual([l.norte]);
    expect(await vista(owner.db, l.id)).toEqual([]); // la del Dueño no cambió

    expect((await guardar(owner.db, l.id, [l.centro, l.norte])).data).toBe("ok");
    expect((await vista(owner.db, l.id)).sort()).toEqual([l.centro, l.norte].sort());
    expect(await vista(staff.db, l.id)).toEqual([l.norte]);

    expect((await guardar(staff.db, l.id, [])).data).toBe("ok");
    expect(await vista(staff.db, l.id)).toEqual([]);
    expect(filasDeVista(l.id)).toBe(2); // una fila por persona y local, no por cambio
  });

  it("rechaza sucursales de otro local, inactivas, inexistentes, repetidas o vacías de sentido; no cambia lo guardado", async () => {
    const l = await nuevoLocal();
    const otro = await nuevoLocal();
    expect((await guardar(staff.db, l.id, [l.centro])).data).toBe("ok");

    for (const malo of [[otro.centro], [l.vieja], [randomUUID()], [l.centro, l.centro], [l.centro, otro.norte]]) {
      expect((await guardar(staff.db, l.id, malo)).data, JSON.stringify(malo)).toBe("invalid");
    }
    expect(await vista(staff.db, l.id)).toEqual([l.centro]);
  });

  it("solo un miembro del local la guarda o la lee; anon no puede llamar a las funciones", async () => {
    const l = await nuevoLocal();

    expect((await guardar(ajeno.db, l.id, [l.centro])).data).toBe("unavailable");
    expect(await vista(ajeno.db, l.id)).toEqual([]);
    expect(filasDeVista(l.id)).toBe(0);

    expect((await anonClient().rpc("set_my_branch_view", { p_org: l.id, p_branches: [l.centro] })).error?.code).toBe("42501");
    expect((await anonClient().rpc("my_branch_view", { p_org: l.id })).error?.code).toBe("42501");
  });

  it("la tabla no se toca por la API (ni la propia persona ni service_role)", async () => {
    const l = await nuevoLocal();
    await guardar(staff.db, l.id, [l.norte]);
    for (const db of [anonClient(), owner.db, staff.db, service]) {
      expect((await db.from("member_branch_views").select("*")).error?.code).toBe("42501");
      expect((await db.from("member_branch_views").update({ branch_ids: [] }).eq("organization_id", l.id)).error?.code).toBe("42501");
    }
  });

  it("la vista efectiva ignora sucursales desactivadas o borradas y, si no queda ninguna, vuelve a «todas»", async () => {
    const l = await nuevoLocal();
    await guardar(staff.db, l.id, [l.centro, l.norte]);

    await service.from("branches").update({ is_active: false }).eq("id", l.norte);
    expect(await vista(staff.db, l.id)).toEqual([l.centro]);
    await service.from("branches").update({ is_active: false }).eq("id", l.centro);
    expect(await vista(staff.db, l.id)).toEqual([]); // nadie se queda sin ver nada
    await service.from("branches").update({ is_active: true }).eq("id", l.norte);
    expect(await vista(staff.db, l.id)).toEqual([l.norte]); // al reactivarse, vuelve a contar
  });

  it("quitar a la persona del local borra su vista", async () => {
    const l = await nuevoLocal();
    await guardar(staff.db, l.id, [l.norte]);
    expect(filasDeVista(l.id)).toBe(1);

    await service.from("memberships").delete().eq("organization_id", l.id).eq("user_id", staff.id);

    expect(filasDeVista(l.id)).toBe(0);
  });
});

describe("el aviso push sigue la vista", () => {
  async function conSuscripciones() {
    const l = await nuevoLocal();
    const dueno = await suscribir(owner.db, l.id);
    const personal = await suscribir(staff.db, l.id);
    await llamar(l.tokenCentro);
    await llamar(l.tokenNorte);
    return { l, dueno, personal };
  }

  it("sin vista avisa a todos; con vista solo a quien mira la sucursal de la mesa (o todas)", async () => {
    const { l, dueno, personal } = await conSuscripciones();
    expect(await avisados(l.tokenCentro)).toEqual([dueno, personal].sort());
    expect(await avisados(l.tokenNorte)).toEqual([dueno, personal].sort());

    await guardar(staff.db, l.id, [l.norte]);
    expect(await avisados(l.tokenCentro)).toEqual([dueno]); // el Personal eligió solo Norte
    expect(await avisados(l.tokenNorte)).toEqual([dueno, personal].sort());

    await guardar(owner.db, l.id, [l.centro]);
    expect(await avisados(l.tokenCentro)).toEqual([dueno]);
    expect(await avisados(l.tokenNorte)).toEqual([personal]);

    await guardar(staff.db, l.id, [l.centro, l.norte]);
    expect(await avisados(l.tokenCentro)).toEqual([dueno, personal].sort());
    await guardar(staff.db, l.id, []);
    expect(await avisados(l.tokenCentro)).toEqual([dueno, personal].sort());
  });

  it("ante la duda avisa: si ninguna de las sucursales elegidas sigue activa, se avisa de todo", async () => {
    const { l, dueno, personal } = await conSuscripciones();
    await guardar(staff.db, l.id, [l.norte]);
    expect(await avisados(l.tokenCentro)).toEqual([dueno]);

    await service.from("branches").update({ is_active: false }).eq("id", l.norte);

    expect(await avisados(l.tokenCentro)).toEqual([dueno, personal].sort());
  });

  it("la vista de un local no afecta al aviso de otro, y nunca se avisa a quien no es miembro", async () => {
    const { l, dueno, personal } = await conSuscripciones();
    const otro = await nuevoLocal();
    await guardar(staff.db, otro.id, [otro.norte]); // elige en OTRO local
    expect(await avisados(l.tokenCentro)).toEqual([dueno, personal].sort());

    await service.from("memberships").delete().eq("organization_id", l.id).eq("user_id", staff.id);
    expect(await avisados(l.tokenCentro)).toEqual([dueno]);
  });
});

describe("la sala sigue la vista (pero no es un permiso)", () => {
  it("lista y cuenta según lo que mira cada persona; multiBranch sigue siendo del local", async () => {
    const l = await nuevoLocal();
    await llamar(l.tokenCentro);
    await llamar(l.tokenNorte, "bill");

    const todo = await loadSala(owner.db, l.id);
    expect(todo.calls.map((c) => c.branchName).sort()).toEqual(["Centro", "Norte"]);
    expect(todo).toMatchObject({ view: [], othersPending: 0, multiBranch: true });
    expect(todo.branches.map((b) => b.name).sort()).toEqual(["Centro", "Norte"]); // la inactiva no figura

    await guardar(staff.db, l.id, [l.norte]);
    const norte = await loadSala(staff.db, l.id);
    expect(norte.calls.map((c) => [c.branchName, c.kind])).toEqual([["Norte", "bill"]]);
    expect(norte).toMatchObject({ view: [l.norte], othersPending: 1, multiBranch: true });
    expect((await loadSala(owner.db, l.id)).calls).toHaveLength(2); // el Dueño no cambió

    await setBranchView(staff.db, l.id, []);
    expect((await loadSala(staff.db, l.id)).calls).toHaveLength(2);
    expect(await readBranchView(staff.db, l.id)).toEqual([]);
  });

  it("si lo elegido se desactiva, la sala vuelve a mostrar todo", async () => {
    const l = await nuevoLocal();
    await llamar(l.tokenCentro);
    await llamar(l.tokenNorte);
    await guardar(staff.db, l.id, [l.norte]);
    expect((await loadSala(staff.db, l.id)).calls).toHaveLength(1);

    await service.from("branches").update({ is_active: false }).eq("id", l.norte);

    const sala = await loadSala(staff.db, l.id);
    expect(sala.view).toEqual([]);
    expect(sala.calls.map((c) => c.branchName)).toEqual(["Centro"]); // la sucursal inactiva sale de la sala, como siempre
    expect(sala.othersPending).toBe(0);
  });

  it("elegir sucursal no cambia lo que se puede leer ni atender: por la API el Personal sigue leyendo y atendiendo todo", async () => {
    const l = await nuevoLocal();
    await llamar(l.tokenCentro);
    await guardar(staff.db, l.id, [l.norte]);

    const leidos = await staff.db.from("waiter_calls").select("id").eq("organization_id", l.id);
    expect(leidos.data).toHaveLength(1); // de Centro, que no mira
    const atendido = await staff.db.from("waiter_calls").update({ status: "attended" }).eq("id", leidos.data![0].id).select("id");
    expect(atendido.data).toHaveLength(1);
  });

  it("un local con una sola sucursal no lee la vista: view vacío y sin cambios", async () => {
    contador += 1;
    const id = await createOrg(service, `tt-vista-una-${Date.now()}-${contador}`, "pro");
    orgs.push(id);
    await setSubscription(service, id, { finEnMs: 5 * DIA_MS });
    const rama = await service.from("branches").insert({ organization_id: id, slug: "unica", name: "Única", is_active: true }).select("id").single();
    const mesa = await service.from("tables").insert({ organization_id: id, branch_id: rama.data!.id, label: "Mesa 1" }).select("qr_token").single();
    await addMembership(service, staff, id, "staff");
    await llamar(mesa.data!.qr_token);

    const sala = await loadSala(staff.db, id);

    expect(sala).toMatchObject({ multiBranch: false, view: [], othersPending: 0 });
    expect(sala.calls).toHaveLength(1);
  });
});
