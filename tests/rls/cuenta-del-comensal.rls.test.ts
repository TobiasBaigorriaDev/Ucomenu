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
 * Cuenta del comensal (nivel C, ficha cuenta-del-comensal, ADR 0044) contra el Supabase local: la única lectura de pedidos para un
 * anónimo. Solo con ticket del turno y un «Pedir la cuenta» dentro del turno; solo lo que ve el comensal; solo `service_role`.
 */

let service: Db;
let owner: TestUser;
let stranger: TestUser;
const orgs: string[] = [];
let contador = 0;
const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

type Local = { id: string; branch: string; table: string; token: string; product: string; flan: string; option: string };

async function nuevoLocal(plan: PlanCode = "pro"): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-cuenta-${sufijo}-${contador}`, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const b = await service.from("branches").insert({ organization_id: id, slug: "principal", name: "Principal" }).select("id").single();
  if (b.error) throw new Error(`sucursal: ${b.error.message}`);
  const mesa = await service.from("tables").insert({ organization_id: id, branch_id: b.data.id, label: "Mesa 7" }).select("id, qr_token").single();
  if (mesa.error) throw new Error(`mesa: ${mesa.error.message}`);
  const category = await createCategory(service, id, "Platos");
  const p = await service.from("products").insert({ organization_id: id, category_id: category, name: "Bife", price_cents: 10000 }).select("id").single();
  const f = await service.from("products").insert({ organization_id: id, category_id: category, name: "Flan", price_cents: 3000 }).select("id").single();
  if (p.error || f.error) throw new Error("platos");
  const g = await service.from("option_groups").insert({ organization_id: id, product_id: p.data.id, name: "Extras", min_choices: 0, max_choices: 2 }).select("id").single();
  if (g.error) throw new Error(`grupo: ${g.error.message}`);
  const o = await service.from("options").insert({ organization_id: id, group_id: g.data.id, name: "Bacon", price_delta_cents: 1500, sort_order: 0 }).select("id").single();
  if (o.error) throw new Error(`opción: ${o.error.message}`);
  await addMembership(service, owner, id, "owner");
  return { id, branch: b.data.id, table: mesa.data.id, token: mesa.data.qr_token, product: p.data.id, flan: f.data.id, option: o.data.id };
}

type Resp = { data: unknown; error: { message: string } | null };
const ok = <T,>(r: Resp): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

const anotar = (l: Local, product: string, quantity: number, extra: Record<string, unknown> = {}) =>
  owner.db.rpc("add_order_item", { p_branch: l.branch, p_table: l.table, p_product: product, p_quantity: quantity, p_client_key: randomUUID(), ...extra } as never);
const pedirCuenta = (l: Local) => service.rpc("create_waiter_call", { p_token: l.token, p_kind: "bill" } as never);
const cuenta = (token: string, ticketAt: string | null) => service.rpc("get_table_account", { p_token: token, p_ticket_at: ticketAt } as never);
const ahora = () => sql("select clock_timestamp()::text")[0][0].replace(" ", "T").replace(/\+00$/, "Z");
const pausa = () => new Promise((r) => setTimeout(r, 15));

/** Pasan los minutos del cooldown (60 s) entre el llamado anterior y el de la mesa nueva: se atrasa su hora. */
const atrasarLlamados = (l: Local) => sql(`update public.waiter_calls set created_at = created_at - interval '5 minutes' where table_id = '${l.table}'`);

/** Un local con un pedido (2 bifes con bacon y nota, 1 flan y un flan cancelado) y la cuenta pedida. */
async function conCuentaPedida() {
  const l = await nuevoLocal();
  const a = ok<{ order_id: string; item_id: string }>(await anotar(l, l.product, 2, { p_options: [l.option], p_note: "sin sal, alérgico a la nuez" }));
  ok(await anotar(l, l.flan, 1));
  const c = ok<{ item_id: string }>(await anotar(l, l.flan, 5));
  ok(await owner.db.rpc("set_order_item_status", { p_item: c.item_id, p_status: "cancelled", p_reason: "se arrepintió" } as never));
  expect(ok<{ status: string }>(await pedirCuenta(l)).status).toBe("created");
  await pausa();
  return { l, order: a.order_id };
}

beforeAll(async () => {
  service = serviceClient();
  [owner, stranger] = await Promise.all([createUser(service, "cuenta-owner"), createUser(service, "cuenta-ajeno")]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, stranger].map((u) => deleteUser(service, u)));
});

describe("lo que ve el comensal", () => {
  it("platos vigentes con opciones, importes copiados y total; sin lo cancelado, sin observaciones y sin ids", async () => {
    const { l } = await conCuentaPedida();
    const r = ok<Record<string, unknown>>(await cuenta(l.token, ahora()));
    expect(r.status).toBe("ok");
    // 2 × (100 + 15) + 30 = 260; el flan cancelado (5 × 30) no suma ni sale.
    expect(r.total_cents).toBe(26000);
    expect(r.dishes).toBe(3);
    expect(r.lines).toEqual([
      { quantity: 2, name: "Bife", options: ["Bacon"], unit_cents: 11500, line_cents: 23000 },
      { quantity: 1, name: "Flan", options: [], unit_cents: 3000, line_cents: 3000 },
    ]);
    expect(r).toMatchObject({ org_name: expect.any(String), branch_name: "Principal", table_label: "Mesa 7", time_zone: expect.any(String) });
    // Lista blanca de claves: nada más que esto sale al anónimo.
    expect(Object.keys(r).sort()).toEqual(["as_of", "branch_name", "dishes", "lines", "org_name", "status", "table_label", "time_zone", "total_cents"]);
    const texto = JSON.stringify(r);
    for (const prohibido of ["sin sal", "alérgico", "arrepintió", l.id, l.table, l.token, l.product, owner.id]) expect(texto).not.toContain(prohibido);
  });

  it("los importes son los copiados al anotar: cambiar el precio del plato después no mueve la cuenta", async () => {
    const { l } = await conCuentaPedida();
    expect((await service.from("products").update({ price_cents: 99999 }).eq("id", l.product)).error).toBeNull();
    expect(ok<{ total_cents: number }>(await cuenta(l.token, ahora())).total_cents).toBe(26000);
  });

  it("con la cuenta pedida pero sin pedido abierto: 'empty', sin datos", async () => {
    const l = await nuevoLocal();
    ok(await pedirCuenta(l));
    await pausa();
    expect(ok(await cuenta(l.token, ahora()))).toEqual({ status: "empty" });
  });
});

describe("cuándo NO devuelve datos", () => {
  it("sin 'Pedir la cuenta' en el turno: 'unavailable', aunque haya pedido y ticket vigente", async () => {
    const l = await nuevoLocal();
    ok(await anotar(l, l.product, 1));
    await pausa();
    expect(ok(await cuenta(l.token, ahora()))).toEqual({ status: "unavailable" });
    // «Llamar al mozo» no es pedir la cuenta.
    ok(await service.rpc("create_waiter_call", { p_token: l.token, p_kind: "waiter" } as never));
    await pausa();
    expect(ok(await cuenta(l.token, ahora()))).toEqual({ status: "unavailable" });
  });

  it("un ticket anterior al turno ya no ve la cuenta del turno nuevo, aunque haya pedido abierto y cuenta pedida en él; uno posterior sí", async () => {
    const { l, order } = await conCuentaPedida();
    const viejo = ahora();
    await pausa();
    ok(await owner.db.rpc("close_order", { p_order: order } as never));
    atrasarLlamados(l);
    // Turno nuevo: otro pedido y se pide la cuenta DENTRO del turno.
    ok(await anotar(l, l.flan, 2));
    expect(ok<{ status: string }>(await pedirCuenta(l)).status).toBe("created");
    await pausa();
    // El ticket de antes del cobro no ve el consumo nuevo; el de ahora sí. Solo `ticket_in_turn` los distingue.
    expect(ok(await cuenta(l.token, viejo))).toEqual({ status: "unavailable" });
    expect(ok<{ status: string; total_cents: number }>(await cuenta(l.token, ahora()))).toMatchObject({ status: "ok", total_cents: 6000 });
  });

  it("reiniciar el turno a mano también corta el ticket anterior, con cuenta pedida en el turno nuevo", async () => {
    const { l } = await conCuentaPedida();
    const viejo = ahora();
    await pausa();
    ok(await owner.db.rpc("reset_table_turn", { p_table: l.table } as never));
    atrasarLlamados(l);
    expect(ok<{ status: string }>(await pedirCuenta(l)).status).toBe("created");
    await pausa();
    expect(ok(await cuenta(l.token, viejo))).toEqual({ status: "unavailable" });
    expect(ok<{ status: string }>(await cuenta(l.token, ahora())).status).toBe("ok");
  });

  it("el pedido de cuenta que quedó sin atender del turno anterior no tapa el de la mesa nueva (hallazgo de la revisión, ronda 1)", async () => {
    const { l, order } = await conCuentaPedida();
    // El mozo cobra sin marcar «Atendido»: el llamado quedó pendiente.
    ok(await owner.db.rpc("close_order", { p_order: order } as never));
    atrasarLlamados(l);
    ok(await anotar(l, l.flan, 1));
    const nuevo = ok<{ status: string }>(await pedirCuenta(l));
    expect(nuevo.status).toBe("created");
    await pausa();
    expect(ok<{ status: string }>(await cuenta(l.token, ahora())).status).toBe("ok");
  });

  it("al cerrar o anular el pedido el turno rota y el ticket anterior queda sin cuenta", async () => {
    const { l, order } = await conCuentaPedida();
    const ticket = ahora();
    expect(ok<{ status: string }>(await cuenta(l.token, ticket)).status).toBe("ok");
    await pausa();
    ok(await owner.db.rpc("close_order", { p_order: order } as never));
    await pausa();
    expect(ok(await cuenta(l.token, ticket))).toEqual({ status: "unavailable" });
    expect(ok(await cuenta(l.token, ahora()))).toEqual({ status: "unavailable" });

    const otra = await conCuentaPedida();
    const t2 = ahora();
    await pausa();
    ok(await owner.db.rpc("void_order", { p_order: otra.order, p_reason: "error" } as never));
    await pausa();
    expect(ok(await cuenta(otra.l.token, t2))).toEqual({ status: "unavailable" });
  });

  it("token desconocido, malformado, nulo o sin ticket: 'not_found'", async () => {
    const { l } = await conCuentaPedida();
    const t = ahora();
    for (const token of ["0".repeat(32), "no-es-un-token", "", l.token.toUpperCase(), `${l.token}0`]) {
      expect(ok(await cuenta(token, t)), token).toEqual({ status: "not_found" });
    }
    expect(ok(await service.rpc("get_table_account", { p_token: null, p_ticket_at: t } as never))).toEqual({ status: "not_found" });
    expect(ok(await cuenta(l.token, null))).toEqual({ status: "not_found" });
  });

  it("mesa inactiva, sucursal inactiva, organización inactiva o sin la función de llamado: 'not_found'", async () => {
    const mesa = await conCuentaPedida();
    expect((await service.from("tables").update({ is_active: false }).eq("id", mesa.l.table)).error).toBeNull();
    expect(ok(await cuenta(mesa.l.token, ahora()))).toEqual({ status: "not_found" });

    const sucursal = await conCuentaPedida();
    // Otra sucursal activa para poder desactivar la primera.
    expect((await service.from("branches").insert({ organization_id: sucursal.l.id, slug: "otra", name: "Otra" })).error).toBeNull();
    sql(`update public.branches set is_active = false where id = '${sucursal.l.branch}'`);
    expect(ok(await cuenta(sucursal.l.token, ahora()))).toEqual({ status: "not_found" });

    const org = await conCuentaPedida();
    expect((await service.from("organizations").update({ is_active: false }).eq("id", org.l.id)).error).toBeNull();
    expect(ok(await cuenta(org.l.token, ahora()))).toEqual({ status: "not_found" });

    const plan = await conCuentaPedida();
    await setSubscription(service, plan.l.id, { plan: "basic" });
    expect(ok(await cuenta(plan.l.token, ahora()))).toEqual({ status: "not_found" });
  });
});

describe("permisos", () => {
  it("ni anon ni un usuario autenticado pueden ejecutarla; solo service_role", async () => {
    const { l } = await conCuentaPedida();
    const t = ahora();
    for (const db of [anonClient(), owner.db, stranger.db]) {
      const r = await db.rpc("get_table_account", { p_token: l.token, p_ticket_at: t } as never);
      expect(r.error).not.toBeNull();
      expect(JSON.stringify(r.data ?? null)).not.toContain("Bife");
    }
  });

  it("anon sigue sin poder leer pedidos, líneas ni opciones", async () => {
    const { l, order } = await conCuentaPedida();
    const anon = anonClient();
    for (const tabla of ["orders", "order_items", "order_item_options"] as const) {
      const r = await anon.from(tabla).select("*").limit(5);
      expect(r.error !== null || (r.data ?? []).length === 0, tabla).toBe(true);
    }
    expect((await anon.from("orders").select("id").eq("id", order)).data ?? []).toEqual([]);
    expect(l.id).toBeTruthy();
  });
});
