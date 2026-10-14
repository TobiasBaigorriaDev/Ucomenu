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

/**
 * Panel de sala (ficha panel-de-sala): quién puede atender un llamado y cómo. Solo `status` pending → attended,
 * solo miembros de esa organización, solo con el plan y la cuenta al día; la hora y la persona las pone la base.
 */

const MIN = 60 * 1000;

let service: Db;
let owner: TestUser;
let staff: TestUser;
let ajeno: TestUser;
const orgs: string[] = [];

type Local = { id: string; branch: string; table: string; token: string };

async function nuevoLocal(slug: string, plan: "basic" | "pro" = "pro"): Promise<Local> {
  const id = await createOrg(service, slug, plan);
  orgs.push(id);
  const branch = await service.from("branches").insert({ organization_id: id, slug: "uno", name: "Uno" }).select("id").single();
  if (branch.error) throw new Error(branch.error.message);
  const table = await service
    .from("tables")
    .insert({ organization_id: id, branch_id: branch.data.id, label: "Mesa 1" })
    .select("id, qr_token")
    .single();
  if (table.error) throw new Error(table.error.message);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, branch: branch.data.id, table: table.data.id, token: table.data.qr_token };
}

/** Un llamado pendiente, creado por la única puerta (la función pública). */
async function llamado(local: Local, kind: "waiter" | "bill" = "waiter"): Promise<string> {
  const { data, error } = await anonClient().rpc("create_waiter_call", { p_token: local.token, p_kind: kind });
  expect(error).toBeNull();
  expect(data).toEqual({ status: "created" });
  const fila = await service.from("waiter_calls").select("id").eq("table_id", local.table).eq("kind", kind).eq("status", "pending").single();
  return fila.data!.id;
}

const fila = async (id: string) => (await service.from("waiter_calls").select("*").eq("id", id).single()).data!;

const atender = (db: Db, id: string) => db.from("waiter_calls").update({ status: "attended" }).eq("id", id).select("id");

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, ajeno] = await Promise.all([
    createUser(service, "sala-owner"),
    createUser(service, "sala-staff"),
    createUser(service, "sala-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, ajeno].map((u) => deleteUser(service, u)));
});

describe("atender un llamado", () => {
  it("el Dueño y el Staff lo atienden; la hora y la persona las pone la base", async () => {
    const local = await nuevoLocal("tt-sala-atiende");
    for (const [usuario, kind] of [[owner, "waiter"], [staff, "bill"]] as const) {
      const id = await llamado(local, kind);
      const antes = Date.now();
      const r = await atender(usuario.db, id);
      expect(r.error).toBeNull();
      expect(r.data).toHaveLength(1);

      const despues = await fila(id);
      expect(despues.status).toBe("attended");
      expect(despues.attended_by).toBe(usuario.id);
      const hora = new Date(despues.attended_at!).getTime();
      expect(Math.abs(hora - antes)).toBeLessThan(10_000);
    }
  });

  it("no se puede atribuir la atención a otra persona ni cambiar la hora (solo hay permiso sobre status)", async () => {
    const local = await nuevoLocal("tt-sala-sin-falsear");
    const id = await llamado(local);

    for (const cambio of [
      { status: "attended", attended_by: owner.id },
      { status: "attended", attended_at: new Date(0).toISOString() },
      { attended_by: owner.id },
      { attended_at: new Date().toISOString() },
    ]) {
      const r = await staff.db.from("waiter_calls").update(cambio).eq("id", id).select("id");
      expect(r.error?.code, JSON.stringify(cambio)).toBe("42501");
    }
    expect((await fila(id)).status).toBe("pending");

    // Aun cuando atiende de verdad, el trigger pone SU id.
    expect((await atender(staff.db, id)).data).toHaveLength(1);
    expect((await fila(id)).attended_by).toBe(staff.id);
  });

  it("solo se puede cambiar status: ninguna otra columna es escribible", async () => {
    const local = await nuevoLocal("tt-sala-columnas");
    const id = await llamado(local);
    for (const cambio of [
      { kind: "bill" },
      { table_id: crypto.randomUUID() },
      { branch_id: crypto.randomUUID() },
      { organization_id: crypto.randomUUID() },
      { created_at: new Date(0).toISOString() },
      { client_key: "a".repeat(32) },
      { id: crypto.randomUUID() },
    ]) {
      const r = await owner.db.from("waiter_calls").update(cambio).eq("id", id).select("id");
      expect(r.error?.code, JSON.stringify(cambio)).toBe("42501");
    }
  });

  it("solo pending → attended: no vuelve a pendiente, no se marca expired, no se atiende dos veces", async () => {
    const local = await nuevoLocal("tt-sala-transiciones");
    const id = await llamado(local);

    expect((await owner.db.from("waiter_calls").update({ status: "expired" }).eq("id", id).select("id")).data ?? []).toHaveLength(0);
    expect((await fila(id)).status).toBe("pending");

    expect((await atender(owner.db, id)).data).toHaveLength(1);
    const primera = await fila(id);

    // Atendido: ni otra atención (cambia la persona), ni volver a pendiente, ni vencer.
    expect((await atender(staff.db, id)).data ?? []).toHaveLength(0);
    expect((await staff.db.from("waiter_calls").update({ status: "pending" }).eq("id", id).select("id")).data ?? []).toHaveLength(0);
    expect((await staff.db.from("waiter_calls").update({ status: "expired" }).eq("id", id).select("id")).data ?? []).toHaveLength(0);
    expect(await fila(id)).toMatchObject({ status: "attended", attended_by: primera.attended_by, attended_at: primera.attended_at });
  });

  it("dos personas que atienden a la vez: gana una sola", async () => {
    const local = await nuevoLocal("tt-sala-carrera");
    const id = await llamado(local);
    const [a, b] = await Promise.all([atender(owner.db, id), atender(staff.db, id)]);
    expect((a.data?.length ?? 0) + (b.data?.length ?? 0)).toBe(1);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    const final = await fila(id);
    expect([owner.id, staff.id]).toContain(final.attended_by);
  });

  it("tras atender, el tipo vuelve a poder llamarse (pasado el cooldown)", async () => {
    const local = await nuevoLocal("tt-sala-reabre");
    const id = await llamado(local);
    await atender(owner.db, id);
    // El índice único parcial ya no cuenta ese llamado; el cooldown sí hasta que pase.
    const { data } = await anonClient().rpc("create_waiter_call", { p_token: local.token, p_kind: "waiter" });
    expect((data as { status: string }).status).toBe("cooldown");
    await service.from("waiter_calls").update({ created_at: new Date(Date.now() - 61_000).toISOString() }).eq("id", id);
    const otra = await anonClient().rpc("create_waiter_call", { p_token: local.token, p_kind: "waiter" });
    expect(otra.data).toEqual({ status: "created" });
  });
});

describe("quién no puede atender", () => {
  it("otra organización, un anónimo y un usuario sin membresía: nada, y el llamado queda pendiente", async () => {
    const local = await nuevoLocal("tt-sala-ajeno");
    const id = await llamado(local);

    expect((await atender(ajeno.db, id)).data ?? []).toHaveLength(0);
    const anon = await atender(anonClient(), id);
    expect(anon.error?.code).toBe("42501");
    expect((await fila(id)).status).toBe("pending");

    // Es miembro de OTRA organización: tampoco puede atender uno ajeno.
    const otro = await nuevoLocal("tt-sala-ajeno-b");
    await addMembership(service, ajeno, otro.id, "staff");
    expect((await atender(ajeno.db, id)).data ?? []).toHaveLength(0);
    expect((await fila(id)).status).toBe("pending");
  });

  it("sin el plan o sin la cuenta al día, la base no deja atender", async () => {
    const local = await nuevoLocal("tt-sala-sin-plan");
    const id = await llamado(local);

    await setSubscription(service, local.id, { plan: "basic" });
    expect((await atender(owner.db, id)).data ?? []).toHaveLength(0);
    await setSubscription(service, local.id, { plan: "pro" });

    for (const dias of [10, 20]) {
      await setSubscription(service, local.id, { finEnMs: -dias * DIA_MS });
      expect((await atender(staff.db, id)).data ?? [], `a ${dias} días`).toHaveLength(0);
    }
    expect((await fila(id)).status).toBe("pending");

    // En gracia sí; y con todo al día también.
    await setSubscription(service, local.id, { finEnMs: -3 * DIA_MS });
    expect((await atender(staff.db, id)).data).toHaveLength(1);
  });

  it("nadie inserta ni borra por la API; los miembros siguen leyendo solo lo de su organización", async () => {
    const a = await nuevoLocal("tt-sala-lee-a");
    const b = await nuevoLocal("tt-sala-lee-b");
    await addMembership(service, ajeno, b.id, "owner");
    const idA = await llamado(a);
    await llamado(b, "bill");

    const nuevo = { organization_id: a.id, branch_id: a.branch, table_id: a.table, kind: "bill" };
    expect((await staff.db.from("waiter_calls").insert(nuevo)).error?.code).toBe("42501");
    expect((await staff.db.from("waiter_calls").delete().eq("id", idA)).error?.code).toBe("42501");

    // `ajeno` es miembro solo de B: ve lo de B y nada de A. (`owner` y `staff` son miembros de ambos locales de la prueba.)
    const { data } = await ajeno.db.from("waiter_calls").select("id, organization_id").eq("status", "pending");
    expect(data?.some((f) => f.organization_id === a.id)).toBe(false);
    expect(data?.some((f) => f.organization_id === b.id)).toBe(true);
    const { data: delStaff } = await staff.db.from("waiter_calls").select("id").eq("status", "pending");
    expect(delStaff?.some((f) => f.id === idA)).toBe(true);
  });
});

describe("el trigger solo actúa en pending → attended", () => {
  it("el vencimiento de la función pública no deja hora ni persona de atención", async () => {
    const local = await nuevoLocal("tt-sala-vence");
    const id = await llamado(local);
    await service.from("waiter_calls").update({ created_at: new Date(Date.now() - 31 * MIN).toISOString() }).eq("id", id);
    // Otro llamado del mismo tipo: la función marca vencido el viejo.
    const { data } = await anonClient().rpc("create_waiter_call", { p_token: local.token, p_kind: "waiter" });
    expect(data).toEqual({ status: "created" });
    expect(await fila(id)).toMatchObject({ status: "expired", attended_at: null, attended_by: null });
  });
});
