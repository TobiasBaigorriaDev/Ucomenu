import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readGuideDismissed, setGuideDismissed } from "@/lib/guia/primeros-pasos";
import { addMembership, anonClient, createOrg, createUser, deleteOrg, deleteUser, serviceClient, sql, type Db, type TestUser } from "./helpers";

/**
 * Guía de primeros pasos descartable por cuenta (nivel M; ficha guia-descartable) contra el Supabase local. Es una PREFERENCIA de
 * cada persona y local: ocultar la de uno no oculta la de otro ni la de otro local, solo un miembro puede guardarla, nadie la toca por
 * la API y quitar a la persona del local borra su preferencia. No cambia lo que la persona puede leer ni hacer.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
let ajeno: TestUser;
const orgs: string[] = [];
let contador = 0;

async function nuevoLocal() {
  contador += 1;
  const id = await createOrg(service, `tt-guia-${Date.now()}-${contador}`, "pro");
  orgs.push(id);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return id;
}

const filas = (org: string) => Number(sql(`select count(*) from public.member_guide_dismissals where organization_id = '${org}'`)[0][0]);

beforeAll(async () => {
  service = serviceClient();
  owner = await createUser(service, "guia-d");
  staff = await createUser(service, "guia-s");
  ajeno = await createUser(service, "guia-x");
});

afterAll(async () => {
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of [owner, staff, ajeno]) await deleteUser(service, u);
});

describe("ocultar y volver a mostrar la guía", () => {
  it("por defecto no está oculta; se oculta, se vuelve a mostrar, y repetir no falla", async () => {
    const org = await nuevoLocal();
    expect(await readGuideDismissed(owner.db, org)).toBe(false);
    expect(await setGuideDismissed(owner.db, org, true)).toBe(true);
    expect(await setGuideDismissed(owner.db, org, true)).toBe(true); // idempotente
    expect(await readGuideDismissed(owner.db, org)).toBe(true);
    expect(filas(org)).toBe(1);
    expect(await setGuideDismissed(owner.db, org, false)).toBe(true);
    expect(await setGuideDismissed(owner.db, org, false)).toBe(true);
    expect(await readGuideDismissed(owner.db, org)).toBe(false);
    expect(filas(org)).toBe(0);
  });

  it("es de cada persona: el Staff no ve ocultada la guía que ocultó el Dueño, y el Staff también puede ocultar la suya", async () => {
    const org = await nuevoLocal();
    await setGuideDismissed(owner.db, org, true);
    expect(await readGuideDismissed(owner.db, org)).toBe(true);
    expect(await readGuideDismissed(staff.db, org)).toBe(false);
    expect(await setGuideDismissed(staff.db, org, true)).toBe(true);
    await setGuideDismissed(owner.db, org, false);
    expect(await readGuideDismissed(owner.db, org)).toBe(false);
    expect(await readGuideDismissed(staff.db, org)).toBe(true); // lo del Dueño no toca lo del Staff
  });

  it("es de cada local: ocultarla en uno no la oculta en otro de la misma persona", async () => {
    const a = await nuevoLocal();
    const b = await nuevoLocal();
    await setGuideDismissed(owner.db, a, true);
    expect(await readGuideDismissed(owner.db, a)).toBe(true);
    expect(await readGuideDismissed(owner.db, b)).toBe(false);
  });
});

describe("quién puede guardarla y leerla", () => {
  it("quien no es miembro no guarda ni lee nada de ese local", async () => {
    const org = await nuevoLocal();
    await setGuideDismissed(owner.db, org, true);
    expect(await setGuideDismissed(ajeno.db, org, true)).toBe(false);
    expect((await ajeno.db.rpc("set_my_guide_dismissed", { p_org: org, p_dismissed: true })).data).toBe("unavailable");
    expect(await readGuideDismissed(ajeno.db, org)).toBe(false);
    expect(filas(org)).toBe(1); // solo la del Dueño
  });

  it("anon no ejecuta ninguna de las dos funciones", async () => {
    const org = await nuevoLocal();
    const anon = anonClient();
    expect((await anon.rpc("set_my_guide_dismissed", { p_org: org, p_dismissed: true })).error?.code).toBe("42501");
    expect((await anon.rpc("my_guide_dismissed", { p_org: org })).error?.code).toBe("42501");
    expect(filas(org)).toBe(0);
  });

  it("valores nulos no guardan nada", async () => {
    const org = await nuevoLocal();
    expect((await owner.db.rpc("set_my_guide_dismissed", { p_org: org, p_dismissed: null as never })).data).toBe("unavailable");
    expect((await owner.db.rpc("set_my_guide_dismissed", { p_org: null as never, p_dismissed: true })).data).toBe("unavailable");
    expect(filas(org)).toBe(0);
  });

  it("la tabla no se toca por la API: ni el Dueño ni service_role leen o escriben", async () => {
    const org = await nuevoLocal();
    await setGuideDismissed(owner.db, org, true);
    for (const [nombre, db] of [["Dueño", owner.db], ["anon", anonClient()], ["service_role", service]] as const) {
      expect((await db.from("member_guide_dismissals").select("*")).error?.code, `${nombre} lee`).toBe("42501");
      const alta = await db.from("member_guide_dismissals").insert({ user_id: staff.id, organization_id: org });
      expect(alta.error?.code, `${nombre} inserta`).toBe("42501");
      expect((await db.from("member_guide_dismissals").delete().eq("organization_id", org)).error?.code, `${nombre} borra`).toBe("42501");
    }
    expect(filas(org)).toBe(1);
  });
});

describe("al quitar a la persona del local", () => {
  it("su preferencia se borra con la membresía", async () => {
    const org = await nuevoLocal();
    await setGuideDismissed(staff.db, org, true);
    expect(filas(org)).toBe(1);
    sql(`delete from public.memberships where organization_id = '${org}' and user_id = '${staff.id}'`);
    expect(filas(org)).toBe(0);
    expect(await readGuideDismissed(staff.db, org)).toBe(false);
  });
});
