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
 * Estados, modificar y cancelar líneas, cerrar y anular pedidos, y su registro de solo-agregado (nivel C, ficha
 * pedidos-estados-y-registro, ADR 0041) contra el Supabase local: las transiciones, quién puede (cerrar y anular nunca dependen
 * del plan ni de la mora), la revalidación tras esperar el candado, los reintentos y que el registro tenga un evento por cada
 * acción real y nadie pueda reescribirlo.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
const orgs: string[] = [];
let contador = 0;
const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

type Local = { id: string; branch: string; table: string; table2: string; product: string };

async function nuevoLocal(plan: PlanCode = "pro"): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-ped-es-${sufijo}-${contador}`, plan);
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
  const category = await createCategory(service, id, "Platos");
  const p = await service.from("products").insert({ organization_id: id, category_id: category, name: "Bife", price_cents: 10000 }).select("id").single();
  if (p.error) throw new Error(`plato: ${p.error.message}`);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, branch: b.data.id, table: mesas.data[0].id, table2: mesas.data[1].id, product: p.data.id };
}

type Resp = { data: unknown; error: { message: string } | null };
const ok = <T,>(r: Resp): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

const anotar = (db: Db, l: Local, extra: Record<string, unknown> = {}) =>
  db.rpc("add_order_item", { p_branch: l.branch, p_table: l.table, p_product: l.product, p_quantity: 1, p_client_key: randomUUID(), ...extra } as never);
const estado = (db: Db, item: string, status: string | null, reason?: string | null) =>
  db.rpc("set_order_item_status", { p_item: item, p_status: status, p_reason: reason } as never);
const editar = (db: Db, item: string, quantity: number | null, note?: string | null) =>
  db.rpc("update_order_item", { p_item: item, p_quantity: quantity, p_note: note } as never);
const cerrar = (db: Db, order: string) => db.rpc("close_order", { p_order: order } as never);
const anular = (db: Db, order: string, reason?: string | null) => db.rpc("void_order", { p_order: order, p_reason: reason } as never);

/** Un pedido con una línea anotada por el Dueño. */
async function conLinea(l: Local, extra: Record<string, unknown> = {}) {
  const r = ok<{ order_id: string; item_id: string }>(await anotar(owner.db, l, extra));
  return { order: r.order_id, item: r.item_id };
}

const fila = async (item: string) => (await service.from("order_items").select("status, quantity, note, cancel_reason").eq("id", item).single()).data;
const pedido = async (order: string) => (await service.from("orders").select("status, closed_at, closed_by, void_reason").eq("id", order).single()).data;
const eventos = async (order: string) =>
  (await service.from("order_events").select("event, actor_id, detail, item_id, organization_id").eq("order_id", order).order("occurred_at").order("id")).data ?? [];
const nombres = async (order: string) => (await eventos(order)).map((e) => e.event);
const cuenta = (tabla: string, orgId: string) => Number(sql(`select count(*) from public.${tabla} where organization_id = '${orgId}'`)[0][0]);

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([
    createUser(service, "pedes-owner"),
    createUser(service, "pedes-staff"),
    createUser(service, "pedes-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, stranger].map((u) => deleteUser(service, u)));
});

describe("estados de una línea", () => {
  it("noted → in_kitchen → delivered, o noted → delivered; el Dueño y el Staff", async () => {
    const l = await nuevoLocal();
    const { item } = await conLinea(l);
    expect(ok(await estado(owner.db, item, "in_kitchen"))).toMatchObject({ status: "in_kitchen", unchanged: false });
    expect((await fila(item))?.status).toBe("in_kitchen");
    expect(ok(await estado(staff.db, item, "delivered"))).toMatchObject({ status: "delivered", unchanged: false });

    const otra = await conLinea(l, { p_table: l.table2 });
    expect(ok(await estado(staff.db, otra.item, "delivered"))).toMatchObject({ status: "delivered", unchanged: false });
  });

  it("sin marcha atrás y sin salir de cancelada; repetir devuelve unchanged", async () => {
    const l = await nuevoLocal();
    const { item } = await conLinea(l);
    ok(await estado(owner.db, item, "in_kitchen"));
    expect(ok(await estado(owner.db, item, "in_kitchen"))).toMatchObject({ unchanged: true });
    expect((await estado(owner.db, item, "noted")).error?.message).toBe("invalid_status");
    expect((await estado(owner.db, item, "otro")).error?.message).toBe("invalid_status");
    expect((await estado(owner.db, item, null)).error?.message).toBe("invalid_status");
    ok(await estado(owner.db, item, "delivered"));
    expect((await estado(owner.db, item, "in_kitchen")).error?.message).toBe("invalid_transition");
    expect(ok(await estado(owner.db, item, "delivered"))).toMatchObject({ unchanged: true });

    const c = await conLinea(l, { p_table: l.table2 });
    ok(await estado(owner.db, c.item, "cancelled"));
    for (const destino of ["in_kitchen", "delivered"]) {
      expect((await estado(owner.db, c.item, destino)).error?.message, destino).toBe("invalid_transition");
    }
    expect(ok(await estado(owner.db, c.item, "cancelled"))).toMatchObject({ unchanged: true });
    expect((await fila(c.item))?.status).toBe("cancelled");
  });

  it("cancelar: sin motivo vale si no se entregó; una entregada exige motivo; el motivo se recorta y se valida", async () => {
    const l = await nuevoLocal();
    const a = await conLinea(l);
    ok(await estado(owner.db, a.item, "cancelled"));
    expect(await fila(a.item)).toMatchObject({ status: "cancelled", cancel_reason: null });

    const b = await conLinea(l, { p_table: l.table2 });
    ok(await estado(owner.db, b.item, "in_kitchen"));
    ok(await estado(owner.db, b.item, "cancelled", "  se arrepintió  "));
    expect((await fila(b.item))?.cancel_reason).toBe("se arrepintió");

    const c = await conLinea(l, { p_table: l.table });
    ok(await estado(owner.db, c.item, "delivered"));
    for (const sin of [null, undefined, "", "   "]) {
      expect((await estado(owner.db, c.item, "cancelled", sin)).error?.message, JSON.stringify(sin)).toBe("reason_required");
    }
    expect((await fila(c.item))?.status).toBe("delivered");
    for (const mala of ["a".repeat(201), "dos\nlíneas"]) {
      expect((await estado(owner.db, c.item, "cancelled", mala)).error?.message).toBe("invalid_reason");
    }
    expect((await fila(c.item))?.status).toBe("delivered");
    ok(await estado(owner.db, c.item, "cancelled", "llegó frío"));
    expect(await fila(c.item)).toMatchObject({ status: "cancelled", cancel_reason: "llegó frío" });
  });
});

describe("modificar cantidad y observación", () => {
  it("una línea anotada se modifica; sin cambios, unchanged; la nota vacía la borra", async () => {
    const l = await nuevoLocal();
    const { item } = await conLinea(l, { p_quantity: 1, p_note: "sin sal" });
    expect(ok(await editar(staff.db, item, 3, "  sin cebolla "))).toMatchObject({ quantity: 3, note: "sin cebolla", unchanged: false });
    expect(await fila(item)).toMatchObject({ quantity: 3, note: "sin cebolla" });
    expect(ok(await editar(staff.db, item, 3, "sin cebolla"))).toMatchObject({ unchanged: true });
    expect(ok(await editar(staff.db, item, 3, "   "))).toMatchObject({ note: null, unchanged: false });
    expect((await fila(item))?.note).toBeNull();
  });

  it("solo las anotadas: en cocina, entregadas o canceladas no se tocan; cantidad y nota inválidas se rechazan", async () => {
    const l = await nuevoLocal();
    const { item } = await conLinea(l);
    for (const q of [0, 100, -1, null]) expect((await editar(owner.db, item, q)).error?.message, `cantidad ${q}`).toBe("invalid_quantity");
    for (const n of ["a".repeat(201), "dos\nlíneas"]) expect((await editar(owner.db, item, 2, n)).error?.message).toBe("invalid_note");
    expect(await fila(item)).toMatchObject({ quantity: 1, note: null });
    for (const destino of ["in_kitchen", "delivered", "cancelled"]) {
      const x = await conLinea(l, { p_table: destino === "in_kitchen" ? l.table : l.table2 });
      if (destino === "delivered") ok(await estado(owner.db, x.item, "delivered"));
      else ok(await estado(owner.db, x.item, destino === "cancelled" ? "cancelled" : "in_kitchen"));
      expect((await editar(owner.db, x.item, 5)).error?.message, destino).toBe("item_not_editable");
    }
  });

  it("modificar no recalcula el precio ni toca las opciones: los precios copiados siguen", async () => {
    const l = await nuevoLocal();
    const { item } = await conLinea(l);
    await service.from("products").update({ price_cents: 99999 }).eq("id", l.product);
    ok(await editar(owner.db, item, 4));
    const r = await service.from("order_items").select("quantity, base_price_cents, unit_price_cents, options_cents").eq("id", item).single();
    expect(r.data).toEqual({ quantity: 4, base_price_cents: 10000, unit_price_cents: 10000, options_cents: 0 });
  });
});

describe("cerrar y anular", () => {
  it("cerrar solo desde abierto; repetir, unchanged; la mesa queda libre para un pedido nuevo", async () => {
    const l = await nuevoLocal();
    const { order, item } = await conLinea(l);
    expect(ok(await cerrar(staff.db, order))).toMatchObject({ status: "closed", unchanged: false });
    expect(await pedido(order)).toMatchObject({ status: "closed", closed_by: staff.id, void_reason: null });
    expect((await pedido(order))?.closed_at).not.toBeNull();
    expect(ok(await cerrar(owner.db, order))).toMatchObject({ unchanged: true });
    expect((await anular(owner.db, order, "x")).error?.message).toBe("order_not_open");
    // Cerrado: las líneas no cambian más (salvo repetir lo ya hecho).
    expect((await estado(owner.db, item, "delivered")).error?.message).toBe("order_not_open");
    expect((await editar(owner.db, item, 2)).error?.message).toBe("order_not_open");
    // La mesa queda libre: anotar abre otro pedido.
    const nuevo = await conLinea(l);
    expect(nuevo.order).not.toBe(order);
  });

  it("anular exige motivo (recortado y validado); desde abierto; la mesa queda libre", async () => {
    const l = await nuevoLocal();
    const { order } = await conLinea(l);
    for (const sin of [null, undefined, "", "  "]) expect((await anular(owner.db, order, sin)).error?.message).toBe("reason_required");
    for (const mala of ["a".repeat(201), "dos\nlíneas"]) expect((await anular(owner.db, order, mala)).error?.message).toBe("invalid_reason");
    expect((await pedido(order))?.status).toBe("open");
    expect(ok(await anular(owner.db, order, "  se fueron  "))).toMatchObject({ status: "void", unchanged: false });
    expect(await pedido(order)).toMatchObject({ status: "void", void_reason: "se fueron", closed_by: owner.id });
    expect(ok(await anular(staff.db, order, "otro motivo"))).toMatchObject({ unchanged: true });
    expect((await pedido(order))?.void_reason).toBe("se fueron");
    expect((await cerrar(owner.db, order)).error?.message).toBe("order_not_open");
    expect((await conLinea(l)).order).not.toBe(order);
  });

  it("la tabla no admite un pedido anulado sin motivo ni un motivo en uno que no está anulado", async () => {
    const l = await nuevoLocal();
    const { order } = await conLinea(l);
    expect(() => sql(`update public.orders set status = 'void', closed_at = now() where id = '${order}'`)).toThrow(/orders_void_reason_check/);
    expect(() => sql(`update public.orders set void_reason = 'x' where id = '${order}'`)).toThrow(/orders_void_reason_check/);
  });
});

describe("quién puede: plan y mora", () => {
  it("cerrar y anular funcionan en solo lectura, suspendida y sin la función en el plan; estados, modificar y cancelar no", async () => {
    const estados: [string, (l: Local) => Promise<void>][] = [
      ["solo lectura", (l) => setSubscription(service, l.id, { finEnMs: -10 * DIA_MS })],
      ["suspendida", (l) => setSubscription(service, l.id, { finEnMs: -20 * DIA_MS })],
      ["Básico (sin la función)", (l) => setSubscription(service, l.id, { plan: "basic" })],
    ];
    for (const [nombre, aplicar] of estados) {
      const l = await nuevoLocal();
      const a = await conLinea(l);
      const b = await conLinea(l, { p_table: l.table2 });
      await aplicar(l);
      expect((await estado(owner.db, a.item, "delivered")).error?.message, `${nombre}: estado`).toBe("orders_not_allowed");
      expect((await estado(owner.db, a.item, "cancelled")).error?.message, `${nombre}: cancelar`).toBe("orders_not_allowed");
      expect((await editar(owner.db, a.item, 2)).error?.message, `${nombre}: modificar`).toBe("orders_not_allowed");
      expect((await fila(a.item))?.status, nombre).toBe("noted");
      // Cerrar y anular, nunca bloqueados.
      expect(ok(await cerrar(staff.db, a.order)), `${nombre}: cerrar`).toMatchObject({ status: "closed" });
      expect(ok(await anular(owner.db, b.order, "cuenta en mora")), `${nombre}: anular`).toMatchObject({ status: "void" });
    }
  });

  it("en gracia todo funciona", async () => {
    const l = await nuevoLocal();
    const { order, item } = await conLinea(l);
    await setSubscription(service, l.id, { finEnMs: -3 * DIA_MS });
    ok(await estado(owner.db, item, "delivered"));
    ok(await cerrar(owner.db, order));
  });

  it("una vista previa vigente de orders habilita a un Básico, y al vencer deja de poder (cerrar sigue)", async () => {
    const l = await nuevoLocal("basic");
    sql(`insert into public.organization_feature_previews (organization_id, feature, ends_at, reason) values ('${l.id}', 'orders', now() + interval '5 days', 'Piloto')`);
    const { order, item } = await conLinea(l);
    ok(await estado(owner.db, item, "in_kitchen"));
    sql(`update public.organization_feature_previews set ends_at = now() - interval '1 minute' where organization_id = '${l.id}'`);
    expect((await estado(owner.db, item, "delivered")).error?.message).toBe("orders_not_allowed");
    ok(await cerrar(owner.db, order));
  });

  it("otra organización y anon no pueden nada; ids inexistentes", async () => {
    const l = await nuevoLocal();
    const otro = await nuevoLocal();
    await addMembership(service, stranger, otro.id, "owner");
    const { order, item } = await conLinea(l);
    expect((await estado(stranger.db, item, "delivered")).error?.message).toBe("orders_not_allowed");
    expect((await editar(stranger.db, item, 2)).error?.message).toBe("orders_not_allowed");
    expect((await cerrar(stranger.db, order)).error?.message).toBe("orders_not_allowed");
    expect((await anular(stranger.db, order, "x")).error?.message).toBe("orders_not_allowed");
    const anon = anonClient();
    for (const r of [await estado(anon, item, "delivered"), await editar(anon, item, 2), await cerrar(anon, order), await anular(anon, order, "x")]) {
      expect(r.error?.message).toMatch(/permission denied|not_allowed/);
    }
    expect((await estado(owner.db, randomUUID(), "delivered")).error?.message).toBe("item_not_found");
    expect((await editar(owner.db, randomUUID(), 2)).error?.message).toBe("item_not_found");
    expect((await cerrar(owner.db, randomUUID())).error?.message).toBe("order_not_found");
    expect((await anular(owner.db, randomUUID(), "x")).error?.message).toBe("order_not_found");
    expect(await fila(item)).toMatchObject({ status: "noted", quantity: 1 });
    expect((await pedido(order))?.status).toBe("open");
  });
});

describe("la autorización se revalida después de esperar el candado del pedido", () => {
  /** Otra sesión retiene el candado del pedido unos segundos; `llamada` queda esperando y, mientras, se revoca la membresía. */
  async function revocandoMientrasEspera<T>(l: Local, order: string, userId: string, llamada: () => PromiseLike<T>): Promise<T> {
    const retiene = spawn(
      "docker",
      ["exec", "supabase_db_ucomenu", "psql", "-U", "postgres", "-c", `begin; select 1 from public.orders where id = '${order}' for update; select pg_sleep(4); commit;`],
      { stdio: "ignore" },
    );
    const termino = new Promise((r) => retiene.on("exit", r));
    await new Promise((r) => setTimeout(r, 2000));
    const espera = llamada().then((r) => r);
    await new Promise((r) => setTimeout(r, 800));
    expect(Number(sql("select count(*) from pg_stat_activity where wait_event_type = 'Lock' and (query like '%set_order_item_status%' or query like '%update_order_item%' or query like '%close_order%' or query like '%void_order%')")[0][0])).toBeGreaterThanOrEqual(1);
    expect((await service.from("memberships").delete().eq("organization_id", l.id).eq("user_id", userId)).error).toBeNull();
    const r = await espera;
    await termino;
    await addMembership(service, staff, l.id, "staff");
    return r;
  }

  it("estado, modificar, cerrar y anular: una membresía revocada mientras esperan no las deja pasar", async () => {
    const l = await nuevoLocal();
    const { order, item } = await conLinea(l);
    const e = (await revocandoMientrasEspera(l, order, staff.id, () => estado(staff.db, item, "delivered"))) as Resp;
    expect(e.error?.message).toBe("orders_not_allowed");
    const m = (await revocandoMientrasEspera(l, order, staff.id, () => editar(staff.db, item, 5))) as Resp;
    expect(m.error?.message).toBe("orders_not_allowed");
    const c = (await revocandoMientrasEspera(l, order, staff.id, () => cerrar(staff.db, order))) as Resp;
    expect(c.error?.message).toBe("orders_not_allowed");
    const a = (await revocandoMientrasEspera(l, order, staff.id, () => anular(staff.db, order, "x"))) as Resp;
    expect(a.error?.message).toBe("orders_not_allowed");
    expect(await fila(item)).toMatchObject({ status: "noted", quantity: 1 });
    expect((await pedido(order))?.status).toBe("open");
  });
});

describe("la autorización se revalida también después de esperar el candado de la LÍNEA", () => {
  /** Otra sesión retiene solo la fila de la línea (no el pedido): la llamada pasa el candado del pedido y queda esperando la línea. */
  async function revocandoMientrasEsperaLaLinea(l: Local, item: string, llamada: () => PromiseLike<Resp>): Promise<Resp> {
    const retiene = spawn(
      "docker",
      ["exec", "supabase_db_ucomenu", "psql", "-U", "postgres", "-c", `begin; select 1 from public.order_items where id = '${item}' for update; select pg_sleep(4); commit;`],
      { stdio: "ignore" },
    );
    const termino = new Promise((r) => retiene.on("exit", r));
    await new Promise((r) => setTimeout(r, 2000));
    const espera = llamada().then((r) => r);
    await new Promise((r) => setTimeout(r, 800));
    expect(Number(sql("select count(*) from pg_stat_activity where wait_event_type = 'Lock' and (query like '%set_order_item_status%' or query like '%update_order_item%')")[0][0])).toBeGreaterThanOrEqual(1);
    expect((await service.from("memberships").delete().eq("organization_id", l.id).eq("user_id", staff.id)).error).toBeNull();
    const r = await espera;
    await termino;
    await addMembership(service, staff, l.id, "staff");
    return r;
  }

  it("estado y modificar: una membresía revocada mientras esperan la fila de la línea no las deja pasar", async () => {
    const l = await nuevoLocal();
    const { item } = await conLinea(l);
    const e = await revocandoMientrasEsperaLaLinea(l, item, () => estado(staff.db, item, "cancelled", "x"));
    expect(e.error?.message).toBe("orders_not_allowed");
    const m = await revocandoMientrasEsperaLaLinea(l, item, () => editar(staff.db, item, 7));
    expect(m.error?.message).toBe("orders_not_allowed");
    expect(await fila(item)).toMatchObject({ status: "noted", quantity: 1, cancel_reason: null });
  });
});

describe("dos mozos a la vez", () => {
  it("el mismo cambio dos veces: uno cambia y el otro recibe unchanged; transiciones contrarias: una gana", async () => {
    const l = await nuevoLocal();
    const { item } = await conLinea(l);
    const [a, b] = await Promise.all([estado(owner.db, item, "delivered").then((r) => r), estado(staff.db, item, "delivered").then((r) => r)]);
    const resultados = [ok<{ unchanged: boolean }>(a), ok<{ unchanged: boolean }>(b)];
    expect(resultados.filter((r) => !r.unchanged)).toHaveLength(1);

    const x = await conLinea(l, { p_table: l.table2 });
    const [c, d] = await Promise.all([estado(owner.db, x.item, "delivered").then((r) => r), estado(staff.db, x.item, "cancelled", "a la vez").then((r) => r)]);
    expect([c.error, d.error].filter(Boolean).length).toBeLessThanOrEqual(1);
    expect((await fila(x.item))?.status).toMatch(/delivered|cancelled/);
  });
});

describe("el registro de solo-agregado", () => {
  it("recorrido completo: un evento por cada acción real, con la persona, la hora y el detalle", async () => {
    const l = await nuevoLocal();
    const { order, item } = await conLinea(l, { p_quantity: 2 });
    ok(await editar(owner.db, item, 3, "sin sal"));
    ok(await estado(staff.db, item, "in_kitchen"));
    ok(await estado(staff.db, item, "delivered"));
    ok(await estado(owner.db, item, "cancelled", "llegó frío"));
    ok(await cerrar(staff.db, order));
    const ev = await eventos(order);
    expect(ev.map((e) => e.event)).toEqual(["order.opened", "item.added", "item.edited", "item.status_changed", "item.status_changed", "item.status_changed", "order.closed"]);
    expect(ev.every((e) => e.organization_id === l.id)).toBe(true);
    expect(ev.map((e) => e.actor_id)).toEqual([owner.id, owner.id, owner.id, staff.id, staff.id, owner.id, staff.id]);
    expect(ev[0].detail).toEqual({ table_label: "Mesa 1", branch_id: l.branch });
    expect(ev[1]).toMatchObject({ item_id: item, detail: { product_name: "Bife", quantity: 2, base_price_cents: 10000, unit_price_cents: 10000 } });
    expect(ev[2].detail).toEqual({ quantity: { from: 2, to: 3 }, note: { from: null, to: "sin sal" } });
    expect(ev[3].detail).toEqual({ from: "noted", to: "in_kitchen", reason: null });
    expect(ev[5].detail).toEqual({ from: "delivered", to: "cancelled", reason: "llegó frío" });
    expect(ev[6].detail).toEqual({});
    const horas = (await service.from("order_events").select("occurred_at").eq("order_id", order).order("occurred_at")).data!.map((e) => e.occurred_at);
    expect(horas).toEqual([...horas].sort());
  });

  it("anular deja el motivo en el evento", async () => {
    const l = await nuevoLocal();
    const { order } = await conLinea(l);
    ok(await anular(owner.db, order, "se fueron"));
    const ev = await eventos(order);
    expect(ev.at(-1)).toMatchObject({ event: "order.voided", actor_id: owner.id, detail: { reason: "se fueron" } });
  });

  it("los reintentos, los rechazos y los cambios internos no generan eventos", async () => {
    const l = await nuevoLocal();
    const g = await service.from("option_groups").insert({ organization_id: l.id, product_id: l.product, name: "Extras", min_choices: 0, max_choices: 2 }).select("id").single();
    const o = await service.from("options").insert({ organization_id: l.id, group_id: g.data!.id, name: "Bacon", price_delta_cents: 100 }).select("id").single();
    const { order, item } = await conLinea(l, { p_options: [o.data!.id] }); // add_order_item actualiza options_cents por dentro
    expect(await nombres(order)).toEqual(["order.opened", "item.added"]);
    ok(await estado(owner.db, item, "in_kitchen"));
    const antes = (await eventos(order)).length;
    ok(await estado(owner.db, item, "in_kitchen")); // reintento
    expect((await estado(owner.db, item, "noted")).error).not.toBeNull(); // rechazo
    expect((await editar(owner.db, item, 2)).error?.message).toBe("item_not_editable");
    await service.from("options").delete().eq("id", o.data!.id); // cambio del catálogo
    await service.from("products").delete().eq("id", l.product); // product_id pasa a nulo por dentro
    await service.from("tables").delete().eq("id", l.table); // table_id pasa a nulo por dentro
    expect((await eventos(order)).length).toBe(antes);
    ok(await cerrar(owner.db, order));
    ok(await cerrar(owner.db, order)); // reintento
    expect((await eventos(order)).length).toBe(antes + 1);
  });

  it("nadie lo escribe, cambia ni borra: ni la API, ni el servicio técnico, ni con privilegios del dueño de la tabla", async () => {
    const l = await nuevoLocal();
    const { order } = await conLinea(l);
    const evento = { organization_id: l.id, order_id: order, event: "order.closed" };
    for (const [quien, db] of [["Dueño", owner.db], ["Staff", staff.db], ["anon", anonClient()], ["servicio", service]] as const) {
      expect((await db.from("order_events").insert(evento)).error?.code, `${quien}: insert`).toMatch(/42501|PGRST/);
      const upd = await db.from("order_events").update({ event: "order.voided" }).eq("order_id", order).select("id");
      expect(upd.error?.code ?? "sin filas", `${quien}: update`).toMatch(/42501|PGRST|sin filas/);
      expect((await db.from("order_events").delete().eq("order_id", order).select("id")).data ?? []).toEqual([]);
    }
    expect(() => sql(`update public.order_events set event = 'order.voided' where order_id = '${order}'`)).toThrow(/solo agregado/);
    expect(() => sql(`delete from public.order_events where order_id = '${order}'`)).toThrow(/solo agregado/);
    expect(() => sql(`truncate public.order_events`)).toThrow(/solo agregado/);
    expect((await eventos(order)).length).toBe(2);
    for (const [rol, select] of [["anon", "f"], ["authenticated", "t"], ["service_role", "t"]] as const) {
      const permisos = sql(
        `select ${["select", "insert", "update", "delete", "truncate", "references", "trigger"].map((p) => `has_table_privilege('${rol}', 'public.order_events', '${p}')`).join(", ")}`,
      )[0];
      expect(permisos, rol).toEqual([select, "f", "f", "f", "f", "f", "f"]);
    }
  });

  it("lo leen los miembros de la organización y nadie más", async () => {
    const l = await nuevoLocal();
    const otro = await nuevoLocal();
    await addMembership(service, stranger, otro.id, "staff");
    const { order } = await conLinea(l);
    expect((await staff.db.from("order_events").select("id").eq("order_id", order)).data).toHaveLength(2);
    expect((await owner.db.from("order_events").select("id").eq("order_id", order)).data).toHaveLength(2);
    expect((await stranger.db.from("order_events").select("id").eq("order_id", order)).data).toEqual([]);
    expect((await anonClient().from("order_events").select("id")).error).not.toBeNull();
  });

  it("si falla el registro, no queda el cambio (una sola transacción)", async () => {
    const l = await nuevoLocal();
    const { item } = await conLinea(l);
    sql(`create function public.tt_falla_registro() returns trigger language plpgsql as $$ begin raise exception 'tt_falla_registro'; end $$`);
    sql(`create trigger tt_falla_registro before insert on public.order_events for each row when (new.organization_id = '${l.id}') execute function public.tt_falla_registro()`);
    try {
      expect((await estado(owner.db, item, "delivered")).error?.message).toContain("tt_falla_registro");
    } finally {
      sql("drop trigger tt_falla_registro on public.order_events");
      sql("drop function public.tt_falla_registro()");
    }
    expect((await fila(item))?.status).toBe("noted");
    expect(cuenta("order_events", l.id)).toBe(2);
  });
});
