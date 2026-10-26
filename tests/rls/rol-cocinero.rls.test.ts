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
 * Rol de cocinero (nivel C, ficha rol-cocinero, ADR 0048) contra el Supabase local. Lo que importa: el rol nuevo NO hereda nada de lo
 * que ya existía (`is_org_member` es solo Dueño y Staff), solo opera por las funciones de cocina, solo hace lo suyo (listo y agotar),
 * nunca ve precios, y exige `orders` en el plan y la cuenta al día. Dueño y Staff siguen igual.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
let cook: TestUser;
let cookAjeno: TestUser;
const orgs: string[] = [];
let contador = 0;
const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

type Local = { id: string; branch: string; table: string; category: string; product: string; product2: string };

async function nuevoLocal(plan: PlanCode = "pro", cocinero: TestUser | null = cook): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-cocina-${sufijo}-${contador}`, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const b = await service.from("branches").insert({ organization_id: id, slug: "principal", name: "Principal" }).select("id").single();
  if (b.error) throw new Error(`sucursal: ${b.error.message}`);
  const mesa = await service.from("tables").insert({ organization_id: id, branch_id: b.data.id, label: "Mesa 1" }).select("id").single();
  if (mesa.error) throw new Error(`mesa: ${mesa.error.message}`);
  const category = await createCategory(service, id, "Platos");
  const productos = await service
    .from("products")
    .insert([
      { organization_id: id, category_id: category, name: "Bife", price_cents: 10000, sort_order: 1 },
      { organization_id: id, category_id: category, name: "Flan", price_cents: 4000, sort_order: 2 },
    ])
    .select("id, name");
  if (productos.error) throw new Error(`platos: ${productos.error.message}`);
  const idDe = (nombre: string) => productos.data.find((x) => x.name === nombre)!.id;
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  if (cocinero) await addMembership(service, cocinero, id, "cook");
  return { id, branch: b.data.id, table: mesa.data.id, category, product: idDe("Bife"), product2: idDe("Flan") };
}

type Resp = { data: unknown; error: { message: string; code?: string } | null };
const ok = <T,>(r: Resp): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

const anotar = (db: Db, l: Local, extra: Record<string, unknown> = {}) =>
  db.rpc("add_order_item", { p_branch: l.branch, p_table: l.table, p_product: l.product, p_quantity: 1, p_client_key: randomUUID(), ...extra } as never);
const estado = (db: Db, item: string, status: string | null, reason?: string | null) =>
  db.rpc("set_order_item_status", { p_item: item, p_status: status, p_reason: reason } as never);
const pedidosCocina = (db: Db, org: string, branch: string | null = null) => db.rpc("kitchen_orders", { p_org: org, p_branch: branch } as never);
const menuCocina = (db: Db, org: string, branch: string) => db.rpc("kitchen_menu", { p_org: org, p_branch: branch });
const agotar = (db: Db, org: string, product: string, branch: string, available: boolean | null) =>
  db.rpc("set_kitchen_availability", { p_org: org, p_product: product, p_branch: branch, p_available: available } as never);

/** Un pedido con una línea anotada por el Dueño. */
async function conLinea(l: Local, extra: Record<string, unknown> = {}) {
  const r = ok<{ order_id: string; item_id: string }>(await anotar(owner.db, l, extra));
  return { order: r.order_id, item: r.item_id };
}

const fila = async (item: string) => (await service.from("order_items").select("status").eq("id", item).single()).data;
const eventos = async (order: string) => (await service.from("order_events").select("event, actor_id, detail, item_id").eq("order_id", order).order("occurred_at").order("id")).data ?? [];

/** Ninguna clave de precio ni de total en ningún nivel de la respuesta. */
function sinPrecios(value: unknown): void {
  const claves: string[] = [];
  const recorrer = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(recorrer);
    else if (v && typeof v === "object") {
      for (const [k, inner] of Object.entries(v)) {
        claves.push(k);
        recorrer(inner);
      }
    }
  };
  recorrer(value);
  expect(claves.filter((k) => /price|cents|total|amount/i.test(k))).toEqual([]);
}

/** Lo que una consulta directa devuelve a quien no tiene acceso: error de permisos o ninguna fila. */
async function sinFilas(consulta: PromiseLike<{ data: unknown; error: unknown }>) {
  const r = await consulta;
  expect(r.error !== null || (Array.isArray(r.data) && r.data.length === 0)).toBe(true);
}

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, cook, cookAjeno] = await Promise.all([
    createUser(service, "cocina-owner"),
    createUser(service, "cocina-staff"),
    createUser(service, "cocina-cook"),
    createUser(service, "cocina-cook-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, cook, cookAjeno].map((u) => deleteUser(service, u)));
});

describe("el rol", () => {
  it("memberships admite cook y rechaza cualquier otro valor", async () => {
    const l = await nuevoLocal();
    const roles = (await service.from("memberships").select("role").eq("organization_id", l.id).eq("user_id", cook.id)).data;
    expect(roles).toEqual([{ role: "cook" }]);
    const mal = await service.from("memberships").update({ role: "cocinero" }).eq("organization_id", l.id).eq("user_id", cook.id);
    expect(mal.error).not.toBeNull();
  });

  it("un cocinero ve solo su propia membresía, no la del resto del equipo", async () => {
    const l = await nuevoLocal();
    const propias = ok<{ user_id: string; role: string }[]>(await cook.db.from("memberships").select("user_id, role").eq("organization_id", l.id));
    expect(propias).toEqual([{ user_id: cook.id, role: "cook" }]);
  });

  it("no puede cambiarse el rol ni sumarse otro", async () => {
    const l = await nuevoLocal();
    await cook.db.from("memberships").update({ role: "owner" }).eq("organization_id", l.id).eq("user_id", cook.id);
    await cook.db.from("memberships").insert({ user_id: cook.id, organization_id: l.id, role: "owner" } as never);
    const roles = (await service.from("memberships").select("role").eq("organization_id", l.id).eq("user_id", cook.id)).data;
    expect(roles).toEqual([{ role: "cook" }]);
  });
});

describe("cerrado por defecto: el cocinero no hereda lo del Staff", () => {
  it("no lee pedidos, líneas, opciones, registro, mesas, llamados ni lo demás del local; el Staff sí", async () => {
    const l = await nuevoLocal();
    await conLinea(l);
    expect(ok<unknown[]>(await staff.db.from("orders").select("id").eq("organization_id", l.id))).toHaveLength(1);
    expect(ok<unknown[]>(await staff.db.from("tables").select("id").eq("organization_id", l.id))).toHaveLength(1);

    for (const tabla of ["orders", "order_items", "order_item_options", "order_events", "tables", "waiter_calls", "price_history", "subscriptions", "payments", "member_branch_views"] as const) {
      await sinFilas(cook.db.from(tabla).select("*").eq("organization_id", l.id));
    }
    await sinFilas(cook.db.from("branches").select("id").eq("organization_id", l.id).eq("is_active", false));
  });

  it("no escribe la carta: ni precios, ni categorías, ni platos, ni ajustes de sucursal", async () => {
    const l = await nuevoLocal();
    await cook.db.from("products").update({ price_cents: 1 }).eq("id", l.product);
    await cook.db.from("products").insert({ organization_id: l.id, category_id: l.category, name: "Colado", price_cents: 1 });
    await cook.db.from("categories").update({ name: "Hackeada" }).eq("id", l.category);
    await cook.db.from("product_availability").insert({ organization_id: l.id, branch_id: l.branch, product_id: l.product, is_visible: false, price_cents: 1 } as never);
    await cook.db.from("product_availability").insert({ organization_id: l.id, branch_id: l.branch, product_id: l.product, is_available: false });

    const producto = (await service.from("products").select("price_cents").eq("id", l.product).single()).data;
    expect(producto?.price_cents).toBe(10000);
    expect((await service.from("products").select("id").eq("organization_id", l.id).eq("name", "Colado")).data).toEqual([]);
    expect((await service.from("categories").select("name").eq("id", l.category).single()).data?.name).toBe("Platos");
    expect((await service.from("product_availability").select("*").eq("organization_id", l.id)).data).toEqual([]);
  });

  it("no usa las funciones del mozo: anotar, modificar, cerrar, anular, entregar, cancelar ni mandar a cocina", async () => {
    const l = await nuevoLocal();
    const { order, item } = await conLinea(l);

    expect((await anotar(cook.db, l)).error?.message).toBe("orders_not_allowed");
    expect((await cook.db.rpc("update_order_item", { p_item: item, p_quantity: 2, p_note: null } as never)).error?.message).toBe("orders_not_allowed");
    expect((await cook.db.rpc("close_order", { p_order: order } as never)).error?.message).toBe("orders_not_allowed");
    expect((await cook.db.rpc("void_order", { p_order: order, p_reason: "x" } as never)).error?.message).toBe("orders_not_allowed");
    for (const destino of ["delivered", "cancelled", "in_kitchen"]) {
      expect((await estado(cook.db, item, destino, destino === "cancelled" ? "x" : null)).error?.message).toBe("orders_not_allowed");
    }
    expect((await fila(item))?.status).toBe("noted");
    expect((await service.from("orders").select("status").eq("id", order).single()).data?.status).toBe("open");
  });

  it("no administra personal, plan ni nada de dinero (funciones de Dueño y de plataforma)", async () => {
    const l = await nuevoLocal();
    // El estado de la cuenta (plan, fechas, pagos) es de Dueño y Staff: el cocinero no recibe nada.
    const entitlements = await cook.db.rpc("org_entitlements", { p_org: l.id });
    expect(entitlements.error === null ? entitlements.data : null).toBeNull();
    await cook.db.from("memberships").delete().eq("organization_id", l.id).eq("user_id", staff.id);
    expect((await service.from("memberships").select("id").eq("organization_id", l.id).eq("user_id", staff.id)).data).toHaveLength(1);
  });
});

describe("lo que sí hace: ver los pedidos y marcar listo", () => {
  it("kitchen_orders devuelve mesa, plato, cantidad, observación y estado, sin precios ni totales", async () => {
    const l = await nuevoLocal();
    const { item } = await conLinea(l, { p_quantity: 2, p_note: "sin sal" });
    const r = ok<{ server_now: string; orders: { table_label: string; branch_name: string; items: { id: string; name: string; quantity: number; note: string | null; status: string }[] }[] }>(
      await pedidosCocina(cook.db, l.id),
    );
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0]).toMatchObject({ table_label: "Mesa 1", branch_name: "Principal" });
    expect(r.orders[0].items).toEqual([expect.objectContaining({ id: item, name: "Bife", quantity: 2, note: "sin sal", status: "noted", options: [] })]);
    sinPrecios(r);
  });

  it("solo trae lo pendiente de pedidos abiertos de la sucursal pedida; lo entregado, lo cancelado y lo cerrado no", async () => {
    const l = await nuevoLocal();
    const a = await conLinea(l);
    const b = ok<{ item_id: string }>(await anotar(owner.db, l, { p_product: l.product2 }));
    const c = ok<{ item_id: string }>(await anotar(owner.db, l, { p_product: l.product2 }));
    ok(await estado(owner.db, b.item_id, "delivered"));
    ok(await estado(owner.db, c.item_id, "cancelled"));

    const otraSucursal = (await service.from("branches").insert({ organization_id: l.id, slug: "otra", name: "Otra" }).select("id").single()).data!.id;
    const visibles = ok<{ orders: { items: { id: string }[] }[] }>(await pedidosCocina(cook.db, l.id));
    expect(visibles.orders.flatMap((o) => o.items.map((i) => i.id))).toEqual([a.item]);
    expect(ok<{ orders: unknown[] }>(await pedidosCocina(cook.db, l.id, otraSucursal)).orders).toEqual([]);
    expect(ok<{ orders: unknown[] }>(await pedidosCocina(cook.db, l.id, l.branch)).orders).toHaveLength(1);

    ok(await owner.db.rpc("close_order", { p_order: a.order } as never));
    expect(ok<{ orders: unknown[] }>(await pedidosCocina(cook.db, l.id)).orders).toEqual([]);
  });

  it("marca listo desde anotado o en cocina, queda registrado con su nombre, repetir no registra de nuevo y se puede deshacer", async () => {
    const l = await nuevoLocal();
    const { order, item } = await conLinea(l);
    expect(ok(await estado(cook.db, item, "ready"))).toMatchObject({ status: "ready", unchanged: false });
    expect(ok(await estado(cook.db, item, "ready"))).toMatchObject({ status: "ready", unchanged: true });
    expect((await eventos(order)).filter((e) => e.event === "item.status_changed")).toEqual([
      expect.objectContaining({ actor_id: cook.id, detail: expect.objectContaining({ from: "noted", to: "ready" }) }),
    ]);

    expect(ok(await estado(cook.db, item, "noted"))).toMatchObject({ status: "noted", unchanged: false });
    expect((await fila(item))?.status).toBe("noted");

    ok(await estado(owner.db, item, "in_kitchen"));
    expect(ok(await estado(cook.db, item, "ready"))).toMatchObject({ status: "ready" });
  });

  it("no marca listo lo entregado, lo cancelado ni lo de un pedido cerrado; deshacer solo vale desde listo", async () => {
    const l = await nuevoLocal();
    const entregada = await conLinea(l);
    ok(await estado(owner.db, entregada.item, "delivered"));
    expect((await estado(cook.db, entregada.item, "ready")).error?.message).toBe("invalid_transition");
    expect((await estado(cook.db, entregada.item, "noted")).error?.message).toBe("invalid_transition");

    const cancelada = ok<{ item_id: string }>(await anotar(owner.db, l, { p_product: l.product2 }));
    ok(await estado(owner.db, cancelada.item_id, "cancelled"));
    expect((await estado(cook.db, cancelada.item_id, "ready")).error?.message).toBe("invalid_transition");

    const pendiente = ok<{ item_id: string }>(await anotar(owner.db, l, { p_product: l.product2 }));
    // Deshacer solo vale desde «listo»: sobre una línea anotada no hay nada que deshacer (no cambia ni registra nada).
    expect(ok(await estado(cook.db, pendiente.item_id, "noted"))).toMatchObject({ status: "noted", unchanged: true });
    ok(await estado(owner.db, pendiente.item_id, "in_kitchen"));
    expect((await estado(cook.db, pendiente.item_id, "noted")).error?.message).toBe("invalid_transition");
    ok(await owner.db.rpc("close_order", { p_order: entregada.order } as never));
    expect((await estado(cook.db, pendiente.item_id, "ready")).error?.message).toBe("order_not_open");
  });

  it("Dueño y Staff siguen igual: listo, entregado, cancelar (con motivo si ya se entregó) y en cocina heredado", async () => {
    const l = await nuevoLocal();
    const a = await conLinea(l);
    expect(ok(await estado(staff.db, a.item, "ready"))).toMatchObject({ status: "ready" });
    expect(ok(await estado(staff.db, a.item, "delivered"))).toMatchObject({ status: "delivered" });
    expect((await estado(owner.db, a.item, "cancelled")).error?.message).toBe("reason_required");
    expect(ok(await estado(owner.db, a.item, "cancelled", "se devolvió"))).toMatchObject({ status: "cancelled" });

    const b = ok<{ item_id: string }>(await anotar(owner.db, l, { p_product: l.product2 }));
    ok(await estado(owner.db, b.item_id, "in_kitchen"));
    ok(await estado(owner.db, b.item_id, "ready"));
    expect(ok(await estado(owner.db, b.item_id, "cancelled"))).toMatchObject({ status: "cancelled" });
    expect((await estado(owner.db, b.item_id, "invalid" as never)).error?.message).toBe("invalid_status");
  });
});

describe("la carta: sucursales y platos agotados", () => {
  it("kitchen_branches y kitchen_menu devuelven sucursales activas y platos activos y visibles, sin precios", async () => {
    const l = await nuevoLocal();
    await service.from("branches").insert({ organization_id: l.id, slug: "cerrada", name: "Cerrada", is_active: false });
    await service.from("products").insert({ organization_id: l.id, category_id: l.category, name: "Oculto en cocina", price_cents: 1, is_active: false });
    const oculto = (await service.from("products").insert({ organization_id: l.id, category_id: l.category, name: "Solo otra", price_cents: 1 }).select("id").single()).data!.id;
    await service.from("product_availability").insert({ organization_id: l.id, branch_id: l.branch, product_id: oculto, is_visible: false });
    await service.from("product_availability").insert({ organization_id: l.id, branch_id: l.branch, product_id: l.product2, is_available: false, price_cents: 123 });

    const ramas = ok<{ id: string; name: string }[]>(await cook.db.rpc("kitchen_branches", { p_org: l.id }));
    expect(ramas).toEqual([{ id: l.branch, name: "Principal" }]);

    const menu = ok<{ categories: { name: string; products: { id: string; name: string; available: boolean }[] }[] }>(await menuCocina(cook.db, l.id, l.branch));
    expect(menu.categories).toEqual([
      expect.objectContaining({
        name: "Platos",
        products: [
          { id: l.product, name: "Bife", available: true },
          { id: l.product2, name: "Flan", available: false },
        ],
      }),
    ]);
    sinPrecios(menu);
    expect((await menuCocina(cook.db, l.id, randomUUID())).error?.message).toBe("branch_not_found");
  });

  it("agota y vuelve a habilitar un plato en una sucursal, y escribe SOLO is_available (no toca visibilidad ni precio propio)", async () => {
    const l = await nuevoLocal();
    await service.from("product_availability").insert({ organization_id: l.id, branch_id: l.branch, product_id: l.product, is_visible: true, price_cents: 7777 });

    expect(ok(await agotar(cook.db, l.id, l.product, l.branch, false))).toMatchObject({ product_id: l.product, branch_id: l.branch, available: false });
    let ajuste = (await service.from("product_availability").select("is_available, is_visible, price_cents").eq("product_id", l.product).eq("branch_id", l.branch).single()).data;
    expect(ajuste).toEqual({ is_available: false, is_visible: true, price_cents: 7777 });

    expect(ok(await agotar(cook.db, l.id, l.product, l.branch, true))).toMatchObject({ available: true });
    ajuste = (await service.from("product_availability").select("is_available, is_visible, price_cents").eq("product_id", l.product).eq("branch_id", l.branch).single()).data;
    expect(ajuste).toEqual({ is_available: true, is_visible: true, price_cents: 7777 });

    // Sin fila previa se crea con los valores por defecto (visible y sin precio propio); repetir no falla.
    expect(ok(await agotar(cook.db, l.id, l.product2, l.branch, false))).toMatchObject({ available: false });
    expect(ok(await agotar(cook.db, l.id, l.product2, l.branch, false))).toMatchObject({ available: false });
    const nueva = (await service.from("product_availability").select("is_available, is_visible, price_cents").eq("product_id", l.product2).single()).data;
    expect(nueva).toEqual({ is_available: false, is_visible: true, price_cents: null });
    // Agotar no es un cambio de precio: no deja nada en el historial.
    expect((await service.from("price_history").select("id").eq("product_id", l.product2)).data).toEqual([]);
  });

  it("rechaza platos o sucursales de otro local, platos inactivos y un valor vacío", async () => {
    const l = await nuevoLocal();
    const ajeno = await nuevoLocal("pro", cookAjeno);
    expect((await agotar(cook.db, l.id, ajeno.product, l.branch, false)).error?.message).toBe("product_not_found");
    expect((await agotar(cook.db, l.id, l.product, ajeno.branch, false)).error?.message).toBe("branch_not_found");
    const inactivo = (await service.from("products").insert({ organization_id: l.id, category_id: l.category, name: "Baja", price_cents: 1, is_active: false }).select("id").single()).data!.id;
    expect((await agotar(cook.db, l.id, inactivo, l.branch, false)).error?.message).toBe("product_not_found");
    expect((await agotar(cook.db, l.id, l.product, l.branch, null)).error?.message).toBe("invalid_availability");
    expect((await service.from("product_availability").select("*").eq("organization_id", ajeno.id)).data).toEqual([]);
  });
});

describe("otro local, plan y cuenta", () => {
  it("un cocinero de otro local, o quien no es del equipo, no ve ni toca nada de este", async () => {
    const l = await nuevoLocal("pro", null);
    const { item } = await conLinea(l);
    const otro = await nuevoLocal("pro", cookAjeno);

    const intruso = cookAjeno.db;
    expect((await pedidosCocina(intruso, l.id)).error?.message).toBe("orders_not_allowed");
    expect((await intruso.rpc("kitchen_branches", { p_org: l.id })).error?.message).toBe("orders_not_allowed");
    expect((await menuCocina(intruso, l.id, l.branch)).error?.message).toBe("orders_not_allowed");
    expect((await agotar(intruso, l.id, l.product, l.branch, false)).error?.message).toBe("orders_not_allowed");
    expect((await estado(intruso, item, "ready")).error?.message).toBe("orders_not_allowed");
    // En su propio local sí ve lo suyo (nada de este).
    expect(ok<{ orders: unknown[] }>(await pedidosCocina(intruso, otro.id)).orders).toEqual([]);
    expect((await fila(item))?.status).toBe("noted");
  });

  it("sin sesión (anon) no puede llamar a ninguna función de cocina", async () => {
    const l = await nuevoLocal();
    const anon = anonClient();
    expect((await anon.rpc("kitchen_orders", { p_org: l.id } as never)).error).not.toBeNull();
    expect((await anon.rpc("kitchen_branches", { p_org: l.id })).error).not.toBeNull();
    expect((await anon.rpc("kitchen_menu", { p_org: l.id, p_branch: l.branch })).error).not.toBeNull();
    expect((await anon.rpc("set_kitchen_availability", { p_org: l.id, p_product: l.product, p_branch: l.branch, p_available: false })).error).not.toBeNull();
  });

  it("un plan sin pedidos (Básico) deja al cocinero sin poder hacer nada", async () => {
    const l = await nuevoLocal("pro");
    const { item } = await conLinea(l);
    await setSubscription(service, l.id, { plan: "basic" });
    expect((await pedidosCocina(cook.db, l.id)).error?.message).toBe("orders_not_allowed");
    expect((await cook.db.rpc("kitchen_branches", { p_org: l.id })).error?.message).toBe("orders_not_allowed");
    expect((await agotar(cook.db, l.id, l.product, l.branch, false)).error?.message).toBe("orders_not_allowed");
    expect((await estado(cook.db, item, "ready")).error?.message).toBe("orders_not_allowed");
    expect((await fila(item))?.status).toBe("noted");
  });

  it("con la cuenta en gracia opera igual que el Staff; en solo lectura o suspendida, no", async () => {
    const l = await nuevoLocal();
    const { item } = await conLinea(l);

    await setSubscription(service, l.id, { finEnMs: -3 * DIA_MS });
    expect(ok(await estado(cook.db, item, "ready"))).toMatchObject({ status: "ready" });
    expect(ok(await agotar(cook.db, l.id, l.product, l.branch, false))).toMatchObject({ available: false });

    for (const vencida of [-10 * DIA_MS, -40 * DIA_MS]) {
      await setSubscription(service, l.id, { finEnMs: vencida });
      expect((await estado(cook.db, item, "noted")).error?.message).toBe("orders_not_allowed");
      expect((await pedidosCocina(cook.db, l.id)).error?.message).toBe("orders_not_allowed");
      expect((await agotar(cook.db, l.id, l.product, l.branch, true)).error?.message).toBe("orders_not_allowed");
    }
    expect((await fila(item))?.status).toBe("ready");
    expect((await service.from("product_availability").select("is_available").eq("product_id", l.product).single()).data?.is_available).toBe(false);
  });

  it("una organización dada de baja deja sin acceso al cocinero", async () => {
    const l = await nuevoLocal();
    await conLinea(l);
    await service.from("organizations").update({ is_active: false }).eq("id", l.id);
    expect((await pedidosCocina(cook.db, l.id)).error?.message).toBe("orders_not_allowed");
  });
});

describe("sin avisos de llamados", () => {
  const P256DH = "B".repeat(87);
  const AUTH = "a".repeat(22);
  const endpoint = () => `https://fcm.googleapis.com/fcm/send/rls-${randomUUID()}`;
  const registrar = (db: Db, org: string) => db.rpc("register_push_subscription", { p_org: org, p_endpoint: endpoint(), p_p256dh: P256DH, p_auth: AUTH });

  it("el cocinero no registra su dispositivo; el Dueño y el Staff sí", async () => {
    const l = await nuevoLocal();
    expect(ok(await registrar(cook.db, l.id))).toBe("unavailable");
    expect(ok(await registrar(staff.db, l.id))).toBe("ok");
    expect(ok(await registrar(owner.db, l.id))).toBe("ok");
    expect(sql(`select count(*) from public.push_subscriptions where organization_id = '${l.id}' and user_id = '${cook.id}'`)[0][0]).toBe("0");
  });

  it("quien pasa de Personal a cocinero pierde las suscripciones que ya tenía (y las de otro local no se tocan)", async () => {
    const l = await nuevoLocal("pro", null);
    const otro = await nuevoLocal("pro", null);
    expect(ok(await registrar(staff.db, l.id))).toBe("ok");
    expect(ok(await registrar(staff.db, otro.id))).toBe("ok");
    const cuenta = (org: string) => Number(sql(`select count(*) from public.push_subscriptions where organization_id = '${org}' and user_id = '${staff.id}'`)[0][0]);
    expect(cuenta(l.id)).toBe(1);

    const cambio = await service.from("memberships").update({ role: "cook" }).eq("organization_id", l.id).eq("user_id", staff.id);
    expect(cambio.error).toBeNull();
    expect(cuenta(l.id)).toBe(0);
    expect(cuenta(otro.id)).toBe(1);
  });
});
