import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  anonClient,
  createCategory,
  createOrg,
  createUser,
  DIA_MS,
  deleteOrg,
  deleteUser,
  insertProducts,
  ORG_CAFE,
  SEED_PASSWORD,
  SEED_USERS,
  serviceClient,
  setSubscription,
  sql,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * Historial de cambios de precio (ficha historial-de-precios): trigger sobre products.price_cents, identidad
 * desde la sesión, transacción, solo-agregado, permisos de lectura (Dueño y Staff de la propia organización),
 * aislamiento entre organizaciones y borrados sin cascada. Contra el Supabase local.
 */

const INSUFFICIENT_PRIVILEGE = "42501";
const LIMIT_EXCEEDED = "53400";
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
const HORA_MS = 60 * 60 * 1000;

type Local = { id: string; categoryId: string };

let service: Db;
let owner: TestUser; // Dueño de A
let staff: TestUser; // Staff de A
let ownerB: TestUser; // Dueño de B
let staffB: TestUser; // Staff de B
let sinOrg: TestUser; // sin ninguna membresía
let a: Local;
let b: Local;
const orgs: string[] = [];
const usuarios: TestUser[] = [];

async function nuevoLocal(slug: string, dueno: TestUser, mozo: TestUser): Promise<Local> {
  const id = await createOrg(service, slug, "pro");
  orgs.push(id);
  await addMembership(service, dueno, id, "owner");
  await addMembership(service, mozo, id, "staff");
  return { id, categoryId: await createCategory(service, id) };
}

async function nuevoPlato(local: Local, precio = 1000, extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await service
    .from("products")
    .insert({ organization_id: local.id, category_id: local.categoryId, name: `tt-hp-${Math.random().toString(36).slice(2, 8)}`, price_cents: precio, ...extra })
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo crear el plato: ${error.message}`);
  return data.id;
}

async function historial(productId: string) {
  const { data, error } = await service
    .from("price_history")
    .select("*")
    .eq("product_id", productId)
    .order("changed_at", { ascending: true });
  if (error) throw new Error(`No se pudo leer el historial: ${error.message}`);
  return data;
}

async function precio(productId: string): Promise<number> {
  const { data } = await service.from("products").select("price_cents").eq("id", productId).single();
  return data!.price_cents;
}

/** Filas de un resultado de `sql()` cuya primera columna es `etiqueta` (psql también imprime BEGIN/ROLLBACK). */
const filas = (salida: string[][], etiqueta: string) => salida.filter((f) => f[0] === etiqueta);

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, ownerB, staffB, sinOrg] = await Promise.all([
    createUser(service, "hp-owner"),
    createUser(service, "hp-staff"),
    createUser(service, "hp-owner-b"),
    createUser(service, "hp-staff-b"),
    createUser(service, "hp-sin-org"),
  ]);
  usuarios.push(owner, staff, ownerB, staffB, sinOrg);
  a = await nuevoLocal("tt-hp-a", owner, staff);
  b = await nuevoLocal("tt-hp-b", ownerB, staffB);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all(usuarios.map((u) => deleteUser(service, u)));
});

describe("qué se registra", () => {
  it("el Dueño cambia un precio: una fila con quién, cuándo, organización, plato, anterior y nuevo", async () => {
    const plato = await nuevoPlato(a, 1000);
    const antes = Date.now();
    const r = await owner.db.from("products").update({ price_cents: 1500 }).eq("id", plato).select("id");
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(1);

    const h = await historial(plato);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({
      organization_id: a.id,
      product_id: plato,
      changed_by: owner.id,
      old_price_cents: 1000,
      new_price_cents: 1500,
    });
    const cuando = new Date(h[0].changed_at).getTime();
    expect(cuando).toBeGreaterThanOrEqual(antes - 5_000);
    expect(cuando).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it("el Staff cambia un precio: la fila lo atribuye al Staff", async () => {
    const plato = await nuevoPlato(a, 2000);
    expect((await staff.db.from("products").update({ price_cents: 1800 }).eq("id", plato).select("id")).data).toHaveLength(1);

    const h = await historial(plato);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ changed_by: staff.id, old_price_cents: 2000, new_price_cents: 1800, organization_id: a.id });
  });

  it("cada cambio queda en su fila, encadenados y en orden, incluso volviendo al valor anterior", async () => {
    const plato = await nuevoPlato(a, 100);
    for (const [quien, nuevo] of [
      [owner, 200],
      [staff, 300],
      [owner, 100],
    ] as const) {
      expect((await quien.db.from("products").update({ price_cents: nuevo }).eq("id", plato).select("id")).data).toHaveLength(1);
    }
    const h = await historial(plato);
    expect(h.map((f) => [f.old_price_cents, f.new_price_cents, f.changed_by])).toEqual([
      [100, 200, owner.id],
      [200, 300, staff.id],
      [300, 100, owner.id],
    ]);
  });

  it("un UPDATE que toca varios platos deja una fila por plato que cambió y ninguna por el que no", async () => {
    const [p1, p2, p3] = [await nuevoPlato(a, 500), await nuevoPlato(a, 500), await nuevoPlato(a, 900)];
    // Mismo precio nuevo para los tres: el tercero ya valía 900 -> no cambia.
    const r = await service.from("products").update({ price_cents: 900 }).in("id", [p1, p2, p3]).select("id");
    expect(r.data).toHaveLength(3);
    expect(await historial(p1)).toHaveLength(1);
    expect(await historial(p2)).toHaveLength(1);
    expect(await historial(p3)).toHaveLength(0);
  });

  it("el precio y otros campos en el mismo UPDATE: una sola fila", async () => {
    const plato = await nuevoPlato(a, 700);
    const r = await staff.db.from("products").update({ price_cents: 750, name: "tt-hp-renombrado", is_active: false }).eq("id", plato).select("id");
    expect(r.data).toHaveLength(1);
    const h = await historial(plato);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ old_price_cents: 700, new_price_cents: 750 });
  });

  it("precio sin cambios (mismo valor, también con otros campos) no registra nada", async () => {
    const plato = await nuevoPlato(a, 1234);
    const mismo = await owner.db.from("products").update({ price_cents: 1234 }).eq("id", plato).select("id");
    const mismoYOtros = await staff.db.from("products").update({ price_cents: 1234, description: "tt-hp-desc" }).eq("id", plato).select("id");
    expect(mismo.data).toHaveLength(1);
    expect(mismoYOtros.data).toHaveLength(1);
    expect(await historial(plato)).toHaveLength(0);
  });

  it("editar otros campos (nombre, descripción, orden, activo, categoría) no registra nada", async () => {
    const plato = await nuevoPlato(a, 4321);
    const otraCategoria = await createCategory(service, a.id, "tt-hp-otra");
    for (const cambio of [
      { name: "tt-hp-nuevo-nombre" },
      { description: "otra descripción" },
      { sort_order: 7 },
      { is_active: false },
      { is_active: true },
      { category_id: otraCategoria },
    ]) {
      const r = await staff.db.from("products").update(cambio).eq("id", plato).select("id");
      expect(r.error, JSON.stringify(cambio)).toBeNull();
      expect(r.data, JSON.stringify(cambio)).toHaveLength(1);
    }
    expect(await historial(plato)).toHaveLength(0);
    expect(await precio(plato)).toBe(4321);
  });

  it("crear un plato (con cualquier precio, activo o no) no registra nada", async () => {
    const porApi = await owner.db
      .from("products")
      .insert({ organization_id: a.id, category_id: a.categoryId, name: "tt-hp-alta-api", price_cents: 999 })
      .select("id")
      .single();
    expect(porApi.error).toBeNull();
    const inactivo = await nuevoPlato(a, 5, { is_active: false });
    const gratis = await nuevoPlato(a, 0);

    for (const id of [porApi.data!.id, inactivo, gratis]) expect(await historial(id)).toHaveLength(0);
  });

  it("de gratis (0) a un precio y de un precio a gratis (0) también se registran", async () => {
    const plato = await nuevoPlato(a, 0);
    await owner.db.from("products").update({ price_cents: 250 }).eq("id", plato);
    await owner.db.from("products").update({ price_cents: 0 }).eq("id", plato);
    const h = await historial(plato);
    expect(h.map((f) => [f.old_price_cents, f.new_price_cents])).toEqual([
      [0, 250],
      [250, 0],
    ]);
  });
});

describe("quién: identidad de la sesión, nunca del pedido", () => {
  it("no hay campo para elegir quién: mandar changed_by (u otras columnas del historial) en el UPDATE falla y no cambia el precio", async () => {
    const plato = await nuevoPlato(a, 3000);
    for (const extra of [{ changed_by: staffB.id }, { changed_at: "2020-01-01T00:00:00Z" }, { old_price_cents: 1 }]) {
      const r = await staff.db
        .from("products")
        .update({ price_cents: 3100, ...extra } as never)
        .eq("id", plato)
        .select("id");
      expect(r.error, JSON.stringify(extra)).not.toBeNull();
    }
    expect(await precio(plato)).toBe(3000);
    expect(await historial(plato)).toHaveLength(0);
  });

  it("dos personas en pedidos seguidos: cada fila lleva la identidad de quien hizo ese pedido", async () => {
    const plato = await nuevoPlato(a, 10);
    await staff.db.from("products").update({ price_cents: 11 }).eq("id", plato);
    await owner.db.from("products").update({ price_cents: 12 }).eq("id", plato);
    await staff.db.from("products").update({ price_cents: 13 }).eq("id", plato);
    expect((await historial(plato)).map((f) => f.changed_by)).toEqual([staff.id, owner.id, staff.id]);
  });

  it("la identidad sale de la sesión de base (claims del JWT), también por SQL con el rol de la API", async () => {
    const plato = await nuevoPlato(a, 60);
    sql(
      `begin; set local role authenticated; ` +
        `select set_config('request.jwt.claims', '{"sub":"${staff.id}","role":"authenticated"}', true); ` +
        `update public.products set price_cents = 61 where id = '${plato}'; commit`,
    );
    const h = await historial(plato);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ changed_by: staff.id, old_price_cents: 60, new_price_cents: 61 });
  });

  it("operación técnica sin usuario autenticado (service_role y psql): changed_by queda NULL", async () => {
    const plato = await nuevoPlato(a, 80);
    const porServicio = await service.from("products").update({ price_cents: 81 }).eq("id", plato).select("id");
    expect(porServicio.data).toHaveLength(1);
    sql(`update public.products set price_cents = 82 where id = '${plato}'`);

    const h = await historial(plato);
    expect(h.map((f) => [f.old_price_cents, f.new_price_cents, f.changed_by])).toEqual([
      [80, 81, null],
      [81, 82, null],
    ]);
    expect(h.every((f) => f.organization_id === a.id)).toBe(true);
  });
});

describe("cuenta y permisos: lo rechazado no deja historial", () => {
  it("en gracia se cambia y se registra; en solo lectura y suspendida el cambio se rechaza (Dueño y Staff) y no hay fila", async () => {
    const plato = await nuevoPlato(a, 1000);
    try {
      await setSubscription(service, a.id, { plan: "pro", finEnMs: -HORA_MS }); // día 1: gracia
      expect((await staff.db.from("products").update({ price_cents: 1100 }).eq("id", plato).select("id")).data).toHaveLength(1);
      expect(await historial(plato)).toHaveLength(1);

      for (const [etiqueta, finEnMs] of [
        ["solo lectura (día 8)", -(7 * DIA_MS + HORA_MS)],
        ["suspendida (día 16)", -(15 * DIA_MS + HORA_MS)],
      ] as const) {
        await setSubscription(service, a.id, { plan: "pro", finEnMs });
        for (const [quien, db] of [
          ["Dueño", owner.db],
          ["Staff", staff.db],
        ] as const) {
          const r = await db.from("products").update({ price_cents: 2222 }).eq("id", plato).select("id");
          expect(r.error, `${quien} ${etiqueta}`).toBeNull();
          expect(r.data, `${quien} ${etiqueta}`).toEqual([]);
        }
        expect(await precio(plato), etiqueta).toBe(1100);
        expect(await historial(plato), etiqueta).toHaveLength(1);
      }

      // En solo lectura y suspendida el historial sí se puede LEER (es consulta, no escritura de catálogo).
      const lectura = await staff.db.from("price_history").select("id").eq("product_id", plato);
      expect(lectura.error).toBeNull();
      expect(lectura.data).toHaveLength(1);
    } finally {
      await setSubscription(service, a.id, { plan: "pro", finEnMs: 30 * DIA_MS });
    }
  });

  it("quien no es miembro de la organización no cambia el precio ni deja fila (0 filas)", async () => {
    const platoA = await nuevoPlato(a, 400);
    for (const quien of [ownerB, staffB, sinOrg]) {
      const r = await quien.db.from("products").update({ price_cents: 1 }).eq("id", platoA).select("id");
      expect(r.error).toBeNull();
      expect(r.data).toEqual([]);
    }
    const anon = await anonClient().from("products").update({ price_cents: 1 }).eq("id", platoA).select("id");
    expect(anon.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await precio(platoA)).toBe(400);
    expect(await historial(platoA)).toHaveLength(0);
  });

  it("un valor inválido (negativo) se rechaza y no deja fila", async () => {
    const plato = await nuevoPlato(a, 600);
    const r = await staff.db.from("products").update({ price_cents: -1 }).eq("id", plato).select("id");
    expect(r.error?.code).toBe(CHECK_VIOLATION);
    expect(await precio(plato)).toBe(600);
    expect(await historial(plato)).toHaveLength(0);
  });

  it("el tope de platos activos rechaza activar + cambiar precio (53400): ni precio nuevo ni fila", async () => {
    const llena = await createOrg(service, "tt-hp-llena", "basic"); // Básico: 80 platos activos
    orgs.push(llena);
    const staffLlena = await createUser(service, "hp-staff-llena");
    usuarios.push(staffLlena);
    await addMembership(service, staffLlena, llena, "staff");
    const categoryId = await createCategory(service, llena);
    expect((await insertProducts(service, llena, categoryId, 80, true, "tt-hp-lleno")).error).toBeNull();
    const oculto = await nuevoPlato({ id: llena, categoryId }, 500, { is_active: false });

    const r = await staffLlena.db.from("products").update({ is_active: true, price_cents: 999 }).eq("id", oculto).select("id");
    expect(r.error?.code).toBe(LIMIT_EXCEEDED);
    expect(await precio(oculto)).toBe(500);
    expect(await historial(oculto)).toHaveLength(0);

    // Sin activarlo, cambiar el precio de un plato oculto sí se registra (no consume cupo).
    const ok = await staffLlena.db.from("products").update({ price_cents: 999 }).eq("id", oculto).select("id");
    expect(ok.data).toHaveLength(1);
    expect(await historial(oculto)).toHaveLength(1);
  });
});

describe("transacción: el historial vive y muere con el cambio", () => {
  it("dentro de la transacción la fila ya existe; con ROLLBACK no queda ni la fila ni el precio nuevo", async () => {
    const plato = await nuevoPlato(a, 5000);
    const salida = sql(
      `begin; update public.products set price_cents = 5100 where id = '${plato}'; ` +
        `select 'dentro', count(*) from public.price_history where product_id = '${plato}'; rollback; ` +
        `select 'fuera', count(*) from public.price_history where product_id = '${plato}'`,
    );
    expect(filas(salida, "dentro")).toEqual([["dentro", "1"]]);
    expect(filas(salida, "fuera")).toEqual([["fuera", "0"]]);
    expect(await precio(plato)).toBe(5000);
    expect(await historial(plato)).toHaveLength(0);
  });

  it("si un paso posterior de la misma transacción falla, se revierte también el historial", async () => {
    const plato = await nuevoPlato(a, 5200);
    // `-c` con varias sentencias es una sola transacción: el error final deshace el UPDATE y la fila.
    expect(() => sql(`update public.products set price_cents = 5300 where id = '${plato}'; select 1/0`)).toThrow();
    expect(await precio(plato)).toBe(5200);
    expect(await historial(plato)).toHaveLength(0);
  });

  it("con COMMIT queda; dos cambios en la misma transacción quedan ambos y en orden", async () => {
    const plato = await nuevoPlato(a, 10);
    sql(
      `begin; update public.products set price_cents = 20 where id = '${plato}'; ` +
        `update public.products set price_cents = 30 where id = '${plato}'; commit`,
    );
    const h = await historial(plato);
    expect(h.map((f) => [f.old_price_cents, f.new_price_cents])).toEqual([
      [10, 20],
      [20, 30],
    ]);
  });

  it("un UPDATE multi-fila que falla a mitad no deja historial de las filas que sí cambiaron", async () => {
    const [p1, p2] = [await nuevoPlato(a, 50), await nuevoPlato(a, 60)];
    // La segunda fila viola el CHECK (precio negativo): el statement entero se revierte.
    expect(() =>
      sql(`update public.products set price_cents = case when id = '${p1}' then 55 else -5 end where id in ('${p1}', '${p2}')`),
    ).toThrow();
    expect(await precio(p1)).toBe(50);
    expect(await historial(p1)).toHaveLength(0);
    expect(await historial(p2)).toHaveLength(0);
  });
});

describe("el historial no se escribe desde la aplicación", () => {
  const fila = () => ({
    organization_id: a.id,
    product_id: "00000000-0000-0000-0000-000000000000",
    old_price_cents: 1,
    new_price_cents: 2,
  });

  it("Dueño y Staff no pueden insertar, modificar ni borrar (42501), ni siquiera sobre su propia organización", async () => {
    const plato = await nuevoPlato(a, 100);
    await owner.db.from("products").update({ price_cents: 200 }).eq("id", plato);
    const [existente] = await historial(plato);

    for (const [quien, db] of [
      ["Dueño", owner.db],
      ["Staff", staff.db],
    ] as const) {
      const insertar = await db.from("price_history").insert({ ...fila(), product_id: plato });
      const modificar = await db.from("price_history").update({ new_price_cents: 1 }).eq("id", existente.id);
      const borrar = await db.from("price_history").delete().eq("id", existente.id);
      expect(insertar.error?.code, `${quien} insert`).toBe(INSUFFICIENT_PRIVILEGE);
      expect(modificar.error?.code, `${quien} update`).toBe(INSUFFICIENT_PRIVILEGE);
      expect(borrar.error?.code, `${quien} delete`).toBe(INSUFFICIENT_PRIVILEGE);
    }
    expect(await historial(plato)).toEqual([existente]);
  });

  it("anon no puede leer ni escribir nada (42501)", async () => {
    const anon = anonClient();
    const [lectura, insertar, modificar, borrar] = await Promise.all([
      anon.from("price_history").select("id"),
      anon.from("price_history").insert(fila()),
      anon.from("price_history").update({ new_price_cents: 1 }).eq("organization_id", a.id),
      anon.from("price_history").delete().eq("organization_id", a.id),
    ]);
    for (const r of [lectura, insertar, modificar, borrar]) expect(r.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("service_role puede leer pero no insertar, modificar ni borrar (privilegios revocados)", async () => {
    const plato = await nuevoPlato(a, 100);
    await owner.db.from("products").update({ price_cents: 200 }).eq("id", plato);
    const [existente] = await historial(plato);

    expect((await service.from("price_history").select("id").eq("id", existente.id)).error).toBeNull();
    const insertar = await service.from("price_history").insert({ ...fila(), product_id: plato });
    const modificar = await service.from("price_history").update({ new_price_cents: 1 }).eq("id", existente.id);
    const borrar = await service.from("price_history").delete().eq("id", existente.id);
    expect(insertar.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(modificar.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(borrar.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await historial(plato)).toEqual([existente]);
  });

  it("ni el dueño de la tabla (psql) puede UPDATE, DELETE ni TRUNCATE sin apagar el trigger a propósito", async () => {
    const plato = await nuevoPlato(a, 100);
    await owner.db.from("products").update({ price_cents: 200 }).eq("id", plato);
    const [existente] = await historial(plato);

    expect(() => sql(`update public.price_history set new_price_cents = 9 where id = '${existente.id}'`)).toThrow(/solo agregado/);
    expect(() => sql(`delete from public.price_history where id = '${existente.id}'`)).toThrow(/solo agregado/);
    expect(() => sql(`truncate public.price_history`)).toThrow(/solo agregado/);
    expect(await historial(plato)).toEqual([existente]);
  });

  it("la tabla rechaza filas incoherentes aun escritas por el dueño: sin cambio, negativas o de una organización inexistente", async () => {
    const plato = await nuevoPlato(a, 100);
    expect(() =>
      sql(`insert into public.price_history (organization_id, product_id, old_price_cents, new_price_cents) values ('${a.id}', '${plato}', 5, 5)`),
    ).toThrow(/check/i);
    expect(() =>
      sql(`insert into public.price_history (organization_id, product_id, old_price_cents, new_price_cents) values ('${a.id}', '${plato}', -1, 5)`),
    ).toThrow(/check/i);
    expect(() =>
      sql(`insert into public.price_history (organization_id, product_id, old_price_cents, new_price_cents) values (gen_random_uuid(), '${plato}', 1, 5)`),
    ).toThrow(/foreign key/i);
    expect(await historial(plato)).toHaveLength(0);
  });

  it("las funciones del trigger no tienen EXECUTE para anon ni authenticated", async () => {
    const priv = sql(
      `select has_function_privilege('authenticated', 'private.record_price_change()', 'execute'), ` +
        `has_function_privilege('anon', 'private.record_price_change()', 'execute'), ` +
        `has_function_privilege('authenticated', 'private.price_history_append_only()', 'execute')`,
    );
    expect(priv).toEqual([["f", "f", "f"]]);
  });
});

describe("lectura y aislamiento entre organizaciones", () => {
  let platoA: string;
  let platoB: string;

  beforeAll(async () => {
    platoA = await nuevoPlato(a, 1000);
    platoB = await nuevoPlato(b, 2000);
    await staff.db.from("products").update({ price_cents: 1100 }).eq("id", platoA);
    await ownerB.db.from("products").update({ price_cents: 2200 }).eq("id", platoB);
  });

  it("el Dueño y el Staff leen el historial de su organización (los dos ven los cambios de ambos)", async () => {
    await owner.db.from("products").update({ price_cents: 1200 }).eq("id", platoA);
    for (const db of [owner.db, staff.db]) {
      const r = await db.from("price_history").select("changed_by, old_price_cents, new_price_cents").eq("product_id", platoA).order("changed_at");
      expect(r.error).toBeNull();
      expect(r.data).toEqual([
        { changed_by: staff.id, old_price_cents: 1000, new_price_cents: 1100 },
        { changed_by: owner.id, old_price_cents: 1100, new_price_cents: 1200 },
      ]);
    }
  });

  it("cada organización ve solo lo suyo, sin filtrar y filtrando por el id de la otra", async () => {
    for (const [db, propia, ajena, platoPropio, platoAjeno] of [
      [owner.db, a.id, b.id, platoA, platoB],
      [staff.db, a.id, b.id, platoA, platoB],
      [ownerB.db, b.id, a.id, platoB, platoA],
      [staffB.db, b.id, a.id, platoB, platoA],
    ] as const) {
      const todo = await db.from("price_history").select("organization_id");
      expect(todo.error).toBeNull();
      expect(todo.data!.length).toBeGreaterThan(0);
      expect(todo.data!.every((f) => f.organization_id === propia)).toBe(true);

      const porOrg = await db.from("price_history").select("id").eq("organization_id", ajena);
      const porPlato = await db.from("price_history").select("id").eq("product_id", platoAjeno);
      expect(porOrg.error).toBeNull();
      expect(porOrg.data).toEqual([]);
      expect(porPlato.data).toEqual([]);
      expect((await db.from("price_history").select("id").eq("product_id", platoPropio)).data!.length).toBeGreaterThan(0);
    }
  });

  it("quien no es miembro de ninguna organización no ve nada", async () => {
    const r = await sinOrg.db.from("price_history").select("id");
    expect(r.error).toBeNull();
    expect(r.data).toEqual([]);
  });

  it("las filas del seed: el Staff de Café Ejemplo ve las de su local y ninguna de Parrilla Demo", async () => {
    const mozo = anonClient();
    const entrada = await mozo.auth.signInWithPassword({ email: SEED_USERS.mozoCafe.email, password: SEED_PASSWORD });
    expect(entrada.error).toBeNull();

    const r = await mozo.from("price_history").select("id, organization_id, changed_by, old_price_cents, new_price_cents");
    expect(r.error).toBeNull();
    const ids = r.data!.map((f) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "16000000-0000-4000-8000-000000000001",
        "16000000-0000-4000-8000-000000000002",
        "16000000-0000-4000-8000-000000000003",
      ]),
    );
    expect(ids).not.toContain("26000000-0000-4000-8000-000000000001");
    expect(r.data!.every((f) => f.organization_id === ORG_CAFE)).toBe(true);
    expect(r.data!.find((f) => f.id === "16000000-0000-4000-8000-000000000003")?.changed_by).toBeNull();
    await mozo.auth.signOut();
  });
});

describe("borrados explícitos, sin cascada", () => {
  it("una organización con historial no se borra (23503) y el historial queda intacto", async () => {
    const local = await nuevoLocal("tt-hp-borrar", ownerB, staffB); // local propio de este caso
    const plato = await nuevoPlato(local, 100);
    await service.from("products").update({ price_cents: 150 }).eq("id", plato);

    const r = await service.from("organizations").delete().eq("id", local.id);
    expect(r.error?.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(await historial(plato)).toHaveLength(1);
    expect(await precio(plato)).toBe(150); // el plato también sigue: la organización no se borró a medias
  });

  it("un plato con historial se borra con normalidad y el historial sobrevive, legible para su organización", async () => {
    const plato = await nuevoPlato(a, 100);
    await staff.db.from("products").update({ price_cents: 120 }).eq("id", plato);

    const r = await owner.db.from("products").delete().eq("id", plato).select("id");
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(1);

    const h = await historial(plato);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ product_id: plato, organization_id: a.id, changed_by: staff.id, old_price_cents: 100, new_price_cents: 120 });
    expect((await owner.db.from("price_history").select("id").eq("product_id", plato)).data).toHaveLength(1);
    expect((await ownerB.db.from("price_history").select("id").eq("product_id", plato)).data).toEqual([]);
  });

  it("borrar la categoría (en cascada con sus platos) tampoco toca el historial", async () => {
    const categoryId = await createCategory(service, a.id, "tt-hp-categoria-borrable");
    const plato = await nuevoPlato({ id: a.id, categoryId }, 100);
    await owner.db.from("products").update({ price_cents: 101 }).eq("id", plato);

    const r = await owner.db.from("categories").delete().eq("id", categoryId).select("id");
    expect(r.data).toHaveLength(1);
    expect(await historial(plato)).toHaveLength(1);
  });

  it("dar de baja a la persona (borrar su usuario) no se bloquea ni reescribe la fila: changed_by conserva su id", async () => {
    const efimero = await createUser(service, "hp-efimero");
    await addMembership(service, efimero, a.id, "staff");
    const plato = await nuevoPlato(a, 100);
    expect((await efimero.db.from("products").update({ price_cents: 101 }).eq("id", plato).select("id")).data).toHaveLength(1);

    const baja = await service.auth.admin.deleteUser(efimero.id);
    expect(baja.error).toBeNull();

    const h = await historial(plato);
    expect(h).toHaveLength(1);
    expect(h[0].changed_by).toBe(efimero.id);
  });
});
