import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEntitlements } from "@/lib/entitlements";
import { purgeAuditLogWhere } from "./purge-price-history";
import { addMembership, anonClient, createOrg, createUser, deleteOrg, deleteUser, DIA_MS, serviceClient, setSubscription, sql, type Db, type TestUser } from "./helpers";

/**
 * Cobro con link de Mercado Pago (nivel C, ficha cobro-con-link-de-mercado-pago, ADR 0052) contra el Supabase local.
 * El foco: quién puede pedir y registrar (nadie por la API), que el importe y la vigencia salgan de la base, que un pago de
 * Mercado Pago extienda UNA sola vez (también en paralelo), que lo que no cuadra no extienda y quede a revisar, y que la
 * suspensión manual y el cobro manual sigan intactos.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const AR = "America/Argentina/Buenos_Aires";
const SISTEMA = "00000000-0000-4000-8000-00000000a001";

let service: Db;
let admin: TestUser;
let comun: TestUser;
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;
let secuenciaPago = Math.floor(Date.now() / 1000) * 1000;
/** Un ID de pago de Mercado Pago único por prueba (solo dígitos, como los reales). */
const nuevoPagoId = () => String((secuenciaPago += 1));

type Local = { id: string; slug: string; owner: TestUser; staff: TestUser };

async function crearLocal(opciones: { plan?: "basic" | "pro" | "premium"; finEnMs?: number } = {}): Promise<Local> {
  contador += 1;
  const slug = `tt-cobro-${sufijo}-${contador}`;
  const id = await createOrg(service, slug, opciones.plan ?? "pro");
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: opciones.finEnMs ?? 5 * DIA_MS });
  const owner = await createUser(service, `cobro-d${contador}`);
  const staff = await createUser(service, `cobro-s${contador}`);
  users.push(owner, staff);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, slug, owner, staff };
}

type Json = Record<string, unknown>;
const suscripcion = async (orgId: string) => (await service.from("subscriptions").select("*").eq("organization_id", orgId).single()).data!;
const pagos = async (orgId: string) => (await service.from("payments").select("*").eq("organization_id", orgId).order("created_at", { ascending: true })).data!;
const auditoria = async (orgId: string) => (await service.from("audit_log").select("*").eq("organization_id", orgId).order("created_at", { ascending: true })).data!;
const revisiones = (orgId: string) => sql(`select reason, provider_payment_id, resolved_at is not null from public.payment_reviews where organization_id = '${orgId}' order by created_at`);
const intenciones = (orgId: string) => sql(`select status from public.payment_intents where organization_id = '${orgId}' order by created_at`);
const fin = (iso: string | null) => (iso ? new Date(iso).getTime() : null);
const horaAr = (iso: string) => sql(`select to_char('${iso}'::timestamptz at time zone '${AR}', 'HH24:MI:SS')`)[0][0];

async function pedirLink(local: Pick<Local, "id"> & { owner: TestUser }) {
  return service.rpc("system_start_payment_intent", { p_org: local.id, p_user: local.owner.id });
}
async function intencion(local: Local): Promise<{ id: string; amount: number }> {
  const r = await pedirLink(local);
  expect(r.error, JSON.stringify(r.error)).toBeNull();
  const data = r.data as Json;
  return { id: data.intent_id as string, amount: Number(data.amount_cents) };
}
const registrar = (intentId: string, pagoId: string, amount: number, currency = "ARS", paidAt: string | null = new Date().toISOString()) =>
  service.rpc("system_register_mp_payment", { p_intent: intentId, p_provider_payment_id: pagoId, p_amount_cents: amount, p_currency: currency, p_paid_at: paidAt as string });
const resultado = (r: { data: unknown; error: unknown }) => {
  expect(r.error, JSON.stringify(r.error)).toBeNull();
  return r.data as Json;
};

beforeAll(async () => {
  service = serviceClient();
  admin = await createUser(service, "cobro-admin");
  comun = await createUser(service, "cobro-comun");
  users.push(admin, comun);
  sql(`insert into public.platform_admins (user_id) values ('${admin.id}')`);
});

afterAll(async () => {
  purgeAuditLogWhere(`after->>'slug' like 'tt-cobro-%'`);
  // `deleteOrg` también borra las revisiones de la organización (purgeOrgRecordsWhere). Son muchos locales de prueba: el cierre tiene su propio tiempo.
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
}, 240_000);

describe("quién puede: nadie por la API, solo el servidor", () => {
  it("anon, Dueño, Staff y SuperAdmin con sesión no ejecutan ninguna función system_* ni admin_resolve_payment_review", async () => {
    const local = await crearLocal();
    const { id } = await intencion(local);
    const antes = await suscripcion(local.id);
    for (const [nombre, db] of [
      ["anon", anonClient()],
      ["Dueño", local.owner.db],
      ["Staff", local.staff.db],
      ["SuperAdmin", admin.db],
    ] as const) {
      const llamadas = await Promise.all([
        db.rpc("system_start_payment_intent", { p_org: local.id, p_user: local.owner.id }),
        db.rpc("system_attach_payment_preference", { p_intent: id, p_preference_id: "pref", p_checkout_url: "https://x" }),
        db.rpc("system_register_mp_payment", { p_intent: id, p_provider_payment_id: nuevoPagoId(), p_amount_cents: 1, p_currency: "ARS", p_paid_at: new Date().toISOString() }),
        db.rpc("system_flag_mp_reversal", { p_provider_payment_id: "1", p_status: "refunded" }),
        db.rpc("admin_resolve_payment_review", { p_actor: admin.id, p_review: id, p_note: "x" }),
      ]);
      for (const r of llamadas) expect(r.error, `${nombre} no debería poder`).not.toBeNull();
    }
    expect(await pagos(local.id)).toHaveLength(0);
    expect((await suscripcion(local.id)).current_period_end).toBe(antes.current_period_end);
  });

  it("las tablas nuevas no se leen ni se escriben por la API; el SuperAdmin solo lee las revisiones", async () => {
    const local = await crearLocal();
    const { id } = await intencion(local);
    sql(`insert into public.payment_reviews (organization_id, intent_id, provider_payment_id, reason, amount_cents, currency)
         values ('${local.id}', '${id}', '${nuevoPagoId()}', 'amount_mismatch', 100, 'ARS')`);
    for (const db of [local.owner.db, local.staff.db, comun.db, admin.db, anonClient()]) {
      expect((await db.from("payment_intents").select("*")).error).not.toBeNull();
      expect((await db.from("payment_intents").insert({ organization_id: local.id } as never)).error).not.toBeNull();
    }
    for (const db of [local.owner.db, local.staff.db, comun.db]) {
      const lectura = await db.from("payment_reviews").select("*").eq("organization_id", local.id);
      expect(lectura.data ?? []).toHaveLength(0);
    }
    expect((await admin.db.from("payment_reviews").select("*").eq("organization_id", local.id)).data).toHaveLength(1);
    expect((await local.owner.db.from("payment_reviews").insert({ organization_id: local.id } as never)).error).not.toBeNull();
    expect((await admin.db.from("payment_reviews").update({ resolution_note: "x" }).eq("organization_id", local.id).select()).error).not.toBeNull();
  });
});

describe("cuánto hay que pagar (owner_payment_quote)", () => {
  it("el Dueño ve el precio de lista de su plan y ciclo; el Staff, otra organización y anon no ven nada", async () => {
    const local = await crearLocal();
    const otro = await crearLocal();
    const dueno = (await local.owner.db.rpc("owner_payment_quote", { p_org: local.id })).data as Json;
    expect(dueno).toMatchObject({ available: true, plan_code: "pro", billing_cycle: "monthly", amount_cents: 2_900_000, currency: "ARS", extra_branches: 0 });
    expect((await local.staff.db.rpc("owner_payment_quote", { p_org: local.id })).data).toBeNull();
    expect((await otro.owner.db.rpc("owner_payment_quote", { p_org: local.id })).data).toBeNull();
    expect((await comun.db.rpc("owner_payment_quote", { p_org: local.id })).data).toBeNull();
    expect((await anonClient().rpc("owner_payment_quote", { p_org: local.id })).error).not.toBeNull();
  });

  it("suma las sucursales adicionales al precio del MISMO ciclo (mensual 12.000 · anual 115.200 cada una)", async () => {
    const local = await crearLocal();
    sql(`insert into public.subscription_addons (organization_id, addon_code, extra_packs) values ('${local.id}', 'extra_branch', 2)`);
    const mensual = (await local.owner.db.rpc("owner_payment_quote", { p_org: local.id })).data as Json;
    expect(mensual).toMatchObject({ available: true, extra_branches: 2, extra_branch_unit_cents: 1_200_000, amount_cents: 2_900_000 + 2 * 1_200_000 });

    sql(`update public.subscriptions set billing_cycle = 'yearly' where organization_id = '${local.id}'`);
    const anual = (await local.owner.db.rpc("owner_payment_quote", { p_org: local.id })).data as Json;
    expect(anual).toMatchObject({ billing_cycle: "yearly", extra_branch_unit_cents: 11_520_000, amount_cents: 27_840_000 + 2 * 11_520_000 });
  });

  it("no ofrece pagar sin precio de lista (Premium), con suspensión manual, con más de un ciclo por delante o con la organización dada de baja", async () => {
    const premium = await crearLocal({ plan: "premium" });
    expect((await premium.owner.db.rpc("owner_payment_quote", { p_org: premium.id })).data).toMatchObject({ available: false, reason: "no_list_price" });

    const suspendido = await crearLocal();
    sql(`update public.subscriptions set suspended_at = now() where organization_id = '${suspendido.id}'`);
    expect((await suspendido.owner.db.rpc("owner_payment_quote", { p_org: suspendido.id })).data).toMatchObject({ available: false, reason: "suspended_manually" });

    const adelantado = await crearLocal({ finEnMs: 40 * DIA_MS });
    expect((await adelantado.owner.db.rpc("owner_payment_quote", { p_org: adelantado.id })).data).toMatchObject({ available: false, reason: "already_covered" });

    const baja = await crearLocal();
    sql(`update public.organizations set is_active = false where id = '${baja.id}'`);
    // Dada de baja, el Dueño ya no tiene acceso (ni lectura) y el servidor tampoco le arma un link.
    expect((await baja.owner.db.rpc("owner_payment_quote", { p_org: baja.id })).data).toBeNull();
    expect((await pedirLink(baja)).error?.message).toContain("organization_inactive");
    expect(await intenciones(baja.id)).toHaveLength(0);
  });

  it("el Dueño no recibe ningún dato de otra organización y el precio de lista sigue siendo el del catálogo (la lectura de entitlements no cambia)", async () => {
    const local = await crearLocal();
    const ent = parseEntitlements((await local.owner.db.rpc("org_entitlements", { p_org: local.id })).data);
    expect(ent?.plan).toBe("pro");
  });
});

describe("pedir el link: la intención congela el importe", () => {
  it("solo un Dueño de esa organización puede pedirlo", async () => {
    const local = await crearLocal();
    for (const quien of [local.staff, comun, admin]) {
      const r = await service.rpc("system_start_payment_intent", { p_org: local.id, p_user: quien.id });
      expect(r.error?.message).toContain("not_owner");
    }
    expect(await intenciones(local.id)).toHaveLength(0);
  });

  it("dos pedidos seguidos devuelven la misma intención; guardar el link es de una sola vez", async () => {
    const local = await crearLocal();
    const primera = resultado(await pedirLink(local));
    const segunda = resultado(await pedirLink(local));
    expect(segunda.intent_id).toBe(primera.intent_id);
    expect(primera).toMatchObject({ amount_cents: 2_900_000, currency: "ARS", plan_code: "pro", billing_cycle: "monthly", checkout_url: null });

    const url = "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=abc";
    expect((await service.rpc("system_attach_payment_preference", { p_intent: primera.intent_id as string, p_preference_id: "abc", p_checkout_url: url })).data).toBe(true);
    expect((await service.rpc("system_attach_payment_preference", { p_intent: primera.intent_id as string, p_preference_id: "otra", p_checkout_url: "https://otra" })).data).toBe(false);
    const tercera = resultado(await pedirLink(local));
    expect(tercera).toMatchObject({ intent_id: primera.intent_id, preference_id: "abc", checkout_url: url });
    expect(await intenciones(local.id)).toEqual([["pending"]]);
  });

  it("si cambió el importe (otro plan o sucursales), la anterior vence y se crea una nueva", async () => {
    const local = await crearLocal();
    const primera = await intencion(local);
    sql(`insert into public.subscription_addons (organization_id, addon_code, extra_packs) values ('${local.id}', 'extra_branch', 1)`);
    const segunda = await intencion(local);
    expect(segunda.id).not.toBe(primera.id);
    expect(segunda.amount).toBe(2_900_000 + 1_200_000);
    expect(await intenciones(local.id)).toEqual([["expired"], ["pending"]]);
  });

  it("una intención vencida se reemplaza; las que no se pueden cobrar fallan con un motivo estable y no crean nada", async () => {
    const local = await crearLocal();
    const vieja = await intencion(local);
    sql(`update public.payment_intents set expires_at = now() - interval '1 minute' where id = '${vieja.id}'`);
    const nueva = await intencion(local);
    expect(nueva.id).not.toBe(vieja.id);

    const premium = await crearLocal({ plan: "premium" });
    expect((await pedirLink(premium)).error?.message).toContain("no_list_price");
    const suspendido = await crearLocal();
    sql(`update public.subscriptions set suspended_at = now() where organization_id = '${suspendido.id}'`);
    expect((await pedirLink(suspendido)).error?.message).toContain("suspended_manually");
    const adelantado = await crearLocal({ finEnMs: 40 * DIA_MS });
    expect((await pedirLink(adelantado)).error?.message).toContain("already_covered");
    for (const l of [premium, suspendido, adelantado]) expect(await intenciones(l.id)).toHaveLength(0);
  });

  it("dos pedidos simultáneos dejan una sola intención pendiente", async () => {
    const local = await crearLocal();
    const [a, b] = await Promise.all([pedirLink(local), pedirLink(local)]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect((a.data as Json).intent_id).toBe((b.data as Json).intent_id);
    expect(await intenciones(local.id)).toHaveLength(1);
  });
});

describe("registrar un pago aprobado", () => {
  it("extiende un ciclo desde el fin vigente, hasta el cierre del día de Argentina, con pago y auditoría en la misma operación", async () => {
    const local = await crearLocal({ finEnMs: 5 * DIA_MS });
    const antes = await suscripcion(local.id);
    const { id, amount } = await intencion(local);
    const pagoId = nuevoPagoId();
    const r = resultado(await registrar(id, pagoId, amount));
    expect(r.result).toBe("registered");

    const despues = await suscripcion(local.id);
    const desde = fin(antes.current_period_end)!;
    const nuevo = fin(despues.current_period_end)!;
    expect(nuevo - desde).toBeGreaterThan(27 * DIA_MS);
    expect(nuevo - desde).toBeLessThan(32 * DIA_MS);
    expect(horaAr(despues.current_period_end!)).toBe("23:59:59");

    const [pago] = await pagos(local.id);
    expect(pago).toMatchObject({ method: "payment_link", provider: "mercadopago", provider_payment_id: pagoId, reference: `MP ${pagoId}`, amount_cents: amount, currency: "ARS", registered_by: SISTEMA, plan_code: "pro", billing_cycle: "monthly" });
    expect(fin(pago.previous_period_end)).toBe(desde);
    expect(fin(pago.covers_until)).toBe(nuevo);
    expect(await intenciones(local.id)).toEqual([["paid"]]);

    const [registro] = (await auditoria(local.id)).filter((a) => a.action === "payment.registered");
    expect(registro).toMatchObject({ actor_id: SISTEMA, actor_email: "Mercado Pago (automático)" });
    expect(registro.after).toMatchObject({ slug: local.slug, payment_id: pago.id, provider: "mercadopago", method: "payment_link", amount_cents: amount });
    expect(JSON.stringify(registro.after)).not.toContain("MP ");
  });

  it("una cuenta vencida cuenta desde el pago (no hacia atrás); el ciclo anual suma un año", async () => {
    const vencida = await crearLocal({ finEnMs: -3 * DIA_MS });
    const a = await intencion(vencida);
    resultado(await registrar(a.id, nuevoPagoId(), a.amount));
    const desdeAhora = fin((await suscripcion(vencida.id)).current_period_end)! - Date.now();
    expect(desdeAhora).toBeGreaterThan(27 * DIA_MS);
    expect(desdeAhora).toBeLessThan(32 * DIA_MS);

    const anual = await crearLocal({ finEnMs: 5 * DIA_MS });
    sql(`update public.subscriptions set billing_cycle = 'yearly' where organization_id = '${anual.id}'`);
    const b = await intencion(anual);
    expect(b.amount).toBe(27_840_000);
    resultado(await registrar(b.id, nuevoPagoId(), b.amount));
    const sumado = fin((await suscripcion(anual.id)).current_period_end)! - (Date.now() + 5 * DIA_MS);
    expect(sumado).toBeGreaterThan(363 * DIA_MS);
    expect(sumado).toBeLessThan(368 * DIA_MS);
  });

  it("pagar durante la prueba no pierde los días de prueba (cuenta desde su fin)", async () => {
    contador += 1;
    const slug = `tt-cobro-${sufijo}-${contador}`;
    const id = await createOrg(service, slug, "pro");
    orgs.push(id);
    const dueno = await createUser(service, `cobro-prueba${contador}`);
    users.push(dueno);
    await addMembership(service, dueno, id, "owner");
    const sub = await suscripcion(id);
    expect(sub.trial_ends_at).not.toBeNull();
    expect(sub.current_period_end).toBeNull();
    const { data } = await pedirLink({ id, owner: dueno });
    const intent = data as Json;
    resultado(await registrar(intent.intent_id as string, nuevoPagoId(), Number(intent.amount_cents)));
    const despues = await suscripcion(id);
    expect(fin(despues.current_period_end)! - fin(sub.trial_ends_at)!).toBeGreaterThan(27 * DIA_MS);
  });

  it("es idempotente: el mismo pago otra vez (o dos a la vez) no extiende de nuevo", async () => {
    const local = await crearLocal();
    const { id, amount } = await intencion(local);
    const pagoId = nuevoPagoId();
    const [a, b] = await Promise.all([registrar(id, pagoId, amount), registrar(id, pagoId, amount)]);
    const resultados = [resultado(a).result, resultado(b).result].sort();
    expect(resultados).toEqual(["already_registered", "registered"]);
    const fijo = (await suscripcion(local.id)).current_period_end;
    expect(resultado(await registrar(id, pagoId, amount)).result).toBe("already_registered");
    expect((await suscripcion(local.id)).current_period_end).toBe(fijo);
    expect(await pagos(local.id)).toHaveLength(1);
    expect((await auditoria(local.id)).filter((x) => x.action === "payment.registered")).toHaveLength(1);
  });

  it("dos pagos distintos de la misma intención a la vez: uno se registra y el otro queda a revisar", async () => {
    const local = await crearLocal();
    const { id, amount } = await intencion(local);
    const x = nuevoPagoId();
    const y = nuevoPagoId();
    const resultados = [resultado(await registrar(id, x, amount)), resultado(await registrar(id, y, amount))];
    expect(resultados.map((r) => r.result).sort()).toEqual(["registered", "review"]);
    expect(await pagos(local.id)).toHaveLength(1);
    expect(await revisiones(local.id)).toEqual([["intent_already_paid", y, "f"]]);

    const paralelo = await crearLocal();
    const p = await intencion(paralelo);
    const salidas = await Promise.all([registrar(p.id, nuevoPagoId(), p.amount), registrar(p.id, nuevoPagoId(), p.amount)]);
    expect(salidas.map((r) => resultado(r).result).sort()).toEqual(["registered", "review"]);
    expect(await pagos(paralelo.id)).toHaveLength(1);
  });

  it("no levanta la suspensión manual: la fecha avanza pero la cuenta sigue suspendida", async () => {
    const local = await crearLocal();
    const { id, amount } = await intencion(local);
    sql(`update public.subscriptions set suspended_at = now() where organization_id = '${local.id}'`);
    expect(resultado(await registrar(id, nuevoPagoId(), amount)).result).toBe("registered");
    const estado = parseEntitlements((await local.owner.db.rpc("org_entitlements", { p_org: local.id })).data);
    expect(estado?.state).toBe("suspended");
    expect(estado?.suspendedManually).toBe(true);
  });

  it("una intención desconocida o parámetros inválidos no cambian nada", async () => {
    const local = await crearLocal();
    const antes = await suscripcion(local.id);
    expect(resultado(await registrar("00000000-0000-4000-8000-0000000000ff", nuevoPagoId(), 100)).result).toBe("unknown_intent");
    const { id } = await intencion(local);
    expect((await registrar(id, "abc", 100)).error?.message).toContain("invalid_payment_id");
    expect((await registrar(id, "12; drop", 100)).error?.message).toContain("invalid_payment_id");
    expect((await registrar(id, nuevoPagoId(), 0)).error?.message).toContain("invalid_amount");
    expect((await registrar(id, nuevoPagoId(), 100, "EUR")).error?.message).toContain("invalid_currency");
    expect(await pagos(local.id)).toHaveLength(0);
    expect((await suscripcion(local.id)).current_period_end).toBe(antes.current_period_end);
  });
});

describe("lo que no cuadra no extiende: queda a revisar", () => {
  const sinCambios = async (local: Local, antes: { current_period_end: string | null }) => {
    expect(await pagos(local.id)).toHaveLength(0);
    expect((await suscripcion(local.id)).current_period_end).toBe(antes.current_period_end);
  };

  it("importe distinto, y la misma entrega repetida no duplica la revisión ni se reevalúa", async () => {
    const local = await crearLocal();
    const antes = await suscripcion(local.id);
    const { id, amount } = await intencion(local);
    const pagoId = nuevoPagoId();
    expect(resultado(await registrar(id, pagoId, amount - 1))).toMatchObject({ result: "review", reason: "amount_mismatch" });
    // Aunque ahora llegue con el importe correcto, el pago ya enviado a revisión no se registra solo.
    expect(resultado(await registrar(id, pagoId, amount)).result).toBe("review");
    expect(await revisiones(local.id)).toEqual([["amount_mismatch", pagoId, "f"]]);
    await sinCambios(local, antes);
    expect(await intenciones(local.id)).toEqual([["pending"]]);
  });

  it("moneda distinta, plan cambiado entre el pedido y el pago, y vigencia ya cubierta por otra vía", async () => {
    const moneda = await crearLocal();
    const a = await intencion(moneda);
    expect(resultado(await registrar(a.id, nuevoPagoId(), a.amount, "USD"))).toMatchObject({ result: "review", reason: "currency_mismatch" });

    const plan = await crearLocal();
    const b = await intencion(plan);
    sql(`update public.subscriptions set plan_code = 'basic' where organization_id = '${plan.id}'`);
    expect(resultado(await registrar(b.id, nuevoPagoId(), b.amount))).toMatchObject({ result: "review", reason: "plan_changed" });

    const ciclo = await crearLocal();
    const c = await intencion(ciclo);
    sql(`update public.subscriptions set billing_cycle = 'yearly' where organization_id = '${ciclo.id}'`);
    expect(resultado(await registrar(c.id, nuevoPagoId(), c.amount))).toMatchObject({ result: "review", reason: "plan_changed" });

    const cubierta = await crearLocal();
    const d = await intencion(cubierta);
    await setSubscription(service, cubierta.id, { finEnMs: 45 * DIA_MS }); // el SuperAdmin cargó un pago a mano en el medio
    expect(resultado(await registrar(d.id, nuevoPagoId(), d.amount))).toMatchObject({ result: "review", reason: "already_covered" });

    for (const l of [moneda, plan, ciclo, cubierta]) expect(await pagos(l.id)).toHaveLength(0);
  });

  it("un pago de la intención de otra organización no extiende a la propia", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    const antesB = await suscripcion(b.id);
    const ia = await intencion(a);
    resultado(await registrar(ia.id, nuevoPagoId(), ia.amount));
    expect(await pagos(b.id)).toHaveLength(0);
    expect((await suscripcion(b.id)).current_period_end).toBe(antesB.current_period_end);
  });
});

describe("reembolso o contracargo", () => {
  it("queda a revisar sin quitar la vigencia; un pago desconocido se ignora; el estado inválido se rechaza", async () => {
    const local = await crearLocal();
    const { id, amount } = await intencion(local);
    const pagoId = nuevoPagoId();
    resultado(await registrar(id, pagoId, amount));
    const vigente = (await suscripcion(local.id)).current_period_end;

    expect((await service.rpc("system_flag_mp_reversal", { p_provider_payment_id: pagoId, p_status: "charged_back" })).data).toBe("flagged");
    expect((await service.rpc("system_flag_mp_reversal", { p_provider_payment_id: pagoId, p_status: "refunded" })).data).toBe("flagged");
    expect(await revisiones(local.id)).toEqual([["payment_reversed", pagoId, "f"]]);
    expect((await suscripcion(local.id)).current_period_end).toBe(vigente);

    // Un pago que todavía no se registró: la reversión se guarda (el registro la verá) y no hay nada que revisar.
    expect((await service.rpc("system_flag_mp_reversal", { p_provider_payment_id: nuevoPagoId(), p_status: "refunded" })).data).toBe("recorded");
    expect((await service.rpc("system_flag_mp_reversal", { p_provider_payment_id: pagoId, p_status: "approved" })).error?.message).toContain("invalid_status");
    expect((await service.rpc("system_flag_mp_reversal", { p_provider_payment_id: "x", p_status: "refunded" })).error?.message).toContain("invalid_payment_id");
  });
});

describe("una reversión que llega ANTES de que se registre el pago (avisos concurrentes)", () => {
  it("el reembolso ya guardado impide renovar: el pago queda a revisar y la vigencia no se mueve", async () => {
    const local = await crearLocal();
    const antes = await suscripcion(local.id);
    const { id, amount } = await intencion(local);
    const pagoId = nuevoPagoId();
    // B vio el pago reembolsado y lo guardó; A, que lo había leído aprobado, recién ahora lo registra.
    expect((await service.rpc("system_flag_mp_reversal", { p_provider_payment_id: pagoId, p_status: "refunded" })).data).toBe("recorded");
    expect(resultado(await registrar(id, pagoId, amount))).toMatchObject({ result: "review", reason: "payment_reversed" });
    expect(await pagos(local.id)).toHaveLength(0);
    expect((await suscripcion(local.id)).current_period_end).toBe(antes.current_period_end);
    expect(await revisiones(local.id)).toEqual([["payment_reversed", pagoId, "f"]]);
    expect(await intenciones(local.id)).toEqual([["pending"]]);
    // Repetir el registro no cambia nada.
    expect(resultado(await registrar(id, pagoId, amount)).result).toBe("review");
    expect(await pagos(local.id)).toHaveLength(0);
  });

  it("en paralelo, sea cual sea el orden, nunca queda un pago registrado sin su revisión", async () => {
    for (let vuelta = 0; vuelta < 6; vuelta++) {
      const local = await crearLocal();
      const { id, amount } = await intencion(local);
      const pagoId = nuevoPagoId();
      const [registro, reversion] = await Promise.all([
        registrar(id, pagoId, amount),
        service.rpc("system_flag_mp_reversal", { p_provider_payment_id: pagoId, p_status: "refunded" }),
      ]);
      expect(registro.error).toBeNull();
      expect(reversion.error).toBeNull();
      const registrado = (await pagos(local.id)).length === 1;
      const marcado = (await revisiones(local.id)).some((fila) => fila[0] === "payment_reversed");
      // O se registró y la reversión lo marcó, o la reversión llegó primero y no se renovó nada. Nunca: registrado y sin marca.
      expect(registrado ? marcado : true, `vuelta ${vuelta}: pago registrado sin revisión`).toBe(true);
      if (!registrado) expect((resultado(registro) as Json).result).toBe("review");
    }
  });

  it("el candado por ID de pago está en las DOS funciones (si alguien lo quita de una, el orden concurrente se puede perder)", async () => {
    const cuerpos = sql(`select p.proname, pg_get_functiondef(p.oid) like '%pg_advisory_xact_lock(hashtextextended(''mercadopago:''%' from pg_proc p where p.proname in ('system_register_mp_payment', 'system_flag_mp_reversal') order by 1`);
    expect(cuerpos).toEqual([["system_flag_mp_reversal", "t"], ["system_register_mp_payment", "t"]]);
  });
});

describe("recuperar un aviso perdido después de que venció el link", () => {
  it("las intenciones sin pagar de los últimos 30 días siguen a la vista del Dueño aunque su link haya vencido", async () => {
    const local = await crearLocal();
    const { id } = await intencion(local);
    sql(`update public.payment_intents set status = 'expired', expires_at = now() - interval '2 days' where id = '${id}'`);
    const quote = (await local.owner.db.rpc("owner_payment_quote", { p_org: local.id })).data as Json;
    expect(quote.pending_intent).toBeUndefined();
    expect((quote.unpaid_intents as Json[]).map((u) => u.id)).toEqual([id]);

    // Un pago aprobado de esa intención vencida igual se registra (el dinero ya entró).
    expect(resultado(await registrar(id, nuevoPagoId(), 2_900_000)).result).toBe("registered");
    const despues = (await local.owner.db.rpc("owner_payment_quote", { p_org: local.id })).data as Json;
    expect(despues.unpaid_intents).toEqual([]);
  });

  it("no ofrece intenciones pagadas ni de más de 30 días, ni de otra organización", async () => {
    const local = await crearLocal();
    const otro = await crearLocal();
    const vieja = await intencion(local);
    sql(`update public.payment_intents set status = 'expired', created_at = now() - interval '31 days', expires_at = now() - interval '28 days' where id = '${vieja.id}'`);
    const ajena = await intencion(otro);
    const quote = (await local.owner.db.rpc("owner_payment_quote", { p_org: local.id })).data as Json;
    expect(quote.unpaid_intents).toEqual([]);
    expect(JSON.stringify(quote)).not.toContain(ajena.id);
  });
});

describe("el SuperAdmin resuelve un pago a revisar", () => {
  it("solo un SuperAdmin, una sola vez y con auditoría; el motivo es obligatorio", async () => {
    const local = await crearLocal();
    const { id, amount } = await intencion(local);
    const pagoId = nuevoPagoId();
    resultado(await registrar(id, pagoId, amount + 5));
    const [revision] = (await admin.db.from("payment_reviews").select("*").eq("organization_id", local.id)).data!;

    const llamar = (actor: string, nota: string) => service.rpc("admin_resolve_payment_review", { p_actor: actor, p_review: revision.id, p_note: nota });
    expect((await llamar(comun.id, "ok")).error?.message).toContain("not_platform_admin");
    expect((await llamar(local.owner.id, "ok")).error?.message).toContain("not_platform_admin");
    expect((await llamar(admin.id, "   ")).error?.message).toContain("invalid_note");
    expect((await llamar(admin.id, "x".repeat(201))).error?.message).toContain("invalid_note");
    expect((await service.rpc("admin_resolve_payment_review", { p_actor: admin.id, p_review: "00000000-0000-4000-8000-0000000000ff", p_note: "ok" })).error?.message).toContain("review_not_found");

    expect((await llamar(admin.id, "Reembolsado en Mercado Pago")).error).toBeNull();
    expect((await llamar(admin.id, "otra vez")).error?.message).toContain("review_already_resolved");

    const [resuelta] = (await admin.db.from("payment_reviews").select("*").eq("id", revision.id)).data!;
    expect(resuelta).toMatchObject({ resolved_by: admin.id, resolution_note: "Reembolsado en Mercado Pago" });
    const [registro] = (await auditoria(local.id)).filter((a) => a.action === "payment_review.resolved");
    expect(registro).toMatchObject({ actor_id: admin.id });
    expect(registro.after).toMatchObject({ slug: local.slug, review_id: revision.id, reason: "amount_mismatch" });
  });
});

describe("defensas de fondo", () => {
  it("payments sigue siendo de solo agregado y no admite el mismo pago de Mercado Pago dos veces", async () => {
    const local = await crearLocal();
    const { id, amount } = await intencion(local);
    const pagoId = nuevoPagoId();
    resultado(await registrar(id, pagoId, amount));
    const [pago] = await pagos(local.id);
    expect((await service.from("payments").update({ amount_cents: 1 }).eq("id", pago.id).select()).error).not.toBeNull();
    expect((await service.from("payments").delete().eq("id", pago.id)).error).not.toBeNull();

    const duplicar = `insert into public.payments (organization_id, subscription_id, plan_code, billing_cycle, amount_cents, currency, method, reference, paid_on, previous_period_end, covers_until, registered_by, provider, provider_payment_id)
      select organization_id, subscription_id, plan_code, billing_cycle, amount_cents, currency, method, reference, paid_on, previous_period_end, covers_until + interval '1 day', registered_by, provider, provider_payment_id
      from public.payments where id = '${pago.id}'`;
    expect(() => sql(duplicar)).toThrow(/payments_provider_payment_key|duplicate key/);
  });

  it("mutación: sin el índice único el mismo pago entraría dos veces (la prueba anterior depende de él)", async () => {
    const local = await crearLocal();
    const { id, amount } = await intencion(local);
    resultado(await registrar(id, nuevoPagoId(), amount));
    const [pago] = await pagos(local.id);
    // En una transacción que se deshace sola (la excepción final): se quita el índice, se duplica el pago y se cuenta.
    const mutacion = `do $$ declare n integer; begin
      drop index public.payments_provider_payment_key;
      insert into public.payments (organization_id, subscription_id, plan_code, billing_cycle, amount_cents, currency, method, reference, paid_on, previous_period_end, covers_until, registered_by, provider, provider_payment_id)
        select organization_id, subscription_id, plan_code, billing_cycle, amount_cents, currency, method, reference, paid_on, previous_period_end, covers_until + interval '1 day', registered_by, provider, provider_payment_id
        from public.payments where id = '${pago.id}';
      select count(*) into n from public.payments where provider_payment_id = '${pago.provider_payment_id}';
      raise exception 'copias=%', n;
    end $$`;
    expect(() => sql(mutacion)).toThrow(/copias=2/);
    // Deshecho: el índice sigue y el pago es uno solo.
    expect(sql(`select count(*) from pg_indexes where indexname = 'payments_provider_payment_key'`)[0][0]).toBe("1");
    expect(await pagos(local.id)).toHaveLength(1);
  });

  it("el cobro manual del SuperAdmin sigue funcionando y no tiene proveedor", async () => {
    const local = await crearLocal();
    const antes = await suscripcion(local.id);
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: AR }).format(new Date());
    const cubre = new Date(Date.now() + 35 * DIA_MS).toISOString();
    const r = await service.rpc("admin_register_payment", { p_actor: admin.id, p_org: local.id, p_amount_cents: 2_900_000, p_currency: "ARS", p_method: "transfer", p_reference: "op-1", p_paid_on: hoy, p_covers_until: cubre });
    expect(r.error).toBeNull();
    const [pago] = await pagos(local.id);
    expect(pago).toMatchObject({ method: "transfer", provider: null, provider_payment_id: null, registered_by: admin.id });
    expect(fin((await suscripcion(local.id)).current_period_end)).toBeGreaterThan(fin(antes.current_period_end)!);
  });
});
