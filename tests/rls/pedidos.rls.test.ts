import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
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
  serviceClient,
  setSubscription,
  sql,
  type Db,
  type PlanCode,
  type TestUser,
} from "./helpers";

/**
 * Esquema de pedidos y alta de ítems sin opciones (nivel C, ficha pedidos-esquema-y-alta-de-items, ADR 0041) contra el Supabase
 * local: quién anota (plan y mora), que el precio sale de `effective_prices` y no de quien llama, un solo pedido abierto por mesa,
 * el reintento seguro con `client_key`, el aislamiento entre organizaciones y que nadie escribe las tablas por la API.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
const orgs: string[] = [];
let contador = 0;
const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

type Local = { id: string; branch: string; table: string; table2: string; category: string; product: string };

async function nuevoLocal(plan: PlanCode = "pro", opciones: { miembros?: boolean } = {}): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-ped-${sufijo}-${contador}`, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const b = await service.from("branches").insert({ organization_id: id, slug: "principal", name: "Principal" }).select("id").single();
  if (b.error) throw new Error(`sucursal: ${b.error.message}`);
  const mesas = await service
    .from("tables")
    .insert([
      { organization_id: id, branch_id: b.data.id, label: "Mesa 1" },
      { organization_id: id, branch_id: b.data.id, label: "Mesa 2" },
    ])
    .select("id, label")
    .order("label");
  if (mesas.error) throw new Error(`mesas: ${mesas.error.message}`);
  const category = await createCategory(service, id, "Bebidas");
  const p = await service.from("products").insert({ organization_id: id, category_id: category, name: "Cerveza", price_cents: 1000 }).select("id").single();
  if (p.error) throw new Error(`plato: ${p.error.message}`);
  if (opciones.miembros !== false) {
    await addMembership(service, owner, id, "owner");
    await addMembership(service, staff, id, "staff");
  }
  return { id, branch: b.data.id, table: mesas.data[0].id, table2: mesas.data[1].id, category, product: p.data.id };
}

type Linea = {
  order_id: string;
  item_id: string;
  product_name: string;
  quantity: number;
  base_price_cents: number;
  unit_price_cents: number;
  promotion_id: string | null;
  promotion_name: string | null;
  replayed: boolean;
};

const anotar = (db: Db, l: Pick<Local, "branch" | "table" | "product">, extra: Partial<{ p_branch: string; p_table: string; p_product: string; p_quantity: number | null; p_client_key: string | null }> = {}) =>
  db.rpc("add_order_item", {
    p_branch: l.branch,
    p_table: l.table,
    p_product: l.product,
    p_quantity: 1,
    p_client_key: randomUUID(),
    ...extra,
  } as never);

const linea = (r: { data: unknown; error: { message: string } | null }): Linea => {
  if (r.error) throw new Error(`add_order_item: ${r.error.message}`);
  return r.data as Linea;
};

const cuenta = (tabla: "orders" | "order_items", orgId: string) => Number(sql(`select count(*) from public.${tabla} where organization_id = '${orgId}'`)[0][0]);

/** Una promoción de todos los días y todo el día, por el servicio técnico (el panel es otra ficha). */
async function promocionDelCincuenta(l: Local): Promise<string> {
  const p = await service
    .from("promotions")
    .insert({ organization_id: l.id, name: "Mitad de precio", discount_type: "percent", discount_value: 50, weekdays_mask: 127, start_minute: 0, end_minute: 1440 })
    .select("id")
    .single();
  if (p.error) throw new Error(`promoción: ${p.error.message}`);
  const t = await service.from("promotion_targets").insert({ organization_id: l.id, promotion_id: p.data.id, product_id: l.product });
  if (t.error) throw new Error(`objetivo: ${t.error.message}`);
  return p.data.id;
}

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([
    createUser(service, "ped-owner"),
    createUser(service, "ped-staff"),
    createUser(service, "ped-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, stranger].map((u) => deleteUser(service, u)));
});

describe("el catálogo", () => {
  it("orders está en Pro y Premium y no en Básico", async () => {
    const planes = await service.from("plans").select("code, features").order("code");
    const porCodigo = Object.fromEntries((planes.data ?? []).map((p) => [p.code, p.features]));
    expect(porCodigo.basic).not.toContain("orders");
    expect(porCodigo.pro).toContain("orders");
    expect(porCodigo.premium).toContain("orders");
  });
});

describe("anotar una línea", () => {
  it("el Dueño y el Staff abren el pedido de la mesa y la línea copia nombre, cantidad y precios", async () => {
    const l = await nuevoLocal();
    const primera = linea(await anotar(owner.db, l, { p_quantity: 3 }));
    expect(primera).toMatchObject({ product_name: "Cerveza", quantity: 3, base_price_cents: 1000, unit_price_cents: 1000, promotion_id: null, promotion_name: null, replayed: false });

    const pedido = await service.from("orders").select("*").eq("id", primera.order_id).single();
    expect(pedido.data).toMatchObject({ organization_id: l.id, branch_id: l.branch, table_id: l.table, table_label: "Mesa 1", status: "open", opened_by: owner.id, closed_at: null });
    const fila = await service.from("order_items").select("*").eq("id", primera.item_id).single();
    expect(fila.data).toMatchObject({ order_id: primera.order_id, product_id: l.product, product_name: "Cerveza", quantity: 3, status: "noted", created_by: owner.id });

    // El Staff anota en la misma mesa: mismo pedido.
    const segunda = linea(await anotar(staff.db, l));
    expect(segunda.order_id).toBe(primera.order_id);
    expect(cuenta("orders", l.id)).toBe(1);
    expect(cuenta("order_items", l.id)).toBe(2);
  });

  it("otra mesa abre otro pedido", async () => {
    const l = await nuevoLocal();
    const a = linea(await anotar(owner.db, l));
    const b = linea(await anotar(owner.db, l, { p_table: l.table2 }));
    expect(b.order_id).not.toBe(a.order_id);
    expect(cuenta("orders", l.id)).toBe(2);
  });

  it("el precio es el efectivo de la base: con una promoción en curso se copia con ella; sin promoción, el de lista", async () => {
    const l = await nuevoLocal();
    expect(linea(await anotar(owner.db, l)).unit_price_cents).toBe(1000);
    const promo = await promocionDelCincuenta(l);
    const conPromo = linea(await anotar(owner.db, l));
    expect(conPromo).toMatchObject({ base_price_cents: 1000, unit_price_cents: 500, promotion_id: promo, promotion_name: "Mitad de precio" });
    // Lo anotado no cambia cuando la promoción se va.
    await service.from("promotions").update({ is_active: false }).eq("id", promo);
    const fila = await service.from("order_items").select("unit_price_cents, promotion_name").eq("id", conPromo.item_id).single();
    expect(fila.data).toEqual({ unit_price_cents: 500, promotion_name: "Mitad de precio" });
    expect(linea(await anotar(owner.db, l)).unit_price_cents).toBe(1000);
  });

  it("el precio de la sucursal (precio propio) es la base de la línea", async () => {
    const l = await nuevoLocal();
    const r = await service.from("product_availability").insert({ organization_id: l.id, branch_id: l.branch, product_id: l.product, is_available: true, price_cents: 1500 });
    expect(r.error).toBeNull();
    expect(linea(await anotar(owner.db, l))).toMatchObject({ base_price_cents: 1500, unit_price_cents: 1500 });
  });

  it("no hay forma de pasar un precio: la función no tiene ese parámetro", async () => {
    const l = await nuevoLocal();
    const r = await owner.db.rpc("add_order_item", {
      p_branch: l.branch, p_table: l.table, p_product: l.product, p_quantity: 1, p_client_key: randomUUID(), p_price_cents: 1,
    } as never);
    expect(r.error).not.toBeNull();
    expect(cuenta("order_items", l.id)).toBe(0);
  });

  it("dos primeras líneas a la vez en una mesa vacía terminan en un solo pedido", async () => {
    for (let i = 0; i < 3; i++) {
      const l = await nuevoLocal();
      const resultados = await Promise.all([owner.db, staff.db, owner.db, staff.db, owner.db].map((db) => anotar(db, l)));
      const lineas = resultados.map(linea);
      expect(new Set(lineas.map((x) => x.order_id)).size, `iteración ${i}`).toBe(1);
      expect(cuenta("orders", l.id)).toBe(1);
      expect(cuenta("order_items", l.id)).toBe(5);
    }
  });
});

describe("el reintento con client_key", () => {
  it("repetir la llamada devuelve la línea ya creada y no suma otra", async () => {
    const l = await nuevoLocal();
    const clave = randomUUID();
    const a = linea(await anotar(owner.db, l, { p_quantity: 2, p_client_key: clave }));
    const b = linea(await anotar(owner.db, l, { p_quantity: 2, p_client_key: clave }));
    expect(a.replayed).toBe(false);
    expect(b).toMatchObject({ replayed: true, item_id: a.item_id, order_id: a.order_id, quantity: 2 });
    expect(cuenta("order_items", l.id)).toBe(1);
  });

  it("la misma clave con otro plato, otra cantidad u otra mesa se rechaza (client_key_reused)", async () => {
    const l = await nuevoLocal();
    const otro = await service.from("products").insert({ organization_id: l.id, category_id: l.category, name: "Vino", price_cents: 2000 }).select("id").single();
    const clave = randomUUID();
    linea(await anotar(owner.db, l, { p_client_key: clave }));
    for (const cambio of [{ p_product: otro.data!.id }, { p_quantity: 2 }, { p_table: l.table2 }]) {
      expect((await anotar(owner.db, l, { p_client_key: clave, ...cambio })).error?.message, JSON.stringify(cambio)).toBe("client_key_reused");
    }
    expect(cuenta("order_items", l.id)).toBe(1);
  });

  it("repetir exactamente la petición después de que se borró el plato o la mesa devuelve la línea (no client_key_reused)", async () => {
    const l = await nuevoLocal();
    const clave = randomUUID();
    const a = linea(await anotar(owner.db, l, { p_client_key: clave }));
    expect((await service.from("products").delete().eq("id", l.product)).error).toBeNull();
    const dePlato = await anotar(owner.db, l, { p_client_key: clave });
    expect(linea(dePlato)).toMatchObject({ replayed: true, item_id: a.item_id });
    expect((await service.from("tables").delete().eq("id", l.table)).error).toBeNull();
    expect(linea(await anotar(owner.db, l, { p_client_key: clave })).replayed).toBe(true);
    expect(cuenta("order_items", l.id)).toBe(1);
  });

  it("el mismo toque repetido a la vez deja una sola línea", async () => {
    for (let i = 0; i < 3; i++) {
      const l = await nuevoLocal();
      const clave = randomUUID();
      const resultados = await Promise.all([1, 2, 3, 4].map(() => anotar(owner.db, l, { p_client_key: clave })));
      const lineas = resultados.map(linea);
      expect(new Set(lineas.map((x) => x.item_id)).size, `iteración ${i}`).toBe(1);
      expect(lineas.filter((x) => !x.replayed)).toHaveLength(1);
      expect(cuenta("order_items", l.id)).toBe(1);
      expect(cuenta("orders", l.id)).toBe(1);
    }
  });

  it("la clave es de la organización: otra organización puede usar la misma sin chocar", async () => {
    const a = await nuevoLocal();
    const b = await nuevoLocal();
    const clave = randomUUID();
    linea(await anotar(owner.db, a, { p_client_key: clave }));
    expect(linea(await anotar(owner.db, b, { p_client_key: clave })).replayed).toBe(false);
  });
});

describe("quién anota: plan y mora", () => {
  it("Básico no; con una vista previa vigente sí, y al vencer deja de poder", async () => {
    const l = await nuevoLocal("basic");
    expect((await anotar(owner.db, l)).error?.message).toBe("orders_not_allowed");
    expect(cuenta("orders", l.id)).toBe(0);

    sql(`insert into public.organization_feature_previews (organization_id, feature, ends_at, reason) values ('${l.id}', 'orders', now() + interval '5 days', 'Piloto')`);
    expect(linea(await anotar(owner.db, l)).replayed).toBe(false);

    sql(`update public.organization_feature_previews set ends_at = now() - interval '1 minute' where organization_id = '${l.id}'`);
    expect((await anotar(owner.db, l)).error?.message).toBe("orders_not_allowed");
    expect(cuenta("order_items", l.id)).toBe(1);
  });

  it("en gracia sí; en solo lectura y suspendida no, y sigue pudiéndose leer lo anotado", async () => {
    const l = await nuevoLocal();
    linea(await anotar(owner.db, l));
    await setSubscription(service, l.id, { finEnMs: -3 * DIA_MS }); // gracia
    expect(linea(await anotar(owner.db, l)).replayed).toBe(false);
    for (const dias of [10, 20]) {
      await setSubscription(service, l.id, { finEnMs: -dias * DIA_MS }); // solo lectura, suspendida
      expect((await anotar(owner.db, l)).error?.message, `${dias} días de mora`).toBe("orders_not_allowed");
    }
    expect(cuenta("order_items", l.id)).toBe(2);
    await setSubscription(service, l.id, { finEnMs: -10 * DIA_MS });
    expect((await staff.db.from("order_items").select("id").eq("organization_id", l.id)).data).toHaveLength(2);
  });

  it("sin sesión, o sin ser miembro de la organización de la sucursal, no (y no se entera de qué hay)", async () => {
    const l = await nuevoLocal();
    const otro = await nuevoLocal("pro", { miembros: false });
    await addMembership(service, stranger, otro.id, "owner");
    expect((await anotar(anonClient(), l)).error?.message).toMatch(/orders_not_allowed|permission denied/);
    // Un miembro de otra organización con plan: mismo error con una sucursal ajena, con una mesa ajena o con un plato ajeno.
    expect((await anotar(stranger.db, l)).error?.message).toBe("orders_not_allowed");
    expect((await anotar(stranger.db, otro, { p_table: l.table })).error?.message).toBe("table_not_found");
    expect((await anotar(stranger.db, otro, { p_product: l.product })).error?.message).toBe("product_unavailable");
    expect(cuenta("orders", l.id)).toBe(0);
    expect(cuenta("orders", otro.id)).toBe(0);
  });
});

describe("la autorización se revalida después de esperar", () => {
  it("una membresía revocada mientras la llamada espera el candado del pedido no la deja anotar", async () => {
    const l = await nuevoLocal();
    const primera = linea(await anotar(staff.db, l));
    // Otra sesión retiene el candado del pedido unos segundos; la llamada del Staff queda esperando.
    const retiene = spawn(
      "docker",
      ["exec", "supabase_db_ucomenu", "psql", "-U", "postgres", "-c", `begin; select 1 from public.orders where id = '${primera.order_id}' for update; select pg_sleep(4); commit;`],
      { stdio: "ignore" },
    );
    await new Promise((r) => setTimeout(r, 2000));
    // `.then` fuerza el envío: el cliente no manda la llamada hasta que alguien la espera.
    const espera = anotar(staff.db, l).then((r) => r);
    await new Promise((r) => setTimeout(r, 800));
    // La llamada tiene que estar de verdad bloqueada esperando el candado del pedido.
    expect(Number(sql("select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%add_order_item%'")[0][0])).toBeGreaterThanOrEqual(1);
    const baja = await service.from("memberships").delete().eq("organization_id", l.id).eq("user_id", staff.id);
    expect(baja.error).toBeNull();
    expect((await espera).error?.message).toBe("orders_not_allowed");
    await new Promise((r) => retiene.on("exit", r));
    expect(cuenta("order_items", l.id)).toBe(1);
    await addMembership(service, staff, l.id, "staff");
  });
});

describe("qué rechaza", () => {
  it("sucursal inexistente, desactivada o ajena; mesa ajena, de otra sucursal o desactivada", async () => {
    const l = await nuevoLocal();
    const otro = await nuevoLocal();
    expect((await anotar(owner.db, l, { p_branch: randomUUID() })).error?.message).toBe("branch_not_found");
    expect((await anotar(owner.db, l, { p_table: randomUUID() })).error?.message).toBe("table_not_found");
    expect((await anotar(owner.db, l, { p_table: otro.table })).error?.message).toBe("table_not_found");
    await service.from("tables").update({ is_active: false }).eq("id", l.table);
    expect((await anotar(owner.db, l)).error?.message).toBe("table_not_found");
    await service.from("branches").update({ is_active: false }).eq("id", l.branch);
    expect((await anotar(owner.db, l, { p_table: l.table2 })).error?.message).toBe("branch_not_found");
    expect(cuenta("orders", l.id)).toBe(0);
  });

  it("plato inexistente, de otra organización, inactivo, de categoría inactiva o agotado en la sucursal", async () => {
    const l = await nuevoLocal();
    const otro = await nuevoLocal();
    expect((await anotar(owner.db, l, { p_product: randomUUID() })).error?.message).toBe("product_unavailable");
    expect((await anotar(owner.db, l, { p_product: otro.product })).error?.message).toBe("product_unavailable");

    const inactivo = await service.from("products").insert({ organization_id: l.id, category_id: l.category, name: "Viejo", price_cents: 500, is_active: false }).select("id").single();
    expect((await anotar(owner.db, l, { p_product: inactivo.data!.id })).error?.message).toBe("product_unavailable");

    const catOff = await service.from("categories").insert({ organization_id: l.id, name: "Temporada", is_active: false }).select("id").single();
    const enCatOff = await service.from("products").insert({ organization_id: l.id, category_id: catOff.data!.id, name: "Zapallo", price_cents: 500 }).select("id").single();
    expect((await anotar(owner.db, l, { p_product: enCatOff.data!.id })).error?.message).toBe("product_unavailable");

    await service.from("product_availability").insert({ organization_id: l.id, branch_id: l.branch, product_id: l.product, is_available: false });
    expect((await anotar(owner.db, l)).error?.message).toBe("product_unavailable");
    expect(cuenta("orders", l.id)).toBe(0);
    // Vuelve a estar disponible: se puede.
    await service.from("product_availability").update({ is_available: true }).eq("branch_id", l.branch).eq("product_id", l.product);
    expect(linea(await anotar(owner.db, l)).replayed).toBe(false);
  });

  it("un plato con un grupo de opciones obligatorio falla cerrado; uno con solo adicionales opcionales se anota", async () => {
    const l = await nuevoLocal();
    const g = await service.from("option_groups").insert({ organization_id: l.id, product_id: l.product, name: "Tamaño", min_choices: 1, max_choices: 1 }).select("id").single();
    await service.from("options").insert({ organization_id: l.id, group_id: g.data!.id, name: "Chico", price_delta_cents: 0 });
    expect((await anotar(owner.db, l)).error?.message).toBe("options_required");
    expect(cuenta("orders", l.id)).toBe(0);

    // Con el grupo pausado ya no es obligatorio.
    await service.from("option_groups").update({ is_active: false }).eq("id", g.data!.id);
    expect(linea(await anotar(owner.db, l)).replayed).toBe(false);

    // Un adicional opcional (mínimo 0) no impide anotar.
    await service.from("option_groups").insert({ organization_id: l.id, product_id: l.product, name: "Extras", min_choices: 0, max_choices: 3 });
    expect(linea(await anotar(owner.db, l)).replayed).toBe(false);
  });

  it("cantidad 0, 100, negativa o nula; clave nula", async () => {
    const l = await nuevoLocal();
    for (const q of [0, 100, -1, null]) {
      expect((await anotar(owner.db, l, { p_quantity: q })).error?.message, `cantidad ${q}`).toBe("invalid_quantity");
    }
    expect((await anotar(owner.db, l, { p_client_key: null })).error?.message).toBe("invalid_client_key");
    expect(linea(await anotar(owner.db, l, { p_quantity: 99 })).quantity).toBe(99);
    expect(cuenta("order_items", l.id)).toBe(1);
  });

  it("un pedido con 200 líneas no admite otra", async () => {
    const l = await nuevoLocal();
    const primera = linea(await anotar(owner.db, l));
    sql(`
      insert into public.order_items (organization_id, order_id, product_id, product_name, quantity, base_price_cents, unit_price_cents, client_key, request_hash)
      select '${l.id}', '${primera.order_id}', '${l.product}', 'Cerveza', 1, 1000, 1000, gen_random_uuid(), 'x' from generate_series(1, 199)`);
    expect(cuenta("order_items", l.id)).toBe(200);
    expect((await anotar(owner.db, l)).error?.message).toBe("order_full");
    expect(cuenta("order_items", l.id)).toBe(200);
    // Otra mesa no se ve afectada.
    expect(linea(await anotar(owner.db, l, { p_table: l.table2 })).replayed).toBe(false);
  });

  it("si la línea falla DESPUÉS de abrir el pedido, el pedido recién abierto tampoco queda (una sola transacción)", async () => {
    const l = await nuevoLocal();
    // Un disparador de prueba hace fallar el INSERT de la línea, cuando el pedido ya se abrió dentro de la misma llamada.
    sql(`create function public.tt_falla_linea() returns trigger language plpgsql as $$ begin raise exception 'tt_falla'; end $$`);
    sql(`create trigger tt_falla_linea before insert on public.order_items for each row when (new.organization_id = '${l.id}') execute function public.tt_falla_linea()`);
    try {
      expect((await anotar(owner.db, l)).error?.message).toContain("tt_falla");
    } finally {
      sql("drop trigger tt_falla_linea on public.order_items");
      sql("drop function public.tt_falla_linea()");
    }
    expect(cuenta("orders", l.id)).toBe(0);
    expect(cuenta("order_items", l.id)).toBe(0);
    expect(linea(await anotar(owner.db, l)).replayed).toBe(false);
  });
});

describe("lectura y escritura por la API", () => {
  it("lee un miembro de la organización; otra organización y anon no ven nada", async () => {
    const l = await nuevoLocal();
    const otro = await nuevoLocal("pro", { miembros: false });
    await addMembership(service, stranger, otro.id, "staff");
    linea(await anotar(owner.db, l));

    expect((await staff.db.from("orders").select("id").eq("organization_id", l.id)).data).toHaveLength(1);
    expect((await staff.db.from("order_items").select("id").eq("organization_id", l.id)).data).toHaveLength(1);
    expect((await stranger.db.from("orders").select("id").eq("organization_id", l.id)).data).toEqual([]);
    expect((await stranger.db.from("order_items").select("id").eq("organization_id", l.id)).data).toEqual([]);
    const anon = anonClient();
    expect((await anon.from("orders").select("id")).error).not.toBeNull();
    expect((await anon.from("order_items").select("id")).error).not.toBeNull();
  });

  it("nadie escribe las tablas por la API: ni el Dueño, ni el Staff, ni anon, ni el servicio técnico", async () => {
    const l = await nuevoLocal();
    const a = linea(await anotar(owner.db, l));
    const pedido = { organization_id: l.id, branch_id: l.branch, table_id: l.table2, table_label: "Mesa 2" };
    const item = { organization_id: l.id, order_id: a.order_id, product_name: "Cerveza", quantity: 1, base_price_cents: 1000, unit_price_cents: 1, client_key: randomUUID(), request_hash: "x" };
    for (const [quien, db] of [["Dueño", owner.db], ["Staff", staff.db], ["anon", anonClient()], ["servicio", service]] as const) {
      expect((await db.from("orders").insert(pedido)).error?.code, `${quien}: insert orders`).toMatch(/42501|PGRST/);
      expect((await db.from("order_items").insert(item)).error?.code, `${quien}: insert order_items`).toMatch(/42501|PGRST/);
      const upd = await db.from("order_items").update({ unit_price_cents: 1 }).eq("id", a.item_id).select("id");
      expect(upd.error?.code ?? "sin filas", `${quien}: update`).toMatch(/42501|PGRST|sin filas/);
      expect((await db.from("orders").delete().eq("id", a.order_id).select("id")).data ?? []).toEqual([]);
    }
    const fila = await service.from("order_items").select("unit_price_cents").eq("id", a.item_id).single();
    expect(fila.data?.unit_price_cents).toBe(1000);
    expect(cuenta("orders", l.id)).toBe(1);
    expect(cuenta("order_items", l.id)).toBe(1);
  });

  it("los permisos de las tablas: anon ninguno; authenticated solo SELECT; service_role solo SELECT", () => {
    for (const tabla of ["orders", "order_items"]) {
      for (const [rol, esperado] of [["anon", "f"], ["authenticated", "t"], ["service_role", "t"]] as const) {
        const fila = sql(
          `select ${["select", "insert", "update", "delete", "truncate", "references", "trigger"].map((p) => `has_table_privilege('${rol}', 'public.${tabla}', '${p}')`).join(", ")}`,
        )[0];
        expect(fila, `${tabla}: ${rol}`).toEqual([rol === "anon" ? "f" : esperado, "f", "f", "f", "f", "f", "f"]);
      }
    }
  });
});

describe("la copia y los borrados", () => {
  it("borrar el plato o la mesa conserva la línea y el pedido con su copia", async () => {
    const l = await nuevoLocal();
    const a = linea(await anotar(owner.db, l, { p_quantity: 2 }));
    await service.from("products").update({ name: "Cerveza IPA", price_cents: 9999 }).eq("id", l.product);
    const intacta = await service.from("order_items").select("product_name, base_price_cents, unit_price_cents").eq("id", a.item_id).single();
    expect(intacta.data).toEqual({ product_name: "Cerveza", base_price_cents: 1000, unit_price_cents: 1000 });

    const bp = await service.from("products").delete().eq("id", l.product);
    expect(bp.error).toBeNull();
    const sinPlato = await service.from("order_items").select("product_id, product_name, quantity").eq("id", a.item_id).single();
    expect(sinPlato.data).toEqual({ product_id: null, product_name: "Cerveza", quantity: 2 });

    const bm = await service.from("tables").delete().eq("id", l.table);
    expect(bm.error).toBeNull();
    const sinMesa = await service.from("orders").select("table_id, table_label, status").eq("id", a.order_id).single();
    expect(sinMesa.data).toEqual({ table_id: null, table_label: "Mesa 1", status: "open" });
  });

  it("borrar la organización se lleva sus pedidos y no toca los de otra", async () => {
    const l = await nuevoLocal();
    const otro = await nuevoLocal();
    linea(await anotar(owner.db, l));
    linea(await anotar(owner.db, otro));
    orgs.splice(orgs.indexOf(l.id), 1);
    await deleteOrg(service, l.id);
    expect(cuenta("orders", l.id)).toBe(0);
    expect(cuenta("order_items", l.id)).toBe(0);
    expect(cuenta("orders", otro.id)).toBe(1);
  });
});
