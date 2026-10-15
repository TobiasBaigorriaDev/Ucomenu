import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  type Db,
  type TestUser,
} from "./helpers";
import { attendCall, loadSala } from "@/lib/sala/pending";

/**
 * Módulo del panel de sala contra el Supabase local: qué lista `loadSala` (con el cliente de la persona) y qué
 * resultado da `attendCall` en cada caso, sin falsos éxitos.
 */

const MIN = 60 * 1000;

let service: Db;
let owner: TestUser;
let staff: TestUser;
let ajeno: TestUser;
const orgs: string[] = [];

type Local = { id: string; branches: { id: string; name: string }[]; tables: { id: string; label: string; token: string; branch: string }[] };

async function nuevoLocal(slug: string, opciones: { plan?: "basic" | "pro"; sucursales?: number; miembros?: boolean } = {}): Promise<Local> {
  const id = await createOrg(service, slug, "pro");
  orgs.push(id);
  const nombres = ["Centro", "Norte"].slice(0, opciones.sucursales ?? 1);
  const branches = [];
  for (const [i, name] of nombres.entries()) {
    const b = await service.from("branches").insert({ organization_id: id, slug: `s${i}`, name }).select("id, name").single();
    if (b.error) throw new Error(b.error.message);
    branches.push(b.data);
  }
  const tables = [];
  for (const b of branches) {
    for (const label of ["Mesa 1", "Mesa 2", "Mesa 10"]) {
      const t = await service.from("tables").insert({ organization_id: id, branch_id: b.id, label }).select("id, label, qr_token").single();
      if (t.error) throw new Error(t.error.message);
      tables.push({ id: t.data.id, label: t.data.label, token: t.data.qr_token, branch: b.id });
    }
  }
  if ((opciones.plan ?? "pro") !== "pro") await setSubscription(service, id, { plan: opciones.plan! });
  if (opciones.miembros !== false) {
    await addMembership(service, owner, id, "owner");
    await addMembership(service, staff, id, "staff");
  }
  return { id, branches, tables };
}

async function llamar(token: string, kind: "waiter" | "bill") {
  const { data } = await anonClient().rpc("create_waiter_call", { p_token: token, p_kind: kind });
  expect(data).toEqual({ status: "created" });
}

async function envejecer(local: Local, tableId: string, ms: number) {
  await service.from("waiter_calls").update({ created_at: new Date(Date.now() - ms).toISOString() }).eq("organization_id", local.id).eq("table_id", tableId);
}

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, ajeno] = await Promise.all([
    createUser(service, "salamod-owner"),
    createUser(service, "salamod-staff"),
    createUser(service, "salamod-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, ajeno].map((u) => deleteUser(service, u)));
});

describe("loadSala", () => {
  it("lista los pendientes con mesa, tipo y sucursal, el más viejo primero, y la hora del servidor", async () => {
    const local = await nuevoLocal("tt-salamod-lista", { sucursales: 2 });
    const [m1, m2, m10] = local.tables.filter((t) => t.branch === local.branches[0].id);
    const norte = local.tables.find((t) => t.branch === local.branches[1].id)!;

    await llamar(m10.token, "waiter");
    await llamar(m1.token, "bill");
    await llamar(m2.token, "waiter");
    await llamar(norte.token, "waiter");
    await envejecer(local, m10.id, 4 * MIN); // el más viejo
    await envejecer(local, m1.id, 2 * MIN);

    const antes = Date.now();
    const sala = await loadSala(staff.db, local.id);
    expect(Math.abs(Date.parse(sala.serverNow) - antes)).toBeLessThan(10_000);
    expect(sala.enabled).toBe(true);
    expect(sala.multiBranch).toBe(true);
    expect(sala.calls.map((c) => `${c.tableLabel}:${c.kind}:${c.branchName}`)).toEqual([
      "Mesa 10:waiter:Centro",
      "Mesa 1:bill:Centro",
      expect.stringMatching(/^Mesa 1:waiter:Norte$|^Mesa 2:waiter:Centro$/),
      expect.stringMatching(/^Mesa 1:waiter:Norte$|^Mesa 2:waiter:Centro$/),
    ]);
    // Idéntico para el Dueño.
    expect((await loadSala(owner.db, local.id)).calls).toHaveLength(4);
  });

  it("lista cuándo abrió la carta el comensal cuando se sabe, y null cuando no", async () => {
    const local = await nuevoLocal("tt-salamod-visita");
    const [a, b] = local.tables;
    const hace3h = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect((await anonClient().rpc("create_waiter_call", { p_token: a.token, p_kind: "waiter", p_visit_started_at: hace3h })).data).toEqual({ status: "created" });
    await llamar(b.token, "waiter"); // sin dato (p. ej. un llamado hecho directo por la API)
    const sala = await loadSala(staff.db, local.id);
    const porMesa = Object.fromEntries(sala.calls.map((c) => [c.tableLabel, c.visitStartedAt]));
    expect(Date.parse(porMesa[a.label]!)).toBe(Date.parse(hace3h));
    expect(porMesa[b.label]).toBeNull();
  });

  it("una sola sucursal: multiBranch es falso", async () => {
    const local = await nuevoLocal("tt-salamod-una");
    await llamar(local.tables[0].token, "waiter");
    const sala = await loadSala(owner.db, local.id);
    expect(sala.multiBranch).toBe(false);
    expect(sala.calls).toHaveLength(1);
  });

  it("no lista atendidos, vencidos ni los de 30 minutos o más; uno de 29 sí", async () => {
    const local = await nuevoLocal("tt-salamod-filtro", { sucursales: 2 });
    const [a, b, c, d] = local.tables;
    for (const t of [a, b, c, d]) await llamar(t.token, "waiter");
    await service.from("waiter_calls").update({ status: "attended" }).eq("table_id", a.id);
    await service.from("waiter_calls").update({ status: "expired" }).eq("table_id", b.id);
    await envejecer(local, c.id, 31 * MIN); // sigue pending en la base pero no se muestra
    await envejecer(local, d.id, 29 * MIN);

    const sala = await loadSala(staff.db, local.id);
    expect(sala.calls.map((x) => x.tableLabel)).toEqual([d.label]);
    // El de 31 minutos sigue pending en la base: la sala no lo vence ni lo atiende.
    expect((await service.from("waiter_calls").select("status").eq("table_id", c.id).single()).data?.status).toBe("pending");
  });

  it("plan Básico, solo lectura y suspendida: deshabilitada y sin lista", async () => {
    const local = await nuevoLocal("tt-salamod-apagado");
    await llamar(local.tables[0].token, "waiter");

    await setSubscription(service, local.id, { plan: "basic" });
    expect(await loadSala(owner.db, local.id)).toMatchObject({ enabled: false, calls: [] });
    await setSubscription(service, local.id, { plan: "pro" });

    for (const dias of [10, 20]) {
      await setSubscription(service, local.id, { finEnMs: -dias * DIA_MS });
      expect(await loadSala(staff.db, local.id), `a ${dias} días`).toMatchObject({ enabled: false, calls: [] });
    }
    await setSubscription(service, local.id, { finEnMs: -3 * DIA_MS }); // gracia
    expect((await loadSala(staff.db, local.id)).calls).toHaveLength(1);
  });

  it("solo ve lo de la organización pedida, aunque la persona sea miembro de otra", async () => {
    const a = await nuevoLocal("tt-salamod-a", { miembros: false });
    const b = await nuevoLocal("tt-salamod-b", { miembros: false });
    await addMembership(service, ajeno, a.id, "staff");
    await addMembership(service, ajeno, b.id, "staff");
    await llamar(a.tables[0].token, "waiter");
    await llamar(b.tables[1].token, "bill");

    const deA = await loadSala(ajeno.db, a.id);
    const deB = await loadSala(ajeno.db, b.id);
    expect(deA.calls.map((c) => c.tableLabel)).toEqual(["Mesa 1"]);
    expect(deB.calls.map((c) => `${c.tableLabel}:${c.kind}`)).toEqual(["Mesa 2:bill"]);
  });

  it("quien no es miembro no ve nada de otro local (RLS)", async () => {
    const local = await nuevoLocal("tt-salamod-privado");
    await llamar(local.tables[0].token, "waiter");
    const sala = await loadSala(ajeno.db, local.id);
    expect(sala.calls).toEqual([]); // no es miembro: org_entitlements devuelve null y nada se lista
    expect(sala.enabled).toBe(false);
  });
});

describe("attendCall", () => {
  it("atiende, y después responde «ya atendido» sin cambiar quién lo atendió", async () => {
    const local = await nuevoLocal("tt-salamod-atiende");
    await llamar(local.tables[0].token, "waiter");
    const [{ id }] = (await loadSala(owner.db, local.id)).calls;

    expect(await attendCall(owner.db, local.id, id)).toEqual({ status: "attended" });
    expect(await attendCall(staff.db, local.id, id)).toEqual({ status: "already_attended" });
    const fila = (await service.from("waiter_calls").select("status, attended_by").eq("id", id).single()).data;
    expect(fila).toEqual({ status: "attended", attended_by: owner.id });
    expect((await loadSala(staff.db, local.id)).calls).toEqual([]);
  });

  it("dos personas a la vez: una atiende y la otra recibe «ya atendido»", async () => {
    const local = await nuevoLocal("tt-salamod-carrera");
    await llamar(local.tables[0].token, "bill");
    const [{ id }] = (await loadSala(owner.db, local.id)).calls;
    const resultados = await Promise.all([attendCall(owner.db, local.id, id), attendCall(staff.db, local.id, id)]);
    expect(resultados.map((r) => r.status).sort()).toEqual(["already_attended", "attended"]);
  });

  it("uno vencido por la función pública responde «expired»", async () => {
    const local = await nuevoLocal("tt-salamod-vencido");
    await llamar(local.tables[0].token, "waiter");
    const [{ id }] = (await loadSala(owner.db, local.id)).calls;
    await service.from("waiter_calls").update({ status: "expired" }).eq("id", id);
    expect(await attendCall(owner.db, local.id, id)).toEqual({ status: "expired" });
  });

  it("uno de 30 minutos o más, aunque siga `pending`, responde «expired» y no se atiende; uno de 29 sí", async () => {
    const local = await nuevoLocal("tt-salamod-viejo");
    await llamar(local.tables[0].token, "waiter");
    await llamar(local.tables[1].token, "bill");
    const [uno, otro] = (await loadSala(owner.db, local.id)).calls;
    await service.from("waiter_calls").update({ created_at: new Date(Date.now() - 31 * MIN).toISOString() }).eq("id", uno.id);
    await service.from("waiter_calls").update({ created_at: new Date(Date.now() - 29 * MIN).toISOString() }).eq("id", otro.id);

    expect(await attendCall(owner.db, local.id, uno.id)).toEqual({ status: "expired" });
    expect((await service.from("waiter_calls").select("status, attended_by").eq("id", uno.id).single()).data).toEqual({ status: "pending", attended_by: null });
    expect(await attendCall(staff.db, local.id, otro.id)).toEqual({ status: "attended" });
  });

  it("sin plan o sin cuenta al día responde «unavailable» y no cambia nada (sin falso éxito)", async () => {
    const local = await nuevoLocal("tt-salamod-bloqueado");
    await llamar(local.tables[0].token, "waiter");
    const [{ id }] = (await loadSala(owner.db, local.id)).calls;

    await setSubscription(service, local.id, { finEnMs: -10 * DIA_MS });
    expect(await attendCall(staff.db, local.id, id)).toEqual({ status: "unavailable" });
    await setSubscription(service, local.id, { finEnMs: -20 * DIA_MS });
    expect(await attendCall(owner.db, local.id, id)).toEqual({ status: "unavailable" });
    await setSubscription(service, local.id, { finEnMs: 5 * DIA_MS });
    await setSubscription(service, local.id, { plan: "basic" });
    expect(await attendCall(owner.db, local.id, id)).toEqual({ status: "unavailable" });
    expect((await service.from("waiter_calls").select("status").eq("id", id).single()).data?.status).toBe("pending");
  });

  it("ids inválidos, inexistentes o de otro local son «no encontrado» y no tocan nada", async () => {
    const a = await nuevoLocal("tt-salamod-id-a");
    const b = await nuevoLocal("tt-salamod-id-b");
    await llamar(b.tables[0].token, "waiter");
    const [{ id: deB }] = (await loadSala(owner.db, b.id)).calls;

    for (const malo of ["no-es-un-id", "", null, undefined, 5, `${deB}'; --`]) {
      expect(await attendCall(owner.db, a.id, malo), String(malo)).toEqual({ status: "not_found" });
    }
    expect(await attendCall(owner.db, a.id, crypto.randomUUID())).toEqual({ status: "not_found" });
    // Con el local A y el id de un llamado del local B (misma persona, miembro de ambos): no existe para A.
    expect(await attendCall(owner.db, a.id, deB)).toEqual({ status: "not_found" });
    expect((await service.from("waiter_calls").select("status").eq("id", deB).single()).data?.status).toBe("pending");

    // Una persona sin membresía en B no lo atiende ni siquiera pidiéndolo con el local correcto.
    const ajenoAtiende = await attendCall(ajeno.db, b.id, deB);
    expect(ajenoAtiende.status).not.toBe("attended");
    expect((await service.from("waiter_calls").select("status").eq("id", deB).single()).data?.status).toBe("pending");
  });
});
