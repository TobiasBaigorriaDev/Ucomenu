import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAGE_SIZE, loadPriceHistory, loadProductInfo, parseCursor, type Cursor } from "@/lib/precios/historial";
import { resolveAuthors, type PersonnelContext } from "@/lib/personnel";
import {
  addMembership,
  anonClient,
  createCategory,
  createOrg,
  createUser,
  deleteOrg,
  deleteUser,
  ORG_CAFE,
  ORG_PARRILLA,
  PRODUCT_ESPRESSO,
  SEED_PASSWORD,
  SEED_USERS,
  serviceClient,
  sql,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * Pantalla del historial de precios (ficha pantalla-historial-de-precios): los cargadores y la resolución de
 * personas, con los mismos clientes que usa el servidor. El foco es el aislamiento entre locales, la paginación
 * estable con empates y que ningún email llegue a quien no corresponde.
 */

let service: Db;
let owner: TestUser; // Dueño de A
let staff: TestUser; // Staff de A
let ownerB: TestUser; // Dueño de B
let exMiembro: TestUser; // estuvo en A, ya no (su cuenta de Auth sigue existiendo)
let dueloDoble: TestUser; // Dueño de A y de B
let aId: string;
let bId: string;
let platoA: string;
let platoB: string;
const orgs: string[] = [];
const usuarios: TestUser[] = [];

const ctxDe = (user: TestUser): PersonnelContext => ({ session: user.db, admin: service, actorId: user.id });

async function nuevoPlato(orgId: string, categoryId: string, nombre: string): Promise<string> {
  const { data, error } = await service
    .from("products")
    .insert({ organization_id: orgId, category_id: categoryId, name: nombre, price_cents: 1000 })
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo crear el plato: ${error.message}`);
  return data.id;
}

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, ownerB, exMiembro, dueloDoble] = await Promise.all([
    createUser(service, "hps-owner"),
    createUser(service, "hps-staff"),
    createUser(service, "hps-owner-b"),
    createUser(service, "hps-ex"),
    createUser(service, "hps-doble"),
  ]);
  usuarios.push(owner, staff, ownerB, exMiembro, dueloDoble);

  aId = await createOrg(service, "tt-hps-a", "pro");
  bId = await createOrg(service, "tt-hps-b", "pro");
  orgs.push(aId, bId);
  await addMembership(service, owner, aId, "owner");
  await addMembership(service, staff, aId, "staff");
  await addMembership(service, ownerB, bId, "owner");
  await addMembership(service, dueloDoble, aId, "owner");
  await addMembership(service, dueloDoble, bId, "owner");
  await addMembership(service, exMiembro, aId, "staff");
  await service.from("memberships").delete().eq("user_id", exMiembro.id).eq("organization_id", aId);

  platoA = await nuevoPlato(aId, await createCategory(service, aId), "tt-hps-plato-a");
  platoB = await nuevoPlato(bId, await createCategory(service, bId), "tt-hps-plato-b");
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all(usuarios.map((u) => deleteUser(service, u)));
});

describe("aislamiento entre locales y roles", () => {
  it("el Dueño y el Staff de Café Ejemplo ven las 3 filas del seed; ninguna de Parrilla Demo", async () => {
    for (const email of [SEED_USERS.duenoCafe.email, SEED_USERS.mozoCafe.email]) {
      const db = anonClient();
      expect((await db.auth.signInWithPassword({ email, password: SEED_PASSWORD })).error).toBeNull();
      const page = await loadPriceHistory(db, ORG_CAFE);
      // La base compartida puede tener cambios de otras corridas: se comprueban las 3 filas del seed y su orden relativo.
      const ids = page!.changes.map((c) => c.id);
      const delSeed = ids.filter((id) => id.startsWith("16000000-0000-4000-8000-00000000000"));
      expect(delSeed).toEqual([
        "16000000-0000-4000-8000-000000000002", // hace 3 días
        "16000000-0000-4000-8000-000000000003", // hace 5 días
        "16000000-0000-4000-8000-000000000001", // hace 10 días
      ]);
      expect(ids.some((id) => id.startsWith("26000000"))).toBe(false); // nada de Parrilla Demo
      // Pedir la organización de otro local no devuelve nada (RLS), ni con el id de su plato.
      expect((await loadPriceHistory(db, ORG_PARRILLA))?.changes).toEqual([]);
      expect((await loadPriceHistory(db, ORG_PARRILLA, { productId: "23000000-0000-4000-8000-000000000001" }))?.changes).toEqual([]);
    }
  });

  it("filtra por plato, y el id de un plato de otro local no filtra nada", async () => {
    const delPlato = await loadPriceHistory(owner.db, ORG_CAFE, { productId: PRODUCT_ESPRESSO });
    expect(delPlato?.changes).toEqual([]); // el Dueño de A no es de Café: RLS
    sql(
      `insert into public.price_history (organization_id, product_id, old_price_cents, new_price_cents) values
         ('${aId}', '${platoA}', 1000, 1100), ('${bId}', '${platoB}', 1000, 2000)`,
    );
    const a = await loadPriceHistory(owner.db, aId, { productId: platoA });
    expect(a?.changes.map((c) => c.newCents)).toEqual([1100]);
    // El Dueño de A pidiendo el plato de B (con su propia organización o con la de B): nada.
    expect((await loadPriceHistory(owner.db, aId, { productId: platoB }))?.changes).toEqual([]);
    expect((await loadPriceHistory(owner.db, bId, { productId: platoB }))?.changes).toEqual([]);
    expect((await loadPriceHistory(ownerB.db, bId))?.changes.map((c) => c.newCents)).toEqual([2000]);
  });

  it("quien no tiene sesión no ve nada", async () => {
    expect((await loadPriceHistory(anonClient(), aId))?.changes ?? []).toEqual([]);
  });

  it("los platos se resuelven solo dentro del propio local, aunque el plato ajeno sea público", async () => {
    // El plato de B es activo y de una organización publicada: la carta pública lo hace legible para cualquiera.
    expect((await owner.db.from("products").select("id").eq("id", platoB)).data).toHaveLength(1);
    const info = await loadProductInfo(owner.db, aId, [platoA, platoB]);
    expect([...(info?.keys() ?? [])]).toEqual([platoA]);
    expect(info?.get(platoA)).toEqual({ name: "tt-hps-plato-a", isActive: true });
  });
});

describe("tolerancia a platos y personas eliminados", () => {
  it("un plato borrado deja su historial legible y el plato ausente del mapa", async () => {
    const efimero = await nuevoPlato(aId, (await service.from("categories").select("id").eq("organization_id", aId).limit(1).single()).data!.id, "tt-hps-efimero");
    sql(`insert into public.price_history (organization_id, product_id, old_price_cents, new_price_cents) values ('${aId}', '${efimero}', 500, 600)`);
    expect((await service.from("products").delete().eq("id", efimero).select("id")).data).toHaveLength(1);

    const page = await loadPriceHistory(owner.db, aId, { productId: efimero });
    expect(page?.changes).toHaveLength(1);
    expect((await loadProductInfo(owner.db, aId, [efimero]))?.has(efimero)).toBe(false);
  });
});

describe("paginación por cursor", () => {
  it("recorre 120 cambios con empates de instante sin repetir ni saltear, y los cambios nuevos no mueven las páginas", async () => {
    const plato = await nuevoPlato(aId, (await service.from("categories").select("id").eq("organization_id", aId).limit(1).single()).data!.id, "tt-hps-paginado");
    // 120 filas; cada 3 comparten el mismo instante exacto.
    sql(
      `insert into public.price_history (organization_id, product_id, changed_at, old_price_cents, new_price_cents)
       select '${aId}', '${plato}', timestamptz '2026-01-01 12:00:00+00' + ((i / 3) * interval '1 second'), i, i + 1
       from generate_series(0, 119) as i`,
    );

    const vistos: string[] = [];
    const tamanos: number[] = [];
    let cursor: Cursor | null = null;
    for (let vuelta = 0; vuelta < 10; vuelta++) {
      const page = await loadPriceHistory(owner.db, aId, { productId: plato, cursor });
      expect(page).not.toBeNull();
      tamanos.push(page!.changes.length);
      vistos.push(...page!.changes.map((c) => c.id));
      if (vuelta === 0) {
        // Entra un cambio nuevo mientras se pagina: no desplaza las páginas siguientes.
        sql(`insert into public.price_history (organization_id, product_id, old_price_cents, new_price_cents) values ('${aId}', '${plato}', 7, 8)`);
      }
      if (!page!.next) break;
      cursor = parseCursor(page!.next);
      expect(cursor).not.toBeNull();
    }

    expect(tamanos).toEqual([PAGE_SIZE, PAGE_SIZE, 20]);
    expect(new Set(vistos).size).toBe(120); // ni repetidos ni salteados
    const filas = sql(`select count(*) from public.price_history where product_id = '${plato}'`);
    expect(filas[0][0]).toBe("121"); // la fila nueva existe pero no apareció en el recorrido
  });

  it("todo cursor que el parser acepta lo acepta también la base (sin error de consulta), en los bordes de fecha y desfase", async () => {
    const bordes = [
      "2028-02-29T23:59:59.999999-03:00",
      "2026-12-31T00:00:00+15:59",
      "2026-12-31T00:00:00-15:59",
      "2026-01-01T00:00:00Z",
      "2026-10-14T23:59:59.1+00:00",
    ];
    for (const instante of bordes) {
      const cursor = parseCursor(`${instante}|${platoA}`);
      expect(cursor, instante).not.toBeNull();
      expect(await loadPriceHistory(owner.db, aId, { cursor }), instante).not.toBeNull();
    }
  });

  it("un cursor armado con otro formato nunca llega a la consulta", () => {
    expect(parseCursor("2026-01-01T12:00:00+00:00),organization_id.neq.x,and(a.eq.1|" + platoA)).toBeNull();
  });
});

describe("resolveAuthors: quién puede ver emails", () => {
  it("el Dueño obtiene email y rol de los miembros actuales", async () => {
    const r = await resolveAuthors(ctxDe(owner), aId, [staff.id, owner.id]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.get(staff.id)).toEqual({ email: staff.email, role: "staff" });
      expect(r.data.get(owner.id)).toEqual({ email: owner.email, role: "owner" });
    }
  });

  it("el Staff no obtiene nada (forbidden) y no se toca la clave de servicio", async () => {
    const admin = new Proxy(service, {
      get() {
        throw new Error("el Staff no debe llegar a la clave de servicio");
      },
    });
    const r = await resolveAuthors({ session: staff.db, admin, actorId: staff.id }, aId, [owner.id]);
    expect(r).toEqual({ ok: false, error: "forbidden" });
  });

  it("el Dueño de otro local no obtiene nada de este", async () => {
    expect(await resolveAuthors(ctxDe(ownerB), aId, [staff.id])).toEqual({ ok: false, error: "forbidden" });
  });

  it("alguien que ya no es miembro de este local no se identifica, aunque su cuenta exista", async () => {
    const r = await resolveAuthors(ctxDe(owner), aId, [exMiembro.id, staff.id]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.has(exMiembro.id)).toBe(false);
      expect(JSON.stringify([...r.data.values()])).not.toContain(exMiembro.email);
      expect(r.data.has(staff.id)).toBe(true);
    }
  });

  it("alguien de otro local no se identifica, y un id inexistente tampoco", async () => {
    const r = await resolveAuthors(ctxDe(owner), aId, [ownerB.id, "00000000-0000-4000-8000-000000000000"]);
    expect(r).toEqual({ ok: true, data: new Map() });
  });

  it("un Dueño de dos locales, al mirar uno, no identifica a las personas del otro (la RLS sola no alcanza)", async () => {
    // dueloDoble lee por RLS las membresías de A y de B: solo el filtro por organización evita mezclar los locales.
    expect((await dueloDoble.db.from("memberships").select("user_id").eq("user_id", ownerB.id)).data).toHaveLength(1);
    const r = await resolveAuthors(ctxDe(dueloDoble), aId, [ownerB.id]);
    expect(r).toEqual({ ok: true, data: new Map() });
    const delOtro = await resolveAuthors(ctxDe(dueloDoble), bId, [ownerB.id]);
    expect(delOtro.ok && delOtro.data.get(ownerB.id)?.email).toBe(ownerB.email);
  });

  it("sin ids no consulta nada", async () => {
    expect(await resolveAuthors(ctxDe(owner), aId, [])).toEqual({ ok: true, data: new Map() });
  });

  it("si Auth falla, la resolución falla cerrada (no confunde una falla con «ya no está»)", async () => {
    const admin = {
      auth: { admin: { getUserById: async () => ({ data: { user: null }, error: { message: "boom" } }) } },
    } as unknown as Db;
    const r = await resolveAuthors({ session: owner.db, admin, actorId: owner.id }, aId, [staff.id]);
    expect(r).toEqual({ ok: false, error: "unexpected" });
  });
});
