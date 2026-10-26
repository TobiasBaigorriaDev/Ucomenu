import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  anonClient,
  createCategory,
  createOrg,
  createUser,
  deleteOrg,
  deleteUser,
  DIA_MS,
  serviceClient,
  setSubscription,
  sql,
  type Db,
  type PlanCode,
  type TestUser,
} from "./helpers";
import { BA, isoDow, loc, MAD, sembrarEscenario, sembrarPedido, type Pedido } from "./escenario-analitica-pedidos";

/**
 * Analítica de pedidos (nivel C; ficha analitica-de-pedidos, ADR 0045) contra el Supabase local: solo el Dueño de un local con
 * el plan lee ventas, franjas, categorías, anulaciones y platos; los números salen de los pedidos CERRADOS (líneas vivas,
 * importe = cantidad × (precio + opciones)); los períodos son días calendario de la zona de cada sucursal; nada de otro local
 * entra a la cuenta; leer no escribe.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

let service: Db;
let ajeno: TestUser; // Dueño de otro local
let comun: TestUser; // sin rol
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

type Local = {
  id: string;
  owner: TestUser;
  staff: TestUser;
  uno: string; // sucursal en hora de Buenos Aires
  dos: string; // sucursal en hora de Madrid
  producto: Record<string, string>;
};

async function crearLocal(plan: PlanCode = "pro", conCatalogo = true): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-anped-${sufijo}-${contador}`, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const [owner, staff] = await Promise.all([createUser(service, `anped-d${contador}`), createUser(service, `anped-s${contador}`)]);
  users.push(owner, staff);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");

  const b1 = await service.from("branches").insert({ organization_id: id, slug: "uno", name: "Uno" }).select("id").single();
  const b2 = plan === "basic" ? b1 : await service.from("branches").insert({ organization_id: id, slug: "dos", name: "Dos" }).select("id").single();
  if (b1.error || b2.error) throw new Error(`sucursales: ${b1.error?.message ?? b2.error?.message}`);
  if (plan !== "basic") sql(`update public.branches set timezone = '${MAD}' where id = '${b2.data!.id}'`);

  const producto: Record<string, string> = {};
  if (conCatalogo) {
    const platos = await createCategory(service, id, "Platos");
    const postres = await createCategory(service, id, "Postres");
    const inactiva = await createCategory(service, id, "Temporada");
    sql(`update public.categories set is_active = false where id = '${inactiva}'`);
    const filas = [
      ["Milanesa", platos, 10000, true],
      ["Ensalada", platos, 5000, true],
      ["Flan", postres, 3000, true],
      ["Sopa", platos, 4000, true],
      ["Tarta", postres, 3500, true],
      ["Oculto", platos, 6000, true],
      ["Viejo", platos, 2000, false],
      ["EnInactiva", inactiva, 2500, true],
    ] as const;
    const r = await service
      .from("products")
      .insert(filas.map(([name, category_id, price_cents, is_active]) => ({ organization_id: id, category_id, name, price_cents, is_active })))
      .select("id, name");
    if (r.error) throw new Error(`platos: ${r.error.message}`);
    for (const p of r.data) producto[p.name] = p.id;
  }
  return { id, owner, staff, uno: b1.data!.id, dos: b2.data!.id, producto };
}

const sembrar = (local: Local, pedido: Pedido) => sembrarPedido(local.id, pedido);
const escenario = (local: Local) => sembrarEscenario({ orgId: local.id, uno: local.uno, dos: local.dos, producto: local.producto });

type Periodo = {
  orders: number;
  revenue_cents: number;
  units: number;
  promo_discount_cents: number;
  voided_orders: number;
  voided_cents: number;
  cancelled_units: number;
  cancelled_cents: number;
  median_minutes: number | null;
};
type Ventas = {
  days: number;
  current: Periodo;
  previous: Periodo;
  by_day: { days_ago: number; orders: number; revenue_cents: number }[];
  by_slot: { dow: number; hour: number; orders: number; revenue_cents: number }[];
  by_category: { category_id: string | null; name: string | null; units: number; revenue_cents: number }[];
  void_reasons: { reason: string; orders: number; cents: number }[];
  cancel_reasons: { reason: string; units: number; cents: number }[];
};
type Platos = {
  days: number;
  best: { product_id: string | null; name: string; category: string | null; units: number; revenue_cents: number; views: number; in_catalog: boolean; is_active: boolean }[];
  unsold_total: number;
  unsold: { product_id: string; name: string; category: string | null; views: number }[];
};

const ventas = (db: Db, org: string, extra: { p_days?: number; p_branch?: string } = {}) => db.rpc("owner_sales_overview", { p_org: org, ...extra });
const platos = (db: Db, org: string, extra: { p_days?: number; p_branch?: string; p_limit?: number } = {}) => db.rpc("owner_products_performance", { p_org: org, ...extra });
const leerVentas = async (db: Db, org: string, extra: { p_days?: number; p_branch?: string } = {}) => {
  const r = await ventas(db, org, extra);
  expect(r.error).toBeNull();
  return r.data as unknown as Ventas;
};
const leerPlatos = async (db: Db, org: string, extra: { p_days?: number; p_branch?: string; p_limit?: number } = {}) => {
  const r = await platos(db, org, extra);
  expect(r.error).toBeNull();
  return r.data as unknown as Platos;
};
const filas = () =>
  ["orders", "order_items", "order_events", "dish_view_counts"].map((t) => sql(`select count(*) from public.${t}`)[0][0]).join(",");

beforeAll(async () => {
  service = serviceClient();
  [ajeno, comun] = await Promise.all([createUser(service, "anped-ajeno"), createUser(service, "anped-comun")]);
  users.push(ajeno, comun);
});

afterAll(async () => {
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("ventas del período (solo pedidos cerrados, líneas vivas, precio + opciones)", () => {
  it("resume el período y el anterior: ventas, pedidos, unidades, promoción, anulados, cancelaciones y tiempo típico", async () => {
    const local = await crearLocal();
    escenario(local);
    const r = await leerVentas(local.owner.db, local.id);
    expect(r.days).toBe(30);
    expect(r.current).toEqual({
      orders: 4,
      revenue_cents: 49000,
      units: 7,
      promo_discount_cents: 1000,
      voided_orders: 1,
      voided_cents: 10000,
      cancelled_units: 4,
      cancelled_cents: 12000,
      median_minutes: 60,
    });
    expect(r.previous).toEqual({
      orders: 1,
      revenue_cents: 6000,
      units: 2,
      promo_discount_cents: 0,
      voided_orders: 0,
      voided_cents: 0,
      cancelled_units: 0,
      cancelled_cents: 0,
      median_minutes: 30,
    });
  });

  it("ventas por día, con los días de la zona de cada sucursal (Madrid no corre la frontera de Buenos Aires, a cualquier hora del día)", async () => {
    const local = await crearLocal();
    escenario(local);
    const r = await leerVentas(local.owner.db, local.id);
    // Los dos pedidos de Madrid cerraron ayer (00:30 y 23:30 hora de Madrid): cuentan como ayer, su día local, aunque en Buenos Aires uno caiga en otro día.
    expect(r.by_day).toEqual([
      { days_ago: 1, orders: 3, revenue_cents: 36000 },
      { days_ago: 3, orders: 1, revenue_cents: 13000 },
    ]);
  });

  it("franjas por día de la semana y hora de APERTURA, en la hora de cada sucursal", async () => {
    const local = await crearLocal();
    escenario(local);
    const r = await leerVentas(local.owner.db, local.id);
    const esperado = [
      { dow: isoDow(BA, 1), hour: 13, orders: 1, revenue_cents: 26000 },
      { dow: isoDow(BA, 3), hour: 20, orders: 1, revenue_cents: 13000 },
      { dow: isoDow(MAD, 2), hour: 23, orders: 1, revenue_cents: 5000 },
      { dow: isoDow(MAD, 1), hour: 22, orders: 1, revenue_cents: 5000 },
    ].sort((a, b) => a.dow - b.dow || a.hour - b.hour);
    expect(r.by_slot).toEqual(esperado);
  });

  it("ventas por categoría, y un plato borrado después de venderse queda como «sin categoría»", async () => {
    const local = await crearLocal();
    escenario(local);
    const r = await leerVentas(local.owner.db, local.id);
    expect(r.by_category.map((c) => [c.name, c.units, c.revenue_cents])).toEqual([
      ["Platos", 6, 46000],
      ["Postres", 1, 3000],
    ]);

    const efimero = await service.from("products").insert({ organization_id: local.id, category_id: (await service.from("categories").select("id").eq("organization_id", local.id).eq("name", "Platos").single()).data!.id, name: "Efímero", price_cents: 2000 }).select("id").single();
    sembrar(local, { branch: local.uno, estado: "closed", abre: loc(BA, 1, "15:00"), cierra: loc(BA, 1, "15:20"), lineas: [{ producto: efimero.data!.id, nombre: "Efímero", qty: 1, base: 2000 }] });
    expect((await service.from("products").delete().eq("id", efimero.data!.id)).error).toBeNull();
    const despues = await leerVentas(local.owner.db, local.id);
    expect(despues.current.revenue_cents).toBe(51000); // la venta sigue contando
    expect(despues.by_category.find((c) => c.name === null)).toMatchObject({ units: 1, revenue_cents: 2000 });
    const p = await leerPlatos(local.owner.db, local.id, { p_limit: 50 });
    expect(p.best.find((b) => b.name === "Efímero")).toMatchObject({ product_id: null, in_catalog: false, is_active: false, units: 1, revenue_cents: 2000 });
  });

  it("anulados y cancelaciones: con su motivo, agrupando sin importar las mayúsculas", async () => {
    const local = await crearLocal();
    escenario(local);
    const r = await leerVentas(local.owner.db, local.id);
    expect(r.void_reasons).toEqual([{ reason: "Cliente se fue", orders: 1, cents: 10000 }]);
    expect(r.cancel_reasons).toHaveLength(1);
    expect(r.cancel_reasons[0].reason.toLowerCase()).toBe("se equivocó");
    expect(r.cancel_reasons[0]).toMatchObject({ units: 4, cents: 12000 });
  });

  it("la ventana: 2 días mira solo ayer y hoy; 90 suma lo de hace 40 y manda lo de hace 100 al período anterior; el tope y el mínimo se aplican", async () => {
    const local = await crearLocal();
    escenario(local);
    const dos = await leerVentas(local.owner.db, local.id, { p_days: 2 });
    expect(dos.current).toMatchObject({ orders: 3, revenue_cents: 36000 });
    expect(dos.previous).toMatchObject({ orders: 1, revenue_cents: 13000, voided_orders: 1 }); // hace 3 días; el anulado y el sin líneas vivas de hace 2 no son ventas

    const noventa = await leerVentas(local.owner.db, local.id, { p_days: 90 });
    expect(noventa.current).toMatchObject({ orders: 5, revenue_cents: 55000 });
    expect(noventa.previous).toMatchObject({ orders: 1, revenue_cents: 10000 });

    expect((await leerVentas(local.owner.db, local.id, { p_days: 100_000 })).days).toBe(90);
    const minimo = await leerVentas(local.owner.db, local.id, { p_days: -3 });
    expect(minimo.days).toBe(1);
    expect(minimo.current.orders).toBe(0); // el abierto de hoy no cuenta
  });

  it("filtra por sucursal; una sucursal de otro local no devuelve nada de nadie", async () => {
    const local = await crearLocal();
    escenario(local);
    const uno = await leerVentas(local.owner.db, local.id, { p_branch: local.uno });
    expect(uno.current).toMatchObject({ orders: 2, revenue_cents: 39000, units: 5, voided_orders: 1, cancelled_units: 4, median_minutes: 45 });
    const dos = await leerVentas(local.owner.db, local.id, { p_branch: local.dos });
    expect(dos.current).toMatchObject({ orders: 2, revenue_cents: 10000, voided_orders: 0, cancelled_units: 0, median_minutes: 75 });

    const otro = await crearLocal();
    sembrar(otro, { branch: otro.uno, estado: "closed", abre: loc(BA, 1, "12:00"), cierra: loc(BA, 1, "12:30"), lineas: [{ producto: otro.producto.Milanesa, nombre: "Milanesa", qty: 99, base: 10000 }] });
    const intento = await leerVentas(local.owner.db, local.id, { p_branch: otro.uno });
    expect(intento.current).toMatchObject({ orders: 0, revenue_cents: 0, units: 0 });
    expect(intento.by_day).toEqual([]);
    const intentoPlatos = await leerPlatos(local.owner.db, local.id, { p_branch: otro.uno });
    expect(intentoPlatos.best).toEqual([]);
    expect(intentoPlatos.unsold).toEqual([]);
  });

  it("cada local ve solo lo suyo: lo vendido en otro no entra en la cuenta", async () => {
    const a = await crearLocal();
    escenario(a);
    const b = await crearLocal();
    sembrar(b, { branch: b.uno, estado: "closed", abre: loc(BA, 1, "12:00"), cierra: loc(BA, 1, "12:30"), lineas: [{ producto: b.producto.Milanesa, nombre: "Milanesa", qty: 99, base: 10000 }] });
    expect((await leerVentas(a.owner.db, a.id)).current.revenue_cents).toBe(49000);
    expect((await leerVentas(b.owner.db, b.id)).current.revenue_cents).toBe(990000);
    expect((await leerPlatos(a.owner.db, a.id)).best.map((x) => x.name)).toEqual(["Milanesa", "Ensalada", "Flan"]);
    expect((await leerPlatos(b.owner.db, b.id)).best.map((x) => [x.name, x.units])).toEqual([["Milanesa", 99]]);
  });

  it("un local sin pedidos devuelve ceros, listas vacías y tiempo típico nulo", async () => {
    const local = await crearLocal();
    const r = await leerVentas(local.owner.db, local.id);
    expect(r.current).toEqual({ orders: 0, revenue_cents: 0, units: 0, promo_discount_cents: 0, voided_orders: 0, voided_cents: 0, cancelled_units: 0, cancelled_cents: 0, median_minutes: null });
    expect(r.previous.orders).toBe(0);
    expect([r.by_day, r.by_slot, r.by_category, r.void_reasons, r.cancel_reasons]).toEqual([[], [], [], [], []]);
  });
});

describe("platos: más vendidos y sin pedidos", () => {
  it("ordena por importe, trae unidades y vistas, y lista los platos publicados sin pedidos con sus vistas", async () => {
    const local = await crearLocal();
    escenario(local);
    const r = await leerPlatos(local.owner.db, local.id);
    expect(r.best.map((b) => [b.name, b.category, b.units, b.revenue_cents, b.views])).toEqual([
      ["Milanesa", "Platos", 3, 32000, 50],
      ["Ensalada", "Platos", 3, 14000, 10],
      ["Flan", "Postres", 1, 3000, 0],
    ]);
    expect(r.best.every((b) => b.in_catalog && b.is_active)).toBe(true);
    // Sin pedidos: Sopa, Tarta y Oculto (oculto solo en una sucursal). No salen el inactivo ni el de la categoría inactiva.
    expect(r.unsold_total).toBe(3);
    expect(r.unsold.map((u) => [u.name, u.views])).toEqual([["Sopa", 20], ["Tarta", 5], ["Oculto", 0]]);
  });

  it("con una sucursal elegida, cuenta solo lo de ella y un plato oculto ahí no figura", async () => {
    const local = await crearLocal();
    escenario(local);
    const r = await leerPlatos(local.owner.db, local.id, { p_branch: local.uno });
    expect(r.best.map((b) => [b.name, b.units, b.revenue_cents, b.views])).toEqual([
      ["Milanesa", 3, 32000, 50],
      ["Ensalada", 1, 4000, 0],
      ["Flan", 1, 3000, 0],
    ]);
    expect(r.unsold_total).toBe(2);
    expect(r.unsold.map((u) => [u.name, u.views])).toEqual([["Sopa", 20], ["Tarta", 0]]);
  });

  it("el límite se respeta (mínimo 1, tope 50) pero el total de platos sin pedidos es el verdadero", async () => {
    const local = await crearLocal();
    escenario(local);
    const uno = await leerPlatos(local.owner.db, local.id, { p_limit: 1 });
    expect([uno.best.length, uno.unsold.length, uno.unsold_total]).toEqual([1, 1, 3]);
    expect((await leerPlatos(local.owner.db, local.id, { p_limit: 0 })).best).toHaveLength(1);
    expect((await leerPlatos(local.owner.db, local.id, { p_limit: 100_000 })).best).toHaveLength(3);
  });

  it("un plato desactivado después de venderse sigue figurando donde vendió, marcado", async () => {
    const local = await crearLocal();
    escenario(local);
    sql(`update public.products set is_active = false where id = '${local.producto.Ensalada}'`);
    const r = await leerPlatos(local.owner.db, local.id);
    expect(r.best.find((b) => b.name === "Ensalada")).toMatchObject({ in_catalog: true, is_active: false, units: 3 });
    expect(r.unsold.map((u) => u.name)).not.toContain("Ensalada");
  });
});

describe("quién puede leer", () => {
  it("nadie más recibe nada: Staff, Dueño de otro local, sin rol, plan Básico y cuenta suspendida; anon se rechaza; en «solo lectura» sí", async () => {
    const local = await crearLocal();
    escenario(local);
    const otro = await crearLocal();
    for (const [nombre, db] of [
      ["Staff", local.staff.db],
      ["Dueño de otro local", otro.owner.db],
      ["sin rol", comun.db],
      ["Dueño ajeno sin membresía", ajeno.db],
    ] as const) {
      const v = await ventas(db, local.id);
      const p = await platos(db, local.id);
      expect([nombre, v.error, v.data, p.error, p.data], nombre).toEqual([nombre, null, null, null, null]);
    }
    expect((await ventas(anonClient(), local.id)).error).not.toBeNull();
    expect((await platos(anonClient(), local.id)).error).not.toBeNull();
    expect((await ventas(local.owner.db, "00000000-0000-4000-8000-0000000000aa")).data).toBeNull();

    const basico = await crearLocal("basic");
    escenario({ ...basico, dos: basico.uno }); // aunque haya pedidos de antes
    expect((await ventas(basico.owner.db, basico.id)).data).toBeNull();
    expect((await platos(basico.owner.db, basico.id)).data).toBeNull();

    await setSubscription(service, local.id, { finEnMs: -10 * DIA_MS }); // solo lectura
    expect((await leerVentas(local.owner.db, local.id)).current.orders).toBe(4);
    expect((await leerPlatos(local.owner.db, local.id)).best.length).toBeGreaterThan(0);
    await setSubscription(service, local.id, { finEnMs: -30 * DIA_MS }); // suspendida
    expect((await ventas(local.owner.db, local.id)).data).toBeNull();
    expect((await platos(local.owner.db, local.id)).data).toBeNull();
  });

  it("quien deja de ser Dueño deja de ver al instante", async () => {
    const local = await crearLocal();
    escenario(local);
    expect((await leerVentas(local.owner.db, local.id)).current.orders).toBe(4);
    await addMembership(service, ajeno, local.id, "owner"); // la base exige al menos un Dueño
    sql(`update public.memberships set role = 'staff' where user_id = '${local.owner.id}' and organization_id = '${local.id}'`);
    expect((await ventas(local.owner.db, local.id)).data).toBeNull();
    expect((await platos(local.owner.db, local.id)).data).toBeNull();
    expect((await leerVentas(ajeno.db, local.id)).current.orders).toBe(4);
  });

  it("la respuesta no trae personas ni claves del pedido, y leer no escribe", async () => {
    const local = await crearLocal();
    escenario(local);
    const antes = filas();
    const v = await ventas(local.owner.db, local.id);
    const p = await platos(local.owner.db, local.id);
    const texto = JSON.stringify([v.data, p.data]);
    expect(texto).not.toMatch(/client_key|opened_by|closed_by|created_by|actor|email|@/i);
    expect(Object.keys(v.data as object).sort()).toEqual(["by_category", "by_day", "by_slot", "cancel_reasons", "current", "days", "previous", "void_reasons"]);
    expect(Object.keys(p.data as object).sort()).toEqual(["best", "days", "unsold", "unsold_total"]);
    expect(filas()).toBe(antes);
  });
});
