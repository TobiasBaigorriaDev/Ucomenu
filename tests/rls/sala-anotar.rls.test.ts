import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAnotar, loadTableLines } from "@/lib/sala/anotar-loader";
import { loadPrecuenta } from "@/lib/sala/precuenta-loader";
import {
  addMembership,
  createCategory,
  createOrg,
  createUser,
  DIA_MS,
  deleteOrg,
  deleteUser,
  anonClient,
  serviceClient,
  setSubscription,
  type Db,
  type PlanCode,
  type TestUser,
} from "./helpers";

/**
 * Pantalla «Anotar» de la Sala (ficha sala-anotar-pedido, ADR 0041) contra el Supabase local, con las SESIONES de la Dueña y el Staff
 * (RLS real): qué carta ve el mozo para una mesa (la de SU sucursal, solo lo activo y publicable, con el precio efectivo de ahora), qué
 * platos no se pueden anotar y por qué, y las líneas del pedido abierto con sus opciones copiadas.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
const orgs: string[] = [];
let contador = 0;
let ordenGrupo = 0;
const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function nuevoLocal(plan: PlanCode = "pro", dosSucursales = true) {
  contador += 1;
  const id = await createOrg(service, `tt-anotar-${sufijo}-${contador}`, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const sucursal = async (slug: string, name: string) => {
    const b = await service.from("branches").insert({ organization_id: id, slug, name }).select("id").single();
    if (b.error) throw new Error(`sucursal: ${b.error.message}`);
    const m = await service
      .from("tables")
      .insert(["Mesa 1", "Mesa 2"].map((label) => ({ organization_id: id, branch_id: b.data.id, label })))
      .select("id, label")
      .order("label");
    if (m.error) throw new Error(`mesas: ${m.error.message}`);
    return { branch: b.data.id, mesas: m.data };
  };
  const centro = await sucursal("principal", "Centro");
  const norte = dosSucursales ? await sucursal("norte", "Norte") : centro;
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  const plato = async (categoria: string, name: string, price_cents: number, extra: Record<string, unknown> = {}) => {
    const p = await service.from("products").insert({ organization_id: id, category_id: categoria, name, price_cents, ...extra }).select("id").single();
    if (p.error) throw new Error(`plato: ${p.error.message}`);
    return p.data.id as string;
  };
  const grupo = async (product: string, name: string, min: number, max: number, opciones: { name: string; delta: number; active?: boolean }[], active = true) => {
    const g = await service.from("option_groups").insert({ organization_id: id, product_id: product, name, min_choices: min, max_choices: max, is_active: active, sort_order: ++ordenGrupo }).select("id").single();
    if (g.error) throw new Error(`grupo: ${g.error.message}`);
    const rows = opciones.map((o, i) => ({ organization_id: id, group_id: g.data.id, name: o.name, price_delta_cents: o.delta, sort_order: i, is_active: o.active ?? true }));
    const ops = rows.length > 0 ? await service.from("options").insert(rows).select("id, name") : { data: [], error: null };
    if (ops.error) throw new Error(`opciones: ${ops.error.message}`);
    return { id: g.data.id as string, opciones: ops.data as { id: string; name: string }[] };
  };
  return { id, centro, norte, plato, grupo, categoria: (name = "Platos") => createCategory(service, id, name) };
}

const anotar = async (db: Db, branch: string, table: string, product: string, extra: Record<string, unknown> = {}) => {
  const r = await db.rpc("add_order_item", { p_branch: branch, p_table: table, p_product: product, p_quantity: 1, p_client_key: randomUUID(), ...extra } as never);
  if (r.error) throw new Error(`add_order_item: ${r.error.message}`);
  return r.data as { order_id: string; item_id: string };
};

const nombres = (data: Awaited<ReturnType<typeof loadAnotar>>) => data?.sections.flatMap((s) => s.products.map((p) => p.name)) ?? [];

beforeAll(async () => {
  service = serviceClient();
  [owner, staff] = await Promise.all([createUser(service, "anotar-owner"), createUser(service, "anotar-staff")]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff].map((u) => deleteUser(service, u)));
});

describe("la carta que ve el mozo para una mesa", () => {
  it("es la de la sucursal de la mesa, solo con lo activo y publicable, en el orden de la carta", async () => {
    const l = await nuevoLocal();
    const platos = await l.categoria("Platos");
    const postres = await l.categoria("Postres");
    await l.categoria("Vacía");
    const inactiva = await createCategoryInactive(l.id, "Temporada");
    await l.plato(platos, "Bife", 10000, { sort_order: 2 });
    await l.plato(platos, "Milanesa", 8000, { sort_order: 1 });
    await l.plato(platos, "Retirado", 5000, { is_active: false });
    await l.plato(postres, "Flan", 3000);
    await l.plato(inactiva, "De temporada", 3000);

    for (const quien of [owner, staff]) {
      const data = await loadAnotar(quien.db, l.id, l.centro.mesas[0].id);
      expect(data?.enabled).toBe(true);
      expect(data?.table).toMatchObject({ label: "Mesa 1", branchId: l.centro.branch, branchName: "Centro" });
      expect(data?.multiBranch).toBe(true);
      expect(data?.sections.map((s) => s.name)).toEqual(["Platos", "Postres"]);
      expect(nombres(data)).toEqual(["Milanesa", "Bife", "Flan"]);
      expect(data?.lines).toEqual([]);
    }
  });

  it("no incluye lo oculto en ESA sucursal, marca lo agotado y aplica el precio propio de la sucursal", async () => {
    const l = await nuevoLocal();
    const cat = await l.categoria();
    const oculto = await l.plato(cat, "Oculto en Centro", 1000);
    const agotado = await l.plato(cat, "Agotado en Centro", 2000);
    const propio = await l.plato(cat, "Precio propio", 3000);
    await l.plato(cat, "Normal", 4000);
    const ajustes = await service.from("product_availability").insert([
      { organization_id: l.id, branch_id: l.centro.branch, product_id: oculto, is_visible: false, is_available: true, price_cents: null },
      { organization_id: l.id, branch_id: l.centro.branch, product_id: agotado, is_visible: true, is_available: false, price_cents: null },
      { organization_id: l.id, branch_id: l.centro.branch, product_id: propio, is_visible: true, is_available: true, price_cents: 3500 },
    ]);
    expect(ajustes.error).toBeNull();

    const centro = await loadAnotar(staff.db, l.id, l.centro.mesas[0].id);
    expect(nombres(centro)).toEqual(["Agotado en Centro", "Normal", "Precio propio"]);
    const byName = Object.fromEntries(centro!.sections.flatMap((s) => s.products).map((p) => [p.name, p]));
    expect(byName["Agotado en Centro"].block).toBe("unavailable");
    expect(byName["Normal"].block).toBeNull();
    expect(byName["Precio propio"].priceCents).toBe(3500);
    expect(byName["Oculto en Centro"]).toBeUndefined();

    // En la otra sucursal el mismo catálogo se ve sin esos ajustes.
    const norte = await loadAnotar(staff.db, l.id, l.norte.mesas[0].id);
    expect(nombres(norte).sort()).toEqual(["Agotado en Centro", "Normal", "Oculto en Centro", "Precio propio"]);
    const n = Object.fromEntries(norte!.sections.flatMap((s) => s.products).map((p) => [p.name, p]));
    expect(n["Agotado en Centro"].block).toBeNull();
    expect(n["Precio propio"].priceCents).toBe(3000);
  });

  it("muestra el precio efectivo con la promoción en curso y el de lista aparte", async () => {
    const l = await nuevoLocal();
    const cat = await l.categoria();
    const bife = await l.plato(cat, "Bife", 10000);
    await l.plato(cat, "Sin promo", 6000);
    const promo = await service
      .from("promotions")
      .insert({ organization_id: l.id, name: "Mitad", discount_type: "percent", discount_value: 50, weekdays_mask: 127, start_minute: 0, end_minute: 1440 })
      .select("id")
      .single();
    await service.from("promotion_targets").insert({ organization_id: l.id, promotion_id: promo.data!.id, product_id: bife });

    const data = await loadAnotar(owner.db, l.id, l.centro.mesas[0].id);
    const byName = Object.fromEntries(data!.sections.flatMap((s) => s.products).map((p) => [p.name, p]));
    expect(byName["Bife"]).toMatchObject({ priceCents: 5000, listCents: 10000, promotionName: "Mitad" });
    expect(byName["Sin promo"]).toMatchObject({ priceCents: 6000, listCents: null, promotionName: null });
  });

  it("trae los grupos activos con sus opciones activas; un grupo obligatorio que no se puede cumplir bloquea el plato", async () => {
    const l = await nuevoLocal();
    const cat = await l.categoria();
    const bife = await l.plato(cat, "Bife", 10000);
    await l.grupo(bife, "Punto", 1, 1, [{ name: "Jugoso", delta: 0 }, { name: "A punto", delta: 0 }, { name: "Inactiva", delta: 0, active: false }]);
    await l.grupo(bife, "Extras", 0, 2, [{ name: "Bacon", delta: 1500 }]);
    await l.grupo(bife, "Grupo apagado", 1, 1, [{ name: "Nada", delta: 0 }], false);
    const sinOpciones = await l.plato(cat, "Obligatorio sin opciones", 5000);
    await l.grupo(sinOpciones, "Salsa", 1, 1, []);
    const opcionalVacio = await l.plato(cat, "Opcional sin opciones", 5000);
    await l.grupo(opcionalVacio, "Aderezo", 0, 1, []);
    const pocas = await l.plato(cat, "Mínimo mayor a las opciones", 5000);
    await l.grupo(pocas, "Elegí tres", 3, 3, [{ name: "Uno", delta: 0 }, { name: "Dos", delta: 0 }]);

    const data = await loadAnotar(staff.db, l.id, l.centro.mesas[0].id);
    const byName = Object.fromEntries(data!.sections.flatMap((s) => s.products).map((p) => [p.name, p]));
    expect(byName["Bife"].block).toBeNull();
    expect(byName["Bife"].groups.map((g) => [g.name, g.min, g.max, g.options.map((o) => [o.name, o.deltaCents])])).toEqual([
      ["Punto", 1, 1, [["Jugoso", 0], ["A punto", 0]]],
      ["Extras", 0, 2, [["Bacon", 1500]]],
    ]);
    expect(byName["Obligatorio sin opciones"].block).toBe("options_unfulfillable");
    expect(byName["Opcional sin opciones"]).toMatchObject({ block: null, groups: [] });
    expect(byName["Mínimo mayor a las opciones"].block).toBe("options_unfulfillable");
  });

  it("es solo del local: una mesa de otra organización, o inactiva, o de una sucursal dada de baja, no existe", async () => {
    const a = await nuevoLocal();
    const b = await nuevoLocal();
    await a.categoria();
    expect(await loadAnotar(owner.db, b.id, a.centro.mesas[0].id)).toBeNull();
    expect(await loadAnotar(owner.db, a.id, randomUUID())).toBeNull();
    await service.from("tables").update({ is_active: false }).eq("id", a.centro.mesas[1].id);
    expect(await loadAnotar(owner.db, a.id, a.centro.mesas[1].id)).toBeNull();
    await service.from("branches").update({ is_active: false }).eq("id", a.norte.branch);
    expect(await loadAnotar(owner.db, a.id, a.norte.mesas[0].id)).toBeNull();
    expect((await loadAnotar(owner.db, a.id, a.centro.mesas[0].id))?.multiBranch).toBe(false);
  });

  it("sin la función de pedidos (plan Básico) no se lee la carta: aviso y nada más", async () => {
    const l = await nuevoLocal("basic", false);
    const cat = await l.categoria();
    await l.plato(cat, "Bife", 10000);
    for (const quien of [owner, staff]) {
      const data = await loadAnotar(quien.db, l.id, l.centro.mesas[0].id);
      expect(data).toMatchObject({ enabled: false, sections: [], lines: [] });
      expect(data?.table.label).toBe("Mesa 1");
    }
  });
});

describe("las líneas del pedido abierto de la mesa", () => {
  it("trae lo anotado con sus opciones copiadas, la nota y el estado, de la más antigua a la más nueva; lo cancelado sigue visible", async () => {
    const l = await nuevoLocal();
    const cat = await l.categoria();
    const bife = await l.plato(cat, "Bife", 10000);
    const g = await l.grupo(bife, "Extras", 0, 3, [{ name: "Bacon", delta: 1500 }, { name: "Huevo", delta: 1000 }]);
    const mesa = l.centro.mesas[0];
    const a = await anotar(owner.db, l.centro.branch, mesa.id, bife, { p_quantity: 2, p_options: [g.opciones[0].id, g.opciones[1].id], p_note: "  sin sal " });
    const b = await anotar(staff.db, l.centro.branch, mesa.id, bife);
    expect((await owner.db.rpc("set_order_item_status", { p_item: a.item_id, p_status: "delivered" })).error).toBeNull();
    expect((await owner.db.rpc("set_order_item_status", { p_item: b.item_id, p_status: "cancelled", p_reason: "Se equivocó" })).error).toBeNull();

    const lines = await loadTableLines(staff.db, l.id, mesa.id);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ productName: "Bife", quantity: 2, status: "delivered", unitPriceCents: 10000, optionsCents: 2500, note: "sin sal" });
    expect(lines[0].options.map((o) => [o.group, o.name, o.deltaCents])).toEqual([
      ["Extras", "Bacon", 1500],
      ["Extras", "Huevo", 1000],
    ]);
    expect(lines[0].cancelReason).toBeNull();
    expect(lines[1]).toMatchObject({ status: "cancelled", note: null, options: [], cancelReason: "Se equivocó" });

    // También la ve la pantalla de la mesa completa.
    const data = await loadAnotar(owner.db, l.id, mesa.id);
    expect(data?.lines.map((x) => x.status)).toEqual(["delivered", "cancelled"]);
    expect(data?.orderId).toBe(a.order_id);
    // Y la otra mesa, nada.
    expect(await loadTableLines(owner.db, l.id, l.centro.mesas[1].id)).toEqual([]);
    expect((await loadAnotar(owner.db, l.id, l.centro.mesas[1].id))?.orderId).toBeNull();
  });

  it("un pedido abierto sin líneas vivas (todo cancelado) conserva su id: se puede cerrar", async () => {
    const l = await nuevoLocal();
    const cat = await l.categoria();
    const bife = await l.plato(cat, "Bife", 10000);
    const mesa = l.centro.mesas[0];
    const a = await anotar(owner.db, l.centro.branch, mesa.id, bife);
    expect((await owner.db.rpc("set_order_item_status", { p_item: a.item_id, p_status: "cancelled" })).error).toBeNull();
    const data = await loadAnotar(staff.db, l.id, mesa.id);
    expect(data?.orderId).toBe(a.order_id);
    expect(data?.lines.map((x) => x.status)).toEqual(["cancelled"]);
  });

  it("si el plan se baja con un pedido abierto, la pantalla lo sigue trayendo (para cerrarlo o anularlo) pero sin carta", async () => {
    const l = await nuevoLocal();
    const cat = await l.categoria();
    const bife = await l.plato(cat, "Bife", 10000);
    const mesa = l.centro.mesas[0];
    const a = await anotar(owner.db, l.centro.branch, mesa.id, bife, { p_quantity: 2 });
    expect((await service.from("subscriptions").update({ plan_code: "basic" }).eq("organization_id", l.id)).error).toBeNull();
    for (const quien of [owner, staff]) {
      const data = await loadAnotar(quien.db, l.id, mesa.id);
      expect(data).toMatchObject({ enabled: false, sections: [], orderId: a.order_id });
      expect(data?.lines).toHaveLength(1);
      // Cerrar sí se puede aunque el plan ya no lo incluya (ADR 0041, decisión 5)…
    }
    expect((await staff.db.rpc("close_order", { p_order: a.order_id })).error).toBeNull();
    // …y después la mesa queda sin pedido.
    expect(await loadAnotar(owner.db, l.id, mesa.id)).toMatchObject({ enabled: false, orderId: null, lines: [] });
  });

  it("un pedido cerrado o anulado no se lista: la mesa vuelve a estar libre y un pedido nuevo empieza de cero", async () => {
    const l = await nuevoLocal();
    const cat = await l.categoria();
    const bife = await l.plato(cat, "Bife", 10000);
    const [m1, m2] = l.centro.mesas;
    const a = await anotar(owner.db, l.centro.branch, m1.id, bife);
    const b = await anotar(owner.db, l.centro.branch, m2.id, bife);
    expect((await owner.db.rpc("close_order", { p_order: a.order_id })).error).toBeNull();
    expect((await owner.db.rpc("void_order", { p_order: b.order_id, p_reason: "Se fueron" })).error).toBeNull();
    expect(await loadTableLines(owner.db, l.id, m1.id)).toEqual([]);
    expect(await loadTableLines(owner.db, l.id, m2.id)).toEqual([]);
    await anotar(owner.db, l.centro.branch, m1.id, bife, { p_quantity: 3 });
    expect((await loadTableLines(owner.db, l.id, m1.id)).map((x) => x.quantity)).toEqual([3]);
  });

  it("no ve pedidos de otra organización", async () => {
    const a = await nuevoLocal();
    const b = await nuevoLocal();
    const cat = await a.categoria();
    const bife = await a.plato(cat, "Bife", 10000);
    await anotar(owner.db, a.centro.branch, a.centro.mesas[0].id, bife);
    // La dueña y el Staff son miembros de AMBOS locales de prueba, así que se pide la mesa de A como si fuera de B: no hay pedido.
    expect(await loadTableLines(owner.db, b.id, a.centro.mesas[0].id)).toEqual([]);
  });
});

describe("la precuenta de un pedido", () => {
  it("trae el pedido con sus líneas, la sucursal y su zona horaria; lo ven el Dueño y el Staff", async () => {
    const l = await nuevoLocal();
    const cat = await l.categoria();
    const bife = await l.plato(cat, "Bife", 10000);
    const g = await l.grupo(bife, "Extras", 0, 2, [{ name: "Bacon", delta: 1500 }]);
    const mesa = l.centro.mesas[0];
    const a = await anotar(owner.db, l.centro.branch, mesa.id, bife, { p_quantity: 2, p_options: [g.opciones[0].id], p_note: "sin sal" });
    const b = await anotar(owner.db, l.centro.branch, mesa.id, bife);
    expect((await owner.db.rpc("set_order_item_status", { p_item: b.item_id, p_status: "cancelled" })).error).toBeNull();

    for (const quien of [owner, staff]) {
      const data = await loadPrecuenta(quien.db, l.id, a.order_id);
      expect(data).toMatchObject({ orderId: a.order_id, status: "open", tableId: mesa.id, tableLabel: "Mesa 1", branchName: "Centro", multiBranch: true, closedAt: null });
      expect(data?.timeZone).toMatch(/\//);
      expect(data?.lines.map((x) => [x.quantity, x.status, x.unitPriceCents, x.optionsCents])).toEqual([[2, "noted", 10000, 1500], [1, "cancelled", 10000, 0]]);
      expect(data?.lines[0].options.map((o) => o.name)).toEqual(["Bacon"]);
    }
  });

  it("un pedido cerrado o anulado también se puede ver, con su estado y la hora de cierre", async () => {
    const l = await nuevoLocal();
    const cat = await l.categoria();
    const bife = await l.plato(cat, "Bife", 10000);
    const a = await anotar(owner.db, l.centro.branch, l.centro.mesas[0].id, bife);
    const b = await anotar(owner.db, l.centro.branch, l.centro.mesas[1].id, bife);
    expect((await owner.db.rpc("close_order", { p_order: a.order_id })).error).toBeNull();
    expect((await owner.db.rpc("void_order", { p_order: b.order_id, p_reason: "Se fueron" })).error).toBeNull();
    const cerrado = await loadPrecuenta(staff.db, l.id, a.order_id);
    const anulado = await loadPrecuenta(staff.db, l.id, b.order_id);
    expect(cerrado?.status).toBe("closed");
    expect(cerrado?.closedAt).not.toBeNull();
    expect(anulado?.status).toBe("void");
    expect(cerrado?.lines).toHaveLength(1);
  });

  it("si se borra la mesa, el pedido conserva su etiqueta y la precuenta se sigue pudiendo armar", async () => {
    const l = await nuevoLocal();
    const cat = await l.categoria();
    const bife = await l.plato(cat, "Bife", 10000);
    const mesa = l.centro.mesas[1];
    const a = await anotar(owner.db, l.centro.branch, mesa.id, bife);
    expect((await owner.db.rpc("close_order", { p_order: a.order_id })).error).toBeNull();
    expect((await service.from("tables").delete().eq("id", mesa.id)).error).toBeNull();
    expect(await loadPrecuenta(owner.db, l.id, a.order_id)).toMatchObject({ tableId: null, tableLabel: "Mesa 2", status: "closed" });
  });

  it("es solo del local: un pedido de otra organización o inexistente no existe", async () => {
    const a = await nuevoLocal();
    const b = await nuevoLocal();
    const cat = await a.categoria();
    const bife = await a.plato(cat, "Bife", 10000);
    const pedido = await anotar(owner.db, a.centro.branch, a.centro.mesas[0].id, bife);
    expect(await loadPrecuenta(owner.db, b.id, pedido.order_id)).toBeNull();
    expect(await loadPrecuenta(owner.db, a.id, randomUUID())).toBeNull();
    // Y el anónimo no tiene ni permiso de lectura sobre los pedidos.
    await expect(loadPrecuenta(anonClient(), a.id, pedido.order_id)).rejects.toThrow(/permission denied/);
  });
});

async function createCategoryInactive(orgId: string, name: string): Promise<string> {
  const r = await service.from("categories").insert({ organization_id: orgId, name, is_active: false }).select("id").single();
  if (r.error) throw new Error(`categoría: ${r.error.message}`);
  return r.data.id;
}
