import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSala } from "@/lib/sala/pending";
import { loadMesas } from "@/lib/sala/mesas-loader";
import { setBranchView } from "@/lib/sucursales/vista";
import {
  addMembership,
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
 * Vista «Mesas» de la Sala y total en «Pide la cuenta» (ficha sala-mesas-y-total, ADR 0041) contra el Supabase local, con las
 * SESIONES de la Dueña y el Staff (RLS real): qué mesas y pedidos ven, que el total suma lo que corresponde, que respeta la vista por
 * sucursal y el plan, y que no cruza organizaciones.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
const orgs: string[] = [];
let contador = 0;
const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

type Local = { id: string; branch: string; product: string; mesas: { id: string; label: string; token: string }[]; branch2?: string; mesas2?: { id: string; label: string; token: string }[] };

async function nuevoLocal(plan: PlanCode = "pro", opciones: { dosSucursales?: boolean } = {}): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-mesas-${sufijo}-${contador}`, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const sucursal = async (slug: string, name: string) => {
    const b = await service.from("branches").insert({ organization_id: id, slug, name }).select("id").single();
    if (b.error) throw new Error(`sucursal: ${b.error.message}`);
    const m = await service
      .from("tables")
      .insert(["Mesa 1", "Mesa 2", "Mesa 3"].map((label) => ({ organization_id: id, branch_id: b.data.id, label })))
      .select("id, label, qr_token")
      .order("label");
    if (m.error) throw new Error(`mesas: ${m.error.message}`);
    return { branch: b.data.id, mesas: m.data.map((x) => ({ id: x.id, label: x.label, token: x.qr_token })) };
  };
  const a = await sucursal("principal", "Centro");
  const b = opciones.dosSucursales ? await sucursal("norte", "Norte") : undefined;
  const category = await createCategory(service, id, "Platos");
  const p = await service.from("products").insert({ organization_id: id, category_id: category, name: "Bife", price_cents: 10000 }).select("id").single();
  if (p.error) throw new Error(`plato: ${p.error.message}`);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, branch: a.branch, product: p.data.id, mesas: a.mesas, branch2: b?.branch, mesas2: b?.mesas };
}

const anotar = async (db: Db, l: Pick<Local, "product">, branch: string, table: string, extra: Record<string, unknown> = {}) => {
  const r = await db.rpc("add_order_item", { p_branch: branch, p_table: table, p_product: l.product, p_quantity: 1, p_client_key: randomUUID(), ...extra } as never);
  if (r.error) throw new Error(`add_order_item: ${r.error.message}`);
  return r.data as { order_id: string; item_id: string };
};

const llamar = async (token: string, kind: "waiter" | "bill") => {
  const r = await service.rpc("create_waiter_call", { p_token: token, p_kind: kind });
  expect(r.error).toBeNull();
};

const carta = (estado: Awaited<ReturnType<typeof loadMesas>>, label: string, branchName?: string) =>
  estado.mesas.find((m) => m.tableLabel === label && (branchName === undefined || m.branchName === branchName));

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([
    createUser(service, "mesas-owner"),
    createUser(service, "mesas-staff"),
    createUser(service, "mesas-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, stranger].map((u) => deleteUser(service, u)));
});

describe("las mesas y su pedido abierto", () => {
  it("lista las mesas activas; una con pedido muestra platos y el total; una sin pedido, libre", async () => {
    const l = await nuevoLocal();
    await service.from("tables").update({ is_active: false }).eq("id", l.mesas[2].id);
    await anotar(owner.db, l, l.branch, l.mesas[0].id, { p_quantity: 2 });

    for (const quien of [owner, staff]) {
      const estado = await loadMesas(quien.db, l.id);
      expect(estado.enabled).toBe(true);
      expect(estado.mesas.map((m) => m.tableLabel)).toEqual(["Mesa 1", "Mesa 2"]);
      expect(carta(estado, "Mesa 1")?.order).toMatchObject({ dishes: 2, noted: 2, inKitchen: 0, delivered: 0, totalCents: 20000 });
      expect(carta(estado, "Mesa 2")?.order).toBeNull();
    }
  });

  it("el total suma cantidad por (precio efectivo + opciones) de lo no cancelado, con los estados contados en unidades", async () => {
    const l = await nuevoLocal();
    const grupo = await service.from("option_groups").insert({ organization_id: l.id, product_id: l.product, name: "Extras", min_choices: 0, max_choices: 3 }).select("id").single();
    const ops = await service.from("options").insert([{ organization_id: l.id, group_id: grupo.data!.id, name: "Bacon", price_delta_cents: 1500 }]).select("id");
    const promo = await service
      .from("promotions")
      .insert({ organization_id: l.id, name: "Mitad", discount_type: "percent", discount_value: 50, weekdays_mask: 127, start_minute: 0, end_minute: 1440 })
      .select("id")
      .single();
    await service.from("promotion_targets").insert({ organization_id: l.id, promotion_id: promo.data!.id, product_id: l.product });

    const mesa = l.mesas[0];
    const a = await anotar(owner.db, l, l.branch, mesa.id, { p_quantity: 2, p_options: [ops.data![0].id] }); // 2 × (5000 + 1500)
    const b = await anotar(owner.db, l, l.branch, mesa.id, { p_quantity: 3 }); // 3 × 5000
    const c = await anotar(owner.db, l, l.branch, mesa.id, { p_quantity: 4 }); // se cancela: no suma
    expect((await owner.db.rpc("set_order_item_status", { p_item: b.item_id, p_status: "in_kitchen" })).error).toBeNull();
    expect((await owner.db.rpc("set_order_item_status", { p_item: c.item_id, p_status: "cancelled" })).error).toBeNull();
    expect((await owner.db.rpc("set_order_item_status", { p_item: a.item_id, p_status: "delivered" })).error).toBeNull();

    const m = carta(await loadMesas(staff.db, l.id), "Mesa 1");
    expect(m?.order).toMatchObject({ dishes: 5, noted: 0, inKitchen: 3, delivered: 2, totalCents: 2 * 6500 + 3 * 5000 });
  });

  it("un pedido cerrado o anulado no aparece (la mesa queda libre) y uno al que se le canceló todo se ve libre", async () => {
    const l = await nuevoLocal();
    const a = await anotar(owner.db, l, l.branch, l.mesas[0].id);
    const b = await anotar(owner.db, l, l.branch, l.mesas[1].id);
    const c = await anotar(owner.db, l, l.branch, l.mesas[2].id);
    expect((await owner.db.rpc("close_order", { p_order: a.order_id })).error).toBeNull();
    expect((await owner.db.rpc("void_order", { p_order: b.order_id, p_reason: "Se fueron" })).error).toBeNull();
    expect((await owner.db.rpc("set_order_item_status", { p_item: c.item_id, p_status: "cancelled" })).error).toBeNull();
    const estado = await loadMesas(owner.db, l.id);
    expect(estado.mesas.every((m) => m.order === null)).toBe(true);
    // Abrir otro pedido en la mesa cerrada: se ve el nuevo, no el viejo.
    await anotar(owner.db, l, l.branch, l.mesas[0].id, { p_quantity: 3 });
    expect(carta(await loadMesas(owner.db, l.id), "Mesa 1")?.order).toMatchObject({ dishes: 3, totalCents: 30000 });
  });

  it("un pedido con más de 1000 líneas se lee entero (PostgREST corta cada lectura en 1000 filas)", async () => {
    const l = await nuevoLocal();
    const a = await anotar(owner.db, l, l.branch, l.mesas[0].id);
    sql(`
      insert into public.order_items (organization_id, order_id, product_id, product_name, quantity, base_price_cents, unit_price_cents, client_key, request_hash)
      select '${l.id}', '${a.order_id}', '${l.product}', 'Cerveza', 1, 100, 100, gen_random_uuid(), 'x' from generate_series(1, 1100)`);
    const m = carta(await loadMesas(owner.db, l.id), "Mesa 1");
    expect(m?.order).toMatchObject({ dishes: 1101, totalCents: 10000 + 110000 });
  });
});

describe("los llamados de cada mesa", () => {
  it("la mesa que pide la cuenta sube primero, con su pedido; uno de 30 minutos o más no se ve", async () => {
    const l = await nuevoLocal();
    await anotar(owner.db, l, l.branch, l.mesas[1].id, { p_quantity: 2 });
    await llamar(l.mesas[0].token, "waiter");
    await llamar(l.mesas[1].token, "bill");
    await llamar(l.mesas[2].token, "waiter");
    sql(`update public.waiter_calls set created_at = now() - interval '31 minutes' where table_id = '${l.mesas[2].id}'`);

    const estado = await loadMesas(staff.db, l.id);
    expect(estado.mesas.map((m) => m.tableLabel)).toEqual(["Mesa 2", "Mesa 1", "Mesa 3"]);
    expect(carta(estado, "Mesa 2")).toMatchObject({ calls: [{ kind: "bill" }], order: { dishes: 2, totalCents: 20000 } });
    expect(carta(estado, "Mesa 1")?.calls).toHaveLength(1);
    expect(carta(estado, "Mesa 3")?.calls).toEqual([]);
  });

  it("atender el llamado no cierra el pedido", async () => {
    const l = await nuevoLocal();
    await anotar(owner.db, l, l.branch, l.mesas[0].id);
    await llamar(l.mesas[0].token, "bill");
    const llamado = await service.from("waiter_calls").select("id").eq("table_id", l.mesas[0].id).single();
    expect((await staff.db.from("waiter_calls").update({ status: "attended" }).eq("id", llamado.data!.id).select("id")).data).toHaveLength(1);
    const m = carta(await loadMesas(staff.db, l.id), "Mesa 1");
    expect(m?.calls).toEqual([]);
    expect(m?.order).toMatchObject({ dishes: 1, totalCents: 10000 });
  });
});

describe("la vista por sucursal", () => {
  it("solo muestra las mesas de las sucursales que la persona mira; vacío = todas", async () => {
    const l = await nuevoLocal("pro", { dosSucursales: true });
    await anotar(owner.db, l, l.branch, l.mesas[0].id);
    await anotar(owner.db, l, l.branch2!, l.mesas2![0].id, { p_quantity: 2 });

    const todas = await loadMesas(owner.db, l.id);
    expect(todas.multiBranch).toBe(true);
    expect(todas.mesas).toHaveLength(6);
    expect(carta(todas, "Mesa 1", "Norte")?.order?.dishes).toBe(2);

    expect(await setBranchView(owner.db, l.id, [l.branch2!])).toBe("ok");
    const norte = await loadMesas(owner.db, l.id);
    expect(norte.view).toEqual([l.branch2]);
    expect(norte.mesas.map((m) => m.branchName)).toEqual(["Norte", "Norte", "Norte"]);
    // La preferencia es de cada persona: el Staff sigue viendo todas.
    expect((await loadMesas(staff.db, l.id)).mesas).toHaveLength(6);
    expect(await setBranchView(owner.db, l.id, [])).toBe("ok");
  });
});

describe("plan, mora y aislamiento", () => {
  it("sin la función, en solo lectura o suspendida no hay lista (aunque haya pedidos); en gracia sí", async () => {
    const l = await nuevoLocal();
    await anotar(owner.db, l, l.branch, l.mesas[0].id);
    expect((await loadMesas(owner.db, l.id)).enabled).toBe(true);

    await setSubscription(service, l.id, { finEnMs: -3 * DIA_MS }); // gracia
    expect((await loadMesas(owner.db, l.id)).enabled).toBe(true);
    for (const dias of [10, 20]) {
      await setSubscription(service, l.id, { finEnMs: -dias * DIA_MS });
      expect(await loadMesas(owner.db, l.id), `${dias} días de mora`).toMatchObject({ enabled: false, mesas: [] });
    }
    await setSubscription(service, l.id, { finEnMs: 30 * DIA_MS });
    await setSubscription(service, l.id, { plan: "basic" });
    expect(await loadMesas(staff.db, l.id)).toMatchObject({ enabled: false, mesas: [] });
  });

  it("una vista previa vigente de `orders` en un Básico la habilita", async () => {
    const l = await nuevoLocal("basic");
    expect((await loadMesas(owner.db, l.id)).enabled).toBe(false);
    sql(`insert into public.organization_feature_previews (organization_id, feature, ends_at, reason) values ('${l.id}', 'orders', now() + interval '5 days', 'Piloto')`);
    const estado = await loadMesas(owner.db, l.id);
    expect(estado.enabled).toBe(true);
    expect(estado.mesas).toHaveLength(3);
  });

  it("un miembro de otra organización no ve nada de este local, ni mesas ni pedidos ni llamados", async () => {
    const l = await nuevoLocal();
    const otro = await nuevoLocal("pro");
    // El Staff y la Dueña son miembros de los dos locales de prueba: se usa una cuenta que solo es de uno.
    await service.from("memberships").delete().eq("organization_id", l.id).eq("user_id", stranger.id);
    await addMembership(service, stranger, otro.id, "owner");
    await anotar(owner.db, l, l.branch, l.mesas[0].id);
    await llamar(l.mesas[0].token, "bill");

    expect(await loadMesas(stranger.db, l.id)).toMatchObject({ enabled: false, mesas: [] });
    expect((await loadSala(stranger.db, l.id)).calls).toEqual([]);
    expect((await loadMesas(stranger.db, otro.id)).mesas).toHaveLength(3);
  });
});

describe("el total en «Pide la cuenta» de la Sala de llamados", () => {
  it("la tarjeta del llamado `bill` trae el total y los platos del pedido abierto; el `waiter` y una mesa sin pedido, ni la clave", async () => {
    const l = await nuevoLocal();
    await anotar(owner.db, l, l.branch, l.mesas[0].id, { p_quantity: 3 });
    const otro = await anotar(owner.db, l, l.branch, l.mesas[0].id, { p_quantity: 1 });
    expect((await owner.db.rpc("set_order_item_status", { p_item: otro.item_id, p_status: "cancelled" })).error).toBeNull();
    await llamar(l.mesas[0].token, "bill"); // con pedido
    await llamar(l.mesas[1].token, "bill"); // sin pedido
    await llamar(l.mesas[2].token, "waiter"); // no es la cuenta

    const sala = await loadSala(staff.db, l.id);
    const porMesa = Object.fromEntries(sala.calls.map((c) => [c.tableLabel, c]));
    expect(porMesa["Mesa 1"].account).toEqual({ totalCents: 30000, dishes: 3 });
    expect(porMesa["Mesa 2"]).not.toHaveProperty("account");
    expect(porMesa["Mesa 3"]).not.toHaveProperty("account");
  });

  it("no cuenta pedidos cerrados: tras cerrar el pedido, la cuenta ya no trae total", async () => {
    const l = await nuevoLocal();
    const a = await anotar(owner.db, l, l.branch, l.mesas[0].id);
    await llamar(l.mesas[0].token, "bill");
    expect((await loadSala(owner.db, l.id)).calls[0].account).toEqual({ totalCents: 10000, dishes: 1 });
    expect((await owner.db.rpc("close_order", { p_order: a.order_id })).error).toBeNull();
    expect((await loadSala(owner.db, l.id)).calls[0]).not.toHaveProperty("account");
  });
});
