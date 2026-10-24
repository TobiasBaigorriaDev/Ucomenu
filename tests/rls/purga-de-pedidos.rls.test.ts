import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  type TestUser,
} from "./helpers";

/**
 * Retención de pedidos (ficha retencion-de-pedidos, ADR 0043) contra el Supabase local: `purge_expired_orders` borra por lotes los
 * pedidos CERRADOS o ANULADOS de más de 2 años (piso 1 año) con sus líneas, opciones y eventos; nunca un pedido abierto; solo la
 * ejecuta `service_role`; deja el registro de solo-agregado encendido; y es atómica.
 *
 * Los pedidos se anotan con la función real y después se envejecen con SQL directo (nadie escribe `orders` por la API). La purga es
 * global: estas pruebas solo crean pedidos de más de un año en SUS organizaciones, y ninguna otra suite los tiene.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
const orgs: string[] = [];
let contador = 0;
const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

type Local = { id: string; branch: string; mesa: string; product: string; option: string };

async function nuevoLocal(): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-purgaped-${sufijo}-${contador}`, "pro");
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const b = await service.from("branches").insert({ organization_id: id, slug: "principal", name: "Centro" }).select("id").single();
  if (b.error) throw new Error(`sucursal: ${b.error.message}`);
  const m = await service.from("tables").insert({ organization_id: id, branch_id: b.data.id, label: "Mesa 1" }).select("id").single();
  if (m.error) throw new Error(`mesa: ${m.error.message}`);
  const category = await createCategory(service, id, "Platos");
  const p = await service.from("products").insert({ organization_id: id, category_id: category, name: "Bife", price_cents: 10000 }).select("id").single();
  if (p.error) throw new Error(`plato: ${p.error.message}`);
  const g = await service.from("option_groups").insert({ organization_id: id, product_id: p.data.id, name: "Extras", min_choices: 0, max_choices: 2 }).select("id").single();
  const o = await service.from("options").insert({ organization_id: id, group_id: g.data!.id, name: "Bacon", price_delta_cents: 1500 }).select("id").single();
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, branch: b.data.id, mesa: m.data.id, product: p.data.id, option: o.data!.id };
}

type Cierre = "closed" | "void" | "open";

/**
 * Anota un pedido (con una línea con opción y nota, y otra más), lo cierra, anula o deja abierto, y lo envejece: `closed_at` (o
 * `opened_at` si sigue abierto) queda `hace` atrás. Devuelve los ids.
 */
async function pedido(l: Local, cierre: Cierre, hace: string): Promise<{ order: string; items: string[] }> {
  const anotar = async (extra: Record<string, unknown>) => {
    const r = await owner.db.rpc("add_order_item", {
      p_branch: l.branch,
      p_table: l.mesa,
      p_product: l.product,
      p_quantity: 1,
      p_client_key: randomUUID(),
      ...extra,
    } as never);
    if (r.error) throw new Error(`add_order_item: ${r.error.message}`);
    return r.data as { order_id: string; item_id: string };
  };
  const a = await anotar({ p_options: [l.option], p_note: "sin sal" });
  const b = await anotar({ p_quantity: 2 });
  expect((await owner.db.rpc("set_order_item_status", { p_item: b.item_id, p_status: "delivered" })).error).toBeNull();
  if (cierre === "closed") expect((await owner.db.rpc("close_order", { p_order: a.order_id })).error).toBeNull();
  if (cierre === "void") expect((await owner.db.rpc("void_order", { p_order: a.order_id, p_reason: "Error" })).error).toBeNull();
  // Sin disparadores de usuario ni la protección del registro: solo se mueve una fecha.
  const columna = cierre === "open" ? "opened_at" : "closed_at";
  sql(`set session_replication_role = replica; update public.orders set ${columna} = now() - interval '${hace}' where id = '${a.order_id}'`);
  return { order: a.order_id, items: [a.item_id, b.item_id] };
}

const cuenta = (tabla: string, columna: string, id: string) => Number(sql(`select count(*) from public.${tabla} where ${columna} = '${id}'`)[0][0]);
const pedidosDe = (orgId: string) => Number(sql(`select count(*) from public.orders where organization_id = '${orgId}'`)[0][0]);
const idsDe = (orgId: string) => sql(`select id from public.orders where organization_id = '${orgId}' order by closed_at nulls last, id`).map((r) => r[0]);
const triggerEncendido = () => sql(`select tgenabled from pg_trigger where tgname = 'order_events_no_update_delete'`)[0][0] === "O";

type Resumen = { orders: number; items: number; options: number; events: number; cutoff: string };
const purgar = async (args: Record<string, unknown> = {}) => {
  const r = await service.rpc("purge_expired_orders", args as never);
  return { error: r.error, data: r.data as Resumen | null };
};

beforeAll(async () => {
  service = serviceClient();
  [owner, staff] = await Promise.all([createUser(service, "purgaped-owner"), createUser(service, "purgaped-staff")]);
});

// Cada prueba parte sin pedidos vencidos de la anterior (la purga es global).
beforeEach(async () => {
  const r = await purgar({ p_retention: "1 year", p_batch: 5000 });
  expect(r.error).toBeNull();
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff].map((u) => deleteUser(service, u)));
});

describe("permisos", () => {
  it("la ejecuta service_role y nadie más por la API; las tablas siguen sin escritura", async () => {
    for (const quien of [anonClient(), owner.db, staff.db]) {
      const r = await quien.rpc("purge_expired_orders" as never);
      expect(r.error?.code, "no debe poder ejecutarla").toBe("42501");
    }
    expect((await purgar()).error).toBeNull();
    const l = await nuevoLocal();
    const p = await pedido(l, "closed", "3 years");
    for (const quien of [owner.db, staff.db, service]) {
      const r = await quien.from("orders").delete().eq("id", p.order).select("id");
      expect(r.error?.code, "no debe poder borrar pedidos por la API").toBe("42501");
    }
    expect(pedidosDe(l.id)).toBe(1);
  });
});

describe("qué purga", () => {
  it("borra los pedidos cerrados y anulados de más de 2 años de cualquier organización, con líneas, opciones y eventos; conserva el resto, incluido todo pedido abierto", async () => {
    const a = await nuevoLocal();
    const b = await nuevoLocal();
    const viejoCerrado = await pedido(a, "closed", "2 years 1 day");
    const viejoAnulado = await pedido(b, "void", "3 years");
    const casiDosAnios = await pedido(a, "closed", "1 year 364 days");
    const reciente = await pedido(a, "closed", "1 day");
    const abiertoViejo = await pedido(b, "open", "3 years");

    const antes = {
      eventosConservados: [casiDosAnios, reciente, abiertoViejo].map((p) => cuenta("order_events", "order_id", p.order)),
      itemsConservados: [casiDosAnios, reciente, abiertoViejo].map((p) => cuenta("order_items", "order_id", p.order)),
    };
    expect(cuenta("order_events", "order_id", viejoCerrado.order)).toBeGreaterThan(0);
    expect(cuenta("order_item_options", "order_item_id", viejoCerrado.items[0])).toBe(1);

    const r = await purgar();
    expect(r.error).toBeNull();
    // Dos pedidos: 2 líneas cada uno (1 opción en la primera línea), con sus eventos.
    expect(r.data).toMatchObject({ orders: 2, items: 4, options: 2 });
    expect(r.data!.events).toBeGreaterThanOrEqual(2 * 5);

    for (const p of [viejoCerrado, viejoAnulado]) {
      expect(cuenta("orders", "id", p.order)).toBe(0);
      expect(cuenta("order_items", "order_id", p.order)).toBe(0);
      expect(cuenta("order_events", "order_id", p.order)).toBe(0);
      for (const item of p.items) expect(cuenta("order_item_options", "order_item_id", item)).toBe(0);
    }
    for (const p of [casiDosAnios, reciente, abiertoViejo]) expect(cuenta("orders", "id", p.order)).toBe(1);
    expect([casiDosAnios, reciente, abiertoViejo].map((p) => cuenta("order_events", "order_id", p.order))).toEqual(antes.eventosConservados);
    expect([casiDosAnios, reciente, abiertoViejo].map((p) => cuenta("order_items", "order_id", p.order))).toEqual(antes.itemsConservados);
    expect(cuenta("order_item_options", "order_item_id", casiDosAnios.items[0])).toBe(1);
    expect(pedidosDe(a.id)).toBe(2);
    expect(pedidosDe(b.id)).toBe(1);
  });

  it("un pedido abierto no se purga ni con la retención mínima", async () => {
    const l = await nuevoLocal();
    const abierto = await pedido(l, "open", "10 years");
    const r = await purgar({ p_retention: "1 year" });
    expect(r.error).toBeNull();
    expect(cuenta("orders", "id", abierto.order)).toBe(1);
    expect(cuenta("order_items", "order_id", abierto.order)).toBe(2);
  });

  it("después de purgar, el registro sigue siendo de solo-agregado y el pedido nuevo de la misma mesa funciona", async () => {
    const l = await nuevoLocal();
    const viejo = await pedido(l, "closed", "3 years");
    const quedan = await pedido(l, "closed", "1 day");
    expect((await purgar()).error).toBeNull();
    expect(triggerEncendido()).toBe(true);
    // Ni con los privilegios del dueño de la tabla se reescribe o borra lo que quedó.
    expect(() => sql(`delete from public.order_events where order_id = '${quedan.order}'`)).toThrow(/solo agregado/);
    expect(() => sql(`update public.order_events set event = event where order_id = '${quedan.order}'`)).toThrow(/solo agregado/);
    expect(cuenta("order_events", "order_id", quedan.order)).toBeGreaterThan(0);
    expect(cuenta("orders", "id", viejo.order)).toBe(0);
    const nuevo = await owner.db.rpc("add_order_item", { p_branch: l.branch, p_table: l.mesa, p_product: l.product, p_quantity: 1, p_client_key: randomUUID() });
    expect(nuevo.error).toBeNull();
  });
});

describe("parámetros", () => {
  it("rechaza retenciones fuera de rango y lotes inválidos sin borrar nada; 1 año exacto es válido", async () => {
    const l = await nuevoLocal();
    const viejo = await pedido(l, "closed", "3 years");
    const malas: Record<string, unknown>[] = [
      { p_retention: null },
      { p_retention: "364 days" },
      { p_retention: "6 months" },
      { p_retention: "0 days" },
      { p_retention: "-1 year" },
      { p_retention: "-infinity" },
      { p_retention: "1 year -3 days" },
      { p_retention: "-4800 months 144007 days" },
      { p_batch: 0 },
      { p_batch: -1 },
      { p_batch: 5001 },
      { p_batch: null },
    ];
    for (const args of malas) {
      const r = await purgar(args);
      expect(r.error?.code, JSON.stringify(args)).toBe("22023");
      expect(cuenta("orders", "id", viejo.order), JSON.stringify(args)).toBe(1);
    }
    expect((await purgar({ p_retention: "1 year", p_batch: 5000 })).error).toBeNull();
    expect(cuenta("orders", "id", viejo.order)).toBe(0);
  });
});

describe("lotes y repetición", () => {
  it("borra a lo sumo un lote, los más viejos primero; repetir llega a cero y una corrida sin nada no borra", async () => {
    const l = await nuevoLocal();
    // Ocho vencidos de 10 a 3 años (el orden de creación no es el de antigüedad: se crean de los más nuevos a los más viejos) y uno reciente.
    const viejos: { order: string; items: string[] }[] = [];
    for (let anios = 3; anios <= 10; anios++) viejos.push(await pedido(l, anios % 2 ? "void" : "closed", `${anios} years`));
    const reciente = await pedido(l, "closed", "1 day");
    const masViejos = viejos.slice(-3).map((p) => p.order); // 10, 9 y 8 años

    const primera = await purgar({ p_batch: 3 });
    expect(primera.data?.orders).toBe(3);
    for (const id of masViejos) expect(cuenta("orders", "id", id), "se purgaron primero los más viejos").toBe(0);
    for (const p of viejos.slice(0, -3)) expect(cuenta("orders", "id", p.order)).toBe(1);

    expect((await purgar({ p_batch: 3 })).data?.orders).toBe(3);
    expect((await purgar({ p_batch: 3 })).data?.orders).toBe(2);
    const ultima = await purgar({ p_batch: 3 });
    expect(ultima.data).toMatchObject({ orders: 0, items: 0, options: 0, events: 0 });
    expect(idsDe(l.id)).toEqual([reciente.order]);
  });
});

describe("atomicidad y concurrencia", () => {
  it("un fallo a mitad del lote no borra nada (ni eventos, ni opciones, ni líneas) y deja el registro protegido", async () => {
    const l = await nuevoLocal();
    const viejo = await pedido(l, "closed", "3 years");
    const eventos = cuenta("order_events", "order_id", viejo.order);
    expect(eventos).toBeGreaterThan(0);
    const nombre = `tt_falla_${contador}_${Date.now()}`;
    // Un disparador de prueba que rechaza el borrado de ESTE pedido (el último paso del lote): lo anterior tiene que deshacerse.
    sql(`create function public.${nombre}() returns trigger language plpgsql as $$ begin if old.id = '${viejo.order}'::uuid then raise exception 'tt_falla'; end if; return old; end; $$`);
    sql(`create trigger ${nombre} before delete on public.orders for each row execute function public.${nombre}()`);
    try {
      const r = await purgar();
      expect(r.error?.message).toContain("tt_falla");
      expect(cuenta("orders", "id", viejo.order)).toBe(1);
      expect(cuenta("order_items", "order_id", viejo.order)).toBe(2);
      expect(cuenta("order_item_options", "order_item_id", viejo.items[0])).toBe(1);
      expect(cuenta("order_events", "order_id", viejo.order)).toBe(eventos);
      expect(triggerEncendido()).toBe(true);
    } finally {
      sql(`drop trigger ${nombre} on public.orders`);
      sql(`drop function public.${nombre}()`);
    }
    // Sin el disparador, la siguiente corrida lo purga entero.
    expect((await purgar()).data?.orders).toBeGreaterThanOrEqual(1);
    expect(cuenta("orders", "id", viejo.order)).toBe(0);
  });

  it("un pedido bloqueado por otra transacción se salta sin esperar y se purga cuando se libera", async () => {
    const contenedor = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
    const l = await nuevoLocal();
    const bloqueado = await pedido(l, "closed", "5 years");
    const libre = await pedido(l, "closed", "4 years");

    const SEGUNDOS = 8;
    const titular = spawn(
      "docker",
      ["exec", contenedor, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", `begin; select id from public.orders where id = '${bloqueado.order}' for update; select pg_sleep(${SEGUNDOS}); commit;`],
      { stdio: "ignore" },
    );
    const termino = new Promise<void>((resolve) => titular.once("close", () => resolve()));
    try {
      let retenida = false;
      for (let i = 0; i < 50 && !retenida; i++) {
        try {
          sql(`select 1 from public.orders where id = '${bloqueado.order}' for update nowait`);
          await new Promise((r) => setTimeout(r, 100));
        } catch (error) {
          if (!String(error).includes("could not obtain lock")) throw error;
          retenida = true;
        }
      }
      expect(retenida, "el titular no llegó a bloquear el pedido").toBe(true);

      const t0 = Date.now();
      const durante = await purgar({ p_batch: 10 });
      expect(durante.error).toBeNull();
      expect(Date.now() - t0, "la purga esperó al bloqueo en vez de saltar el pedido").toBeLessThan(4000);
      expect(cuenta("orders", "id", libre.order)).toBe(0);
      expect(cuenta("orders", "id", bloqueado.order)).toBe(1);
    } finally {
      await termino;
    }
    expect((await purgar()).error).toBeNull();
    expect(cuenta("orders", "id", bloqueado.order)).toBe(0);
  });

  it("si no hay nada que purgar no toca el registro: no espera a quien lo tiene bloqueado", async () => {
    const contenedor = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
    const l = await nuevoLocal();
    await pedido(l, "closed", "1 day"); // nada vencido en ESTA organización; otras suites no dejan pedidos de más de un año
    await purgar(); // por si quedó algo viejo de otra prueba
    const SEGUNDOS = 6;
    const titular = spawn(
      "docker",
      ["exec", contenedor, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", `begin; lock table public.order_events in access exclusive mode; select pg_sleep(${SEGUNDOS}); commit;`],
      { stdio: "ignore" },
    );
    const termino = new Promise<void>((resolve) => titular.once("close", () => resolve()));
    try {
      let retenida = false;
      for (let i = 0; i < 50 && !retenida; i++) {
        try {
          sql(`begin; lock table public.order_events in access exclusive mode nowait; commit`);
          await new Promise((r) => setTimeout(r, 100));
        } catch (error) {
          if (!String(error).includes("could not obtain lock")) throw error;
          retenida = true;
        }
      }
      expect(retenida, "el titular no llegó a bloquear el registro").toBe(true);
      const t0 = Date.now();
      const r = await purgar();
      expect(r.error).toBeNull();
      expect(r.data).toMatchObject({ orders: 0, events: 0 });
      expect(Date.now() - t0, "la purga esperó al registro sin tener nada que borrar").toBeLessThan(3000);
    } finally {
      await termino;
    }
  });

  it("convive con pedidos que se anotan, cambian y cierran a la vez: sin errores ni interbloqueos", async () => {
    const l = await nuevoLocal();
    for (let i = 0; i < 6; i++) await pedido(l, i % 2 ? "void" : "closed", `${3 + i} years`);
    const tareas: Promise<unknown>[] = [];
    for (let i = 0; i < 4; i++) tareas.push(purgar({ p_batch: 2 }).then((r) => expect(r.error).toBeNull()));
    // Mientras tanto, una mesa nueva con anotaciones y un cierre (cada una escribe en el registro).
    const m = await service.from("tables").insert({ organization_id: l.id, branch_id: l.branch, label: "Mesa 2" }).select("id").single();
    for (let i = 0; i < 4; i++) {
      tareas.push(
        (async () => {
          const r = await owner.db.rpc("add_order_item", { p_branch: l.branch, p_table: m.data!.id, p_product: l.product, p_quantity: 1, p_client_key: randomUUID() });
          expect(r.error).toBeNull();
        })(),
      );
    }
    await Promise.all(tareas);
    const rest = await purgar({ p_batch: 100 });
    expect(rest.error).toBeNull();
    // Quedó el pedido abierto de la mesa nueva con sus 4 líneas, y ninguno de los viejos.
    expect(pedidosDe(l.id)).toBe(1);
    expect(triggerEncendido()).toBe(true);
  });
});
