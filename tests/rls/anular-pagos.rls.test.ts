import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminContext } from "@/lib/admin/organizations";
import { getOrganizationDetail, isVoidable, registerPayment, setSuspension, voidPayment } from "@/lib/admin/subscriptions";
import { parsePeriodEnd } from "@/lib/admin/validation";
import { parseEntitlements } from "@/lib/entitlements";
import { purgeAuditLogWhere } from "./purge-price-history";
import {
  addMembership,
  anonClient,
  createOrg,
  createUser,
  deleteOrg,
  deleteUser,
  DIA_MS,
  serviceClient,
  setSubscription,
  sql,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * SuperAdmin anula un pago mal cargado (nivel C, ficha anular-pagos) contra el Supabase local, con los mismos clientes
 * que usa el servidor. El foco: quién puede, que la vigencia vuelva exactamente a la de antes, que solo se anule el último
 * pago vigente, que nada se reescriba y que el Dueño vea el efecto sin ver el motivo ni al autor.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const enDias = (dias: number) => new Date(Date.now() + dias * DIA_MS).toISOString().slice(0, 10);
const hoyAr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
const finDelDia = (dia: string) => new Date(parsePeriodEnd(dia, new Date())!).getTime();

let service: Db;
let admin: TestUser;
let otroAdmin: TestUser;
let comun: TestUser;
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

const ctx = (user: TestUser): AdminContext => ({ session: user.db, admin: service, actorId: user.id });
const contar = (tabla: string, donde = "true") => Number(sql(`select count(*) from public.${tabla} where ${donde}`)[0][0]);

type Local = { id: string; slug: string; owner: TestUser; staff: TestUser };

/** Una organización propia con Dueño y Staff, con un período propio que vence en `finEnMs` (sin prueba). */
async function crearLocal(finEnMs = -2 * DIA_MS): Promise<Local> {
  contador += 1;
  const slug = `tt-anula-${sufijo}-${contador}`;
  const id = await createOrg(service, slug, "pro");
  orgs.push(id);
  await setSubscription(service, id, { finEnMs });
  const owner = await createUser(service, `anula-d${contador}`);
  const staff = await createUser(service, `anula-s${contador}`);
  users.push(owner, staff);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, slug, owner, staff };
}

const suscripcion = async (orgId: string) => (await service.from("subscriptions").select("*").eq("organization_id", orgId).single()).data!;
const auditoria = async (orgId: string) =>
  (await service.from("audit_log").select("*").eq("organization_id", orgId).order("created_at", { ascending: true })).data!;
const pagos = async (orgId: string) =>
  (await service.from("payments").select("*").eq("organization_id", orgId).order("created_at", { ascending: true })).data!;
const anulaciones = async (orgId: string) => (await service.from("payment_voids").select("*").eq("organization_id", orgId)).data!;
const fin = (iso: string | null) => (iso ? new Date(iso).getTime() : null);

async function entitlements(user: TestUser, orgId: string) {
  const { data, error } = await user.db.rpc("org_entitlements", { p_org: orgId });
  expect(error).toBeNull();
  return parseEntitlements(data)!;
}

const pago = (local: Pick<Local, "slug">, cambios: Partial<Parameters<typeof registerPayment>[1]> = {}) => ({
  slug: local.slug,
  amount: "20000",
  currency: "ARS",
  method: "transfer",
  reference: "op-77",
  paidOn: hoyAr(),
  coversUntil: enDias(30),
  ...cambios,
});

/** Registra un pago y devuelve su id. */
async function cargar(local: Pick<Local, "id" | "slug">, cambios: Partial<Parameters<typeof registerPayment>[1]> = {}) {
  const r = await registerPayment(ctx(admin), pago(local, cambios));
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (!r.ok) throw new Error("no se pudo registrar el pago");
  return r.data.paymentId;
}

const anular = (local: Pick<Local, "slug">, paymentId: string, reason: unknown = "Se cargó mal", quien: TestUser = admin) =>
  voidPayment(ctx(quien), { slug: local.slug, paymentId, reason });

beforeAll(async () => {
  service = serviceClient();
  admin = await createUser(service, "anula-admin");
  otroAdmin = await createUser(service, "anula-otro-admin");
  comun = await createUser(service, "anula-comun");
  users.push(admin, otroAdmin, comun);
  sql(`insert into public.platform_admins (user_id) values ('${admin.id}'), ('${otroAdmin.id}')`);
});

afterAll(async () => {
  purgeAuditLogWhere(`after->>'slug' like 'tt-anula-%'`);
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("quién puede: solo SuperAdmin, solo por el servidor", () => {
  it("ninguna sesión (ni la de un SuperAdmin) ni anon pueden llamar la función por la API", async () => {
    const local = await crearLocal();
    const id = await cargar(local);
    const antes = await suscripcion(local.id);
    for (const [nombre, db, actor] of [
      ["SuperAdmin con sesión", admin.db, admin.id],
      ["Dueño", local.owner.db, local.owner.id],
      ["Staff", local.staff.db, local.staff.id],
      ["anon", anonClient(), admin.id],
    ] as const) {
      const r = await db.rpc("admin_void_payment", { p_actor: actor, p_org: local.id, p_payment: id, p_reason: "x" });
      expect(r.error?.code, nombre).toBe("42501");
    }
    expect(await suscripcion(local.id)).toEqual(antes);
    expect(await anulaciones(local.id)).toEqual([]);
    expect(await auditoria(local.id)).toHaveLength(1); // solo el pago registrado
  });

  it("con service_role, un actor que no es SuperAdmin (Dueño, Staff, cuenta común, nulo, desconocido) no cambia nada", async () => {
    const local = await crearLocal();
    const id = await cargar(local);
    const antes = await suscripcion(local.id);
    for (const actor of [local.owner.id, local.staff.id, comun.id, null, randomUUID()]) {
      const r = await service.rpc("admin_void_payment", { p_actor: actor as string, p_org: local.id, p_payment: id, p_reason: "x" });
      expect(r.error?.code, String(actor)).toBe("42501");
      expect(r.error?.message).toBe("not_platform_admin");
    }
    expect(await suscripcion(local.id)).toEqual(antes);
    expect(await anulaciones(local.id)).toEqual([]);
  });

  it("el módulo rechaza a quien no es SuperAdmin antes de tocar nada", async () => {
    const local = await crearLocal();
    const id = await cargar(local);
    for (const quien of [local.owner, local.staff, comun]) {
      expect(await anular(local, id, "x", quien)).toEqual({ ok: false, error: "forbidden" });
    }
    expect(await anulaciones(local.id)).toEqual([]);
  });

  it("Dueño y Staff no leen las anulaciones; los SuperAdmin sí", async () => {
    const local = await crearLocal();
    expect((await anular(local, await cargar(local))).ok).toBe(true);
    for (const usuario of [local.owner, local.staff, comun]) {
      const lectura = await usuario.db.from("payment_voids").select("id");
      expect(lectura.error).toBeNull();
      expect(lectura.data).toEqual([]);
    }
    expect((await admin.db.from("payment_voids").select("id").eq("organization_id", local.id)).data).toHaveLength(1);
    expect((await otroAdmin.db.from("payment_voids").select("id").eq("organization_id", local.id)).data).toHaveLength(1);
    expect((await anonClient().from("payment_voids").select("id")).error).not.toBeNull();
  });

  it("ni service_role ni el dueño de la tabla reescriben payment_voids; solo se agrega y una vez por pago", async () => {
    const local = await crearLocal();
    const id = await cargar(local);
    expect((await anular(local, id)).ok).toBe(true);
    const voidId = (await anulaciones(local.id))[0].id;

    expect((await service.from("payment_voids").update({ reason: "otro" }).eq("id", voidId)).error?.code).toBe("42501");
    expect((await service.from("payment_voids").delete().eq("id", voidId)).error?.code).toBe("42501");
    expect((await service.from("payment_voids").insert({ payment_id: id, organization_id: local.id, subscription_id: randomUUID(), reason: "x", voided_by: admin.id, period_end_before: new Date().toISOString(), period_end_after: new Date().toISOString() })).error?.code).toBe("42501");

    for (const consulta of [
      `update public.payment_voids set reason = 'otro' where id = '${voidId}'`,
      `delete from public.payment_voids where id = '${voidId}'`,
      `truncate public.payment_voids`,
    ]) {
      expect(() => sql(consulta), consulta).toThrow(/payment_voids es de solo agregado/);
    }
    // Una segunda anulación del mismo pago, aun como dueño de la tabla, choca con la unicidad.
    expect(() =>
      sql(
        `insert into public.payment_voids (payment_id, organization_id, subscription_id, reason, voided_by, period_end_before, period_end_after)
         select payment_id, organization_id, subscription_id, reason, voided_by, period_end_before, period_end_after from public.payment_voids where id = '${voidId}'`,
      ),
    ).toThrow(/payment_voids_payment_id_key|duplicate key/);
    expect(contar("payment_voids", `organization_id = '${local.id}' and reason = 'Se cargó mal'`)).toBe(1);
  });
});

describe("anular el último pago", () => {
  it("el pago queda intacto, la vigencia vuelve a la de antes y hay una anulación y una auditoría con el motivo", async () => {
    const local = await crearLocal(-2 * DIA_MS); // en gracia
    const antes = await suscripcion(local.id);
    const id = await cargar(local, { reference: "op-77", coversUntil: enDias(30) });
    expect((await entitlements(local.owner, local.id)).state).toBe("active");
    const [original] = await pagos(local.id);

    const r = await anular(local, id, "  Se cargó un mes de más  ");
    expect(r.ok).toBe(true);

    // La vigencia es exactamente la de antes del pago.
    expect(fin((await suscripcion(local.id)).current_period_end)).toBe(fin(antes.current_period_end));
    expect((await entitlements(local.owner, local.id)).state).toBe("grace");
    // El pago no se tocó.
    expect(await pagos(local.id)).toEqual([original]);
    // Una anulación con el estado antes/después.
    const filas = await anulaciones(local.id);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ payment_id: id, organization_id: local.id, reason: "Se cargó un mes de más", voided_by: admin.id });
    expect(fin(filas[0].period_end_before)).toBe(fin(original.covers_until));
    expect(fin(filas[0].period_end_after)).toBe(fin(antes.current_period_end));
    // Auditoría: registrado + anulado, con quién, qué y por qué; sin la referencia del pago.
    const entradas = await auditoria(local.id);
    expect(entradas.map((e) => e.action)).toEqual(["payment.registered", "payment.voided"]);
    expect(entradas[1]).toMatchObject({
      actor_id: admin.id,
      after: {
        slug: local.slug,
        payment_id: id,
        void_id: filas[0].id,
        amount_cents: 2_000_000,
        currency: "ARS",
        method: "transfer",
        paid_on: hoyAr(),
        reason: "Se cargó un mes de más",
      },
    });
    expect(fin((entradas[1].before as { period_end: string }).period_end)).toBe(fin(original.covers_until));
    expect(fin((entradas[1].after as { period_end: string }).period_end)).toBe(fin(antes.current_period_end));
    expect(JSON.stringify(entradas[1])).not.toContain("op-77");
  });

  it("anular el único pago de una cuenta en prueba la devuelve a la prueba y conserva su fecha", async () => {
    contador += 1;
    const slug = `tt-anula-${sufijo}-prueba${contador}`;
    const id = (await service.from("organizations").insert({ slug, name: slug }).select("id").single()).data!.id;
    orgs.push(id);
    const owner = await createUser(service, `anula-prueba${contador}`);
    users.push(owner);
    await addMembership(service, owner, id, "owner");
    const inicial = await suscripcion(id);
    expect(inicial.current_period_end).toBeNull();

    const pagoId = await cargar({ id, slug }, { coversUntil: enDias(60) });
    expect(await entitlements(owner, id)).toMatchObject({ trialStatus: "converted", state: "active" });

    expect((await anular({ slug }, pagoId)).ok).toBe(true);
    const despues = await suscripcion(id);
    expect(despues.current_period_end).toBeNull();
    expect(despues.trial_ends_at).toBe(inicial.trial_ends_at);
    expect(await entitlements(owner, id)).toMatchObject({ trialStatus: "in_trial", state: "active" });
  });

  it("de dos pagos se anula primero el último; el anterior se anula después y recién ahí vuelve al principio", async () => {
    const local = await crearLocal(10 * DIA_MS);
    const inicial = fin((await suscripcion(local.id)).current_period_end);
    const p1 = await cargar(local, { coversUntil: enDias(40) });
    const p2 = await cargar(local, { coversUntil: enDias(70) });

    // El primero ya no define la vigencia: se rechaza sin cambiar nada.
    expect(await anular(local, p1)).toEqual({ ok: false, error: "payment_not_latest" });
    expect(await anulaciones(local.id)).toEqual([]);
    expect(fin((await suscripcion(local.id)).current_period_end)).toBe(finDelDia(enDias(70)));

    expect((await anular(local, p2)).ok).toBe(true);
    expect(fin((await suscripcion(local.id)).current_period_end)).toBe(finDelDia(enDias(40)));

    expect((await anular(local, p1)).ok).toBe(true);
    expect(fin((await suscripcion(local.id)).current_period_end)).toBe(inicial);
    expect(await anulaciones(local.id)).toHaveLength(2);
  });

  it("después de anular se puede volver a registrar con la misma fecha de cobertura (corregir un importe)", async () => {
    const local = await crearLocal();
    const mal = await cargar(local, { amount: "2000", coversUntil: enDias(30) });
    expect((await anular(local, mal)).ok).toBe(true);

    const bien = await cargar(local, { amount: "20000", coversUntil: enDias(30) });
    expect(bien).not.toBe(mal);
    expect(await pagos(local.id)).toHaveLength(2);
    expect(await anulaciones(local.id)).toHaveLength(1);
    expect(fin((await suscripcion(local.id)).current_period_end)).toBe(finDelDia(enDias(30)));
    // El correcto es ahora el último vigente y el anulado no se puede anular otra vez.
    expect(await anular(local, mal)).toEqual({ ok: false, error: "payment_already_voided" });
    expect((await anular(local, bien)).ok).toBe(true);
  });

  it("puede dejar la cuenta vencida en el acto: la mora la deciden las fechas", async () => {
    const local = await crearLocal(-40 * DIA_MS); // suspendida por mora
    const id = await cargar(local);
    expect((await entitlements(local.owner, local.id)).state).toBe("active");
    expect((await local.staff.db.from("categories").insert({ organization_id: local.id, name: "con pago" })).error).toBeNull();

    expect((await anular(local, id)).ok).toBe(true);
    expect((await entitlements(local.owner, local.id)).state).toBe("suspended");
    expect((await local.staff.db.from("categories").insert({ organization_id: local.id, name: "sin pago" })).error).not.toBeNull();
  });

  it("no toca el plan, el ciclo ni la suspensión manual", async () => {
    const local = await crearLocal();
    const id = await cargar(local);
    expect((await setSuspension(ctx(admin), { slug: local.slug, suspend: true, reason: "abuso" })).ok).toBe(true);
    const antes = await suscripcion(local.id);

    expect((await anular(local, id)).ok).toBe(true);
    const despues = await suscripcion(local.id);
    expect(despues.suspended_at).toBe(antes.suspended_at);
    expect(despues.plan_code).toBe(antes.plan_code);
    expect(despues.billing_cycle).toBe(antes.billing_cycle);
    expect((await entitlements(local.owner, local.id)).state).toBe("suspended");
  });
});

describe("lo que no se anula: ni anulación, ni cambio de vigencia, ni auditoría", () => {
  it("un pago ya anulado, uno de otra organización, uno inexistente o con identificador roto", async () => {
    const local = await crearLocal();
    const otro = await crearLocal();
    const id = await cargar(local);
    const deOtro = await cargar(otro);
    expect((await anular(local, id)).ok).toBe(true);

    const estadoLocal = await suscripcion(local.id);
    const estadoOtro = await suscripcion(otro.id);
    const auditorias = (await auditoria(local.id)).length + (await auditoria(otro.id)).length;

    expect(await anular(local, id)).toEqual({ ok: false, error: "payment_already_voided" });
    expect(await anular(local, deOtro)).toEqual({ ok: false, error: "payment_not_found" }); // el pago es de otra organización
    expect(await anular(otro, id)).toEqual({ ok: false, error: "payment_not_found" });
    expect(await anular(local, randomUUID())).toEqual({ ok: false, error: "payment_not_found" });
    expect(await anular(local, "no-es-un-uuid")).toEqual({ ok: false, error: "payment_not_found" });
    expect(await anular({ slug: "tt-anula-no-existe" }, id)).toEqual({ ok: false, error: "org_not_found" });

    expect(await suscripcion(local.id)).toEqual(estadoLocal);
    expect(await suscripcion(otro.id)).toEqual(estadoOtro);
    expect((await auditoria(local.id)).length + (await auditoria(otro.id)).length).toBe(auditorias);
    expect(await anulaciones(otro.id)).toEqual([]);
  });

  it("motivo vacío o de más de 200 caracteres", async () => {
    const local = await crearLocal();
    const id = await cargar(local);
    for (const motivo of ["", "   ", "x".repeat(201), null]) {
      expect(await anular(local, id, motivo), String(motivo)).toEqual({ ok: false, error: "invalid_reason" });
    }
    expect(await anulaciones(local.id)).toEqual([]);
    expect(await auditoria(local.id)).toHaveLength(1);
  });

  it("la base valida por sí sola el motivo, la organización y el pago", async () => {
    const local = await crearLocal();
    const id = await cargar(local);
    const llamar = (parametros: { p_org?: string; p_payment?: string; p_reason?: string }) =>
      service.rpc("admin_void_payment", { p_actor: admin.id, p_org: local.id, p_payment: id, p_reason: "ok", ...parametros });

    expect((await llamar({ p_reason: "" })).error).toMatchObject({ code: "22023", message: "invalid_reason" });
    expect((await llamar({ p_reason: "x".repeat(201) })).error).toMatchObject({ code: "22023", message: "invalid_reason" });
    expect((await llamar({ p_org: randomUUID() })).error).toMatchObject({ code: "P0002", message: "subscription_not_found" });
    expect((await llamar({ p_payment: randomUUID() })).error).toMatchObject({ code: "P0002", message: "payment_not_found" });
    expect(await anulaciones(local.id)).toEqual([]);
  });

  it("si la historia no cuadra (se tocó la vigencia a mano entre dos pagos), se niega y no adivina", async () => {
    const local = await crearLocal(10 * DIA_MS);
    await cargar(local, { coversUntil: enDias(40) });
    // Alguien ajustó la vigencia a mano (por SQL) entre los dos pagos.
    sql(`update public.subscriptions set current_period_end = '${parsePeriodEnd(enDias(50), new Date())}' where organization_id = '${local.id}'`);
    const p2 = await cargar(local, { coversUntil: enDias(80) });
    const antes = await suscripcion(local.id);

    expect(await anular(local, p2)).toEqual({ ok: false, error: "payment_history_inconsistent" });
    expect(await suscripcion(local.id)).toEqual(antes);
    expect(await anulaciones(local.id)).toEqual([]);
  });

  it("si la vigencia ya no es la del pago (se ajustó a mano después), tampoco se anula", async () => {
    const local = await crearLocal(10 * DIA_MS);
    const id = await cargar(local, { coversUntil: enDias(40) });
    sql(`update public.subscriptions set current_period_end = '${parsePeriodEnd(enDias(90), new Date())}' where organization_id = '${local.id}'`);
    expect(await anular(local, id)).toEqual({ ok: false, error: "payment_not_latest" });
    expect(await anulaciones(local.id)).toEqual([]);
  });
});

describe("concurrencia", () => {
  it("dos SuperAdmin anulando el mismo pago a la vez dejan una sola anulación y una sola auditoría", async () => {
    for (let ronda = 0; ronda < 6; ronda++) {
      const local = await crearLocal(-2 * DIA_MS);
      const id = await cargar(local);
      const resultados = await Promise.all([anular(local, id, "uno", admin), anular(local, id, "dos", otroAdmin)]);
      expect(resultados.filter((r) => r.ok), `ronda ${ronda}`).toHaveLength(1);
      expect(resultados.find((r) => !r.ok)).toEqual({ ok: false, error: "payment_already_voided" });
      expect(await anulaciones(local.id), `ronda ${ronda}`).toHaveLength(1);
      expect((await auditoria(local.id)).filter((e) => e.action === "payment.voided")).toHaveLength(1);
    }
  });

  it("anular y registrar un pago nuevo a la vez no deja la vigencia incoherente", async () => {
    for (let ronda = 0; ronda < 6; ronda++) {
      const local = await crearLocal(-2 * DIA_MS);
      const id = await cargar(local, { coversUntil: enDias(30) });
      await Promise.all([anular(local, id), registerPayment(ctx(otroAdmin), pago(local, { coversUntil: enDias(60) }))]);
      const sub = await suscripcion(local.id);
      const validos = (await pagos(local.id)).filter((p) => !sql(`select 1 from public.payment_voids where payment_id = '${p.id}'`).length);
      // La vigencia es siempre la de un pago vigente, o la inicial si no queda ninguno.
      const esperado = validos.length ? Math.max(...validos.map((p) => fin(p.covers_until)!)) : fin((await pagos(local.id))[0].previous_period_end);
      expect(fin(sub.current_period_end), `ronda ${ronda}`).toBe(esperado);
    }
  });
});

describe("lo que ve cada quien", () => {
  it("el Dueño ve el pago como anulado y el movimiento sin motivo, autor ni ids; el Staff y otro Dueño no ven nada", async () => {
    const local = await crearLocal();
    const otro = await crearLocal();
    const id = await cargar(local, { reference: "op-77" });
    expect((await anular(local, id, "Nota interna: el cliente pagó de menos")).ok).toBe(true);

    const comoDueno = await local.owner.db.rpc("owner_payments", { p_org: local.id });
    expect(comoDueno.error).toBeNull();
    expect(comoDueno.data).toHaveLength(1);
    expect(comoDueno.data![0]).toMatchObject({ id, voided_at: expect.any(String) });
    expect(Object.keys(comoDueno.data![0]).sort()).not.toContain("reason");
    expect(JSON.stringify(comoDueno.data)).not.toContain("Nota interna");
    expect(JSON.stringify(comoDueno.data)).not.toContain(admin.id);

    const historial = await local.owner.db.rpc("owner_account_history", { p_org: local.id });
    expect(historial.error).toBeNull();
    const movimiento = historial.data!.find((m) => m.action === "payment.voided");
    expect(movimiento).toBeDefined();
    expect(Object.keys(movimiento!.detail as object).sort()).toEqual(
      ["amount_cents", "billing_cycle", "currency", "method", "paid_on", "period_end", "plan", "previous_period_end"].sort(),
    );
    const texto = JSON.stringify(historial.data);
    for (const prohibido of ["Nota interna", admin.id, admin.email, "op-77", id]) expect(texto, prohibido).not.toContain(prohibido);

    for (const intruso of [local.staff, otro.owner, comun, admin]) {
      expect((await intruso.db.rpc("owner_payments", { p_org: local.id })).data).toEqual([]);
      expect((await intruso.db.rpc("owner_account_history", { p_org: local.id })).data).toEqual([]);
    }
  });

  it("un pago vigente llega al Dueño sin fecha de anulación", async () => {
    const local = await crearLocal();
    await cargar(local);
    const filas = (await local.owner.db.rpc("owner_payments", { p_org: local.id })).data!;
    expect(filas).toHaveLength(1);
    expect(filas[0].voided_at).toBeNull();
  });

  it("la ficha del SuperAdmin marca los pagos anulados con su motivo y ofrece anular solo el último vigente", async () => {
    const local = await crearLocal(10 * DIA_MS);
    const p1 = await cargar(local, { coversUntil: enDias(40) });
    const p2 = await cargar(local, { coversUntil: enDias(70) });

    const leer = async () => {
      const r = await getOrganizationDetail(ctx(admin), local.slug);
      if (!r.ok) throw new Error("no se pudo leer la ficha");
      return r.data;
    };
    let detalle = await leer();
    const marcas = () => Object.fromEntries(detalle.payments.map((p) => [p.id, isVoidable(p, detalle.currentPeriodEnd)]));
    expect(marcas()).toEqual({ [p1]: false, [p2]: true });
    expect(detalle.payments.every((p) => p.voided === null)).toBe(true);

    expect((await anular(local, p2, "Fecha de más")).ok).toBe(true);
    detalle = await leer();
    expect(marcas()).toEqual({ [p1]: true, [p2]: false });
    expect(detalle.payments.find((p) => p.id === p2)!.voided).toMatchObject({ reason: "Fecha de más" });
    expect(detalle.audit.some((e) => e.action === "payment.voided")).toBe(true);
  });
});

describe("una organización con anulaciones tampoco se borra en cascada por accidente", () => {
  it("RESTRICT desde payment_voids", async () => {
    const local = await crearLocal();
    expect((await anular(local, await cargar(local))).ok).toBe(true);
    expect((await service.from("organizations").delete().eq("id", local.id)).error?.code).toBe("23503");
    expect(contar("organizations", `id = '${local.id}'`)).toBe(1);
  });
});
