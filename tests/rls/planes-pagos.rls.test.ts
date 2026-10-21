import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listOrganizations, type AdminContext } from "@/lib/admin/organizations";
import { changePlan, getOrganizationDetail, registerPayment, setSuspension } from "@/lib/admin/subscriptions";
import { parsePeriodEnd } from "@/lib/admin/validation";
import { parseEntitlements, trialStatus } from "@/lib/entitlements";
import { purgeAuditLogWhere, purgePaymentsWhere } from "./purge-price-history";
import {
  addMembership,
  anonClient,
  createCategory,
  createOrg,
  createUser,
  deleteOrg,
  deleteUser,
  DIA_MS,
  insertProducts,
  serviceClient,
  setSubscription,
  sql,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * SuperAdmin: cambio de plan, suspensión y reactivación a mano, pagos y prueba gratuita (nivel C, ficha
 * superadmin-planes-pagos) contra el Supabase local, con los mismos clientes que usa el servidor.
 * El foco son los casos adversarios (quien no es SuperAdmin, la vigencia que no se acorta ni se repite, las escrituras
 * directas) y los efectos sobre el estado de la cuenta, que decide la base.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const HORA_MS = 3_600_000;
const enDias = (dias: number) => new Date(Date.now() + dias * DIA_MS).toISOString().slice(0, 10);
/** Hoy en Argentina (AAAA-MM-DD): el pago no puede tener fecha futura. */
const hoyAr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());

let service: Db;
let admin: TestUser;
let otroAdmin: TestUser;
let comun: TestUser; // con sesión pero sin ningún rol
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

const ctx = (user: TestUser): AdminContext => ({ session: user.db, admin: service, actorId: user.id });
const contar = (tabla: string, donde = "true") => Number(sql(`select count(*) from public.${tabla} where ${donde}`)[0][0]);

type Local = { id: string; slug: string; owner: TestUser; staff: TestUser };

/** Una organización propia con Dueño y Staff, con el plan y el fin de período pedidos (sin prueba). */
async function crearLocal(opciones: { plan?: "basic" | "pro" | "premium"; finEnMs?: number } = {}): Promise<Local> {
  contador += 1;
  const slug = `tt-plan-${sufijo}-${contador}`;
  const id = await createOrg(service, slug, opciones.plan ?? "pro");
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: opciones.finEnMs ?? 30 * DIA_MS });
  const owner = await createUser(service, `plan-d${contador}`);
  const staff = await createUser(service, `plan-s${contador}`);
  users.push(owner, staff);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, slug, owner, staff };
}

const suscripcion = async (orgId: string) =>
  (await service.from("subscriptions").select("*").eq("organization_id", orgId).single()).data!;

const auditoria = async (orgId: string) =>
  (await service.from("audit_log").select("*").eq("organization_id", orgId).order("created_at", { ascending: true })).data!;

async function entitlements(user: TestUser, orgId: string) {
  const { data, error } = await user.db.rpc("org_entitlements", { p_org: orgId });
  expect(error).toBeNull();
  return parseEntitlements(data)!;
}

/** Estado de la cuenta según la base, para un Dueño. */
const estado = async (local: Local) => (await entitlements(local.owner, local.id)).state;

const pago = (local: Local, cambios: Partial<Parameters<typeof registerPayment>[1]> = {}) => ({
  slug: local.slug,
  amount: "20000",
  currency: "ARS",
  method: "transfer",
  reference: "op-1",
  paidOn: hoyAr(),
  coversUntil: enDias(30),
  ...cambios,
});

beforeAll(async () => {
  service = serviceClient();
  admin = await createUser(service, "plan-admin");
  otroAdmin = await createUser(service, "plan-otro-admin");
  comun = await createUser(service, "plan-comun");
  users.push(admin, otroAdmin, comun);
  // Los SuperAdmin los agrega el operador con SQL: ni la API ni service_role pueden escribir esa tabla.
  sql(`insert into public.platform_admins (user_id) values ('${admin.id}'), ('${otroAdmin.id}')`);
});

afterAll(async () => {
  purgeAuditLogWhere(`after->>'slug' like 'tt-plan-%'`); // la auditoría solo se agrega: se limpia como dueño de la tabla
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("quién puede: solo SuperAdmin, solo por el servidor", () => {
  it("ninguna sesión (ni la de un SuperAdmin) ni anon pueden llamar las funciones por la API", async () => {
    const local = await crearLocal();
    const antes = await suscripcion(local.id);
    const llamadas = (db: Db, actor: string) => [
      db.rpc("admin_change_plan", { p_actor: actor, p_org: local.id, p_plan: "basic", p_billing_cycle: "monthly", p_reason: "x" }),
      db.rpc("admin_set_suspension", { p_actor: actor, p_org: local.id, p_suspend: true, p_reason: "x" }),
      db.rpc("admin_register_payment", {
        p_actor: actor,
        p_org: local.id,
        p_amount_cents: 100,
        p_currency: "ARS",
        p_method: "cash",
        p_reference: "",
        p_paid_on: hoyAr(),
        p_covers_until: new Date(Date.now() + 60 * DIA_MS).toISOString(),
      }),
    ];
    for (const [nombre, db, actor] of [
      ["SuperAdmin con sesión", admin.db, admin.id],
      ["Dueño", local.owner.db, local.owner.id],
      ["Staff", local.staff.db, local.staff.id],
      ["anon", anonClient(), admin.id],
    ] as const) {
      for (const respuesta of await Promise.all(llamadas(db, actor))) {
        expect(respuesta.error?.code, nombre).toBe("42501");
      }
    }
    expect(await suscripcion(local.id)).toEqual(antes);
    expect(await auditoria(local.id)).toEqual([]);
    expect(contar("payments", `organization_id = '${local.id}'`)).toBe(0);
  });

  it("con service_role, un actor que no es SuperAdmin (Dueño, Staff, cuenta común, nulo, desconocido) no cambia nada", async () => {
    const local = await crearLocal();
    const antes = await suscripcion(local.id);
    const desconocido = "00000000-0000-4000-8000-0000000000ff";
    for (const actor of [local.owner.id, local.staff.id, comun.id, desconocido, null as unknown as string]) {
      const respuestas = await Promise.all([
        service.rpc("admin_change_plan", { p_actor: actor, p_org: local.id, p_plan: "basic", p_billing_cycle: "monthly", p_reason: "x" }),
        service.rpc("admin_set_suspension", { p_actor: actor, p_org: local.id, p_suspend: true, p_reason: "x" }),
        service.rpc("admin_register_payment", {
          p_actor: actor,
          p_org: local.id,
          p_amount_cents: 100,
          p_currency: "ARS",
          p_method: "cash",
          p_reference: "",
          p_paid_on: hoyAr(),
          p_covers_until: new Date(Date.now() + 60 * DIA_MS).toISOString(),
        }),
      ]);
      for (const r of respuestas) {
        expect(r.error?.code).toBe("42501");
        expect(r.error?.message).toBe("not_platform_admin");
      }
    }
    expect(await suscripcion(local.id)).toEqual(antes);
    expect(await auditoria(local.id)).toEqual([]);
    expect(contar("payments", `organization_id = '${local.id}'`)).toBe(0);
  });

  it("las acciones del módulo rechazan a quien no es SuperAdmin antes de tocar nada", async () => {
    const local = await crearLocal();
    const antes = await suscripcion(local.id);
    for (const usuario of [local.owner, local.staff, comun]) {
      const c = ctx(usuario);
      const resultados = [
        await changePlan(c, { slug: local.slug, plan: "basic", billingCycle: "monthly", reason: "x" }),
        await setSuspension(c, { slug: local.slug, suspend: true, reason: "x" }),
        await registerPayment(c, pago(local)),
        await getOrganizationDetail(c, local.slug),
        await listOrganizations(c),
      ];
      for (const r of resultados) expect(r).toEqual({ ok: false, error: "forbidden" });
    }
    expect(await suscripcion(local.id)).toEqual(antes);
  });

  it("un SuperAdmin al que le quitan el rol deja de poder actuar (la base lo vuelve a comprobar)", async () => {
    const local = await crearLocal();
    const efimero = await createUser(service, "plan-efimero");
    users.push(efimero);
    sql(`insert into public.platform_admins (user_id) values ('${efimero.id}')`);
    expect((await setSuspension(ctx(efimero), { slug: local.slug, suspend: true, reason: "prueba" })).ok).toBe(true);
    sql(`delete from public.platform_admins where user_id = '${efimero.id}'`);
    // Aunque el servidor lo siguiera creyendo SuperAdmin, la función de base lo rechaza.
    const directo = await service.rpc("admin_set_suspension", { p_actor: efimero.id, p_org: local.id, p_suspend: false, p_reason: "x" });
    expect(directo.error?.code).toBe("42501");
    expect((await suscripcion(local.id)).suspended_at).not.toBeNull();
  });

  it("Dueño y Staff no escriben la suscripción ni los pagos por la API; anon no lee nada", async () => {
    const local = await crearLocal();
    for (const usuario of [local.owner, local.staff]) {
      const upd = await usuario.db.from("subscriptions").update({ suspended_at: null, plan_code: "premium" }).eq("organization_id", local.id).select();
      expect(upd.error?.code === "42501" || upd.data?.length === 0).toBe(true);
      const ins = await usuario.db.from("payments").insert({
        organization_id: local.id,
        subscription_id: (await suscripcion(local.id)).id,
        plan_code: "pro",
        billing_cycle: "monthly",
        amount_cents: 100,
        currency: "ARS",
        method: "cash",
        paid_on: hoyAr(),
        previous_period_end: new Date().toISOString(),
        covers_until: new Date(Date.now() + DIA_MS).toISOString(),
        registered_by: usuario.id,
      });
      expect(ins.error?.code).toBe("42501");
    }
    expect((await suscripcion(local.id)).plan_code).toBe("pro");
    const anon = await anonClient().from("payments").select("id");
    expect(anon.error?.code).toBe("42501");
  });

  it("el Dueño y el Staff no leen pagos (ni los propios); los SuperAdmin sí", async () => {
    const local = await crearLocal();
    expect((await registerPayment(ctx(admin), pago(local))).ok).toBe(true);
    for (const usuario of [local.owner, local.staff, comun]) {
      const lectura = await usuario.db.from("payments").select("id");
      expect(lectura.error).toBeNull();
      expect(lectura.data).toEqual([]);
    }
    const comoAdmin = await admin.db.from("payments").select("id").eq("organization_id", local.id);
    expect(comoAdmin.data).toHaveLength(1);
    const comoOtro = await otroAdmin.db.from("payments").select("id").eq("organization_id", local.id);
    expect(comoOtro.data).toHaveLength(1);
  });

  it("ni service_role puede escribir payments o audit_log directamente; el dueño de la tabla tampoco los reescribe", async () => {
    const local = await crearLocal();
    const id = (await registerPayment(ctx(admin), pago(local))).ok
      ? (await service.from("payments").select("id").eq("organization_id", local.id).single()).data!.id
      : "";
    expect(id).not.toBe("");
    const upd = await service.from("payments").update({ amount_cents: 1 }).eq("id", id);
    expect(upd.error?.code).toBe("42501");
    const del = await service.from("payments").delete().eq("id", id);
    expect(del.error?.code).toBe("42501");
    const ins = await service.from("audit_log").insert({ actor_id: admin.id, actor_email: "x", action: "payment.registered" });
    expect(ins.error?.code).toBe("42501");

    // Cada consulta tiene que ser rechazada por el trigger de `payments` (el mensaje nombra la tabla y la operación): con
    // `payment_voids` en la lista de TRUNCATE, el trigger de esa otra tabla no puede tapar la ausencia del de `payments`.
    for (const [consulta, operacion] of [
      [`update public.payments set amount_cents = 1 where id = '${id}'`, "UPDATE"],
      [`delete from public.payments where id = '${id}'`, "DELETE"],
      // Sola, la frena la clave foránea de payment_voids antes que el trigger; `payments` va primero para que dispare primero.
      [`truncate public.payments, public.payment_voids`, "TRUNCATE"],
    ] as const) {
      expect(() => sql(consulta), consulta).toThrow(new RegExp(`payments es de solo agregado \\(${operacion} rechazado\\)`));
    }
    expect(contar("payments", `id = '${id}' and amount_cents = 2000000`)).toBe(1);
  });
});

describe("cambiar el plan a mano", () => {
  it("cambia plan y ciclo, no toca las fechas y deja una fila de auditoría con quién, qué y por qué", async () => {
    const local = await crearLocal({ plan: "pro" });
    const antes = await suscripcion(local.id);

    const r = await changePlan(ctx(admin), { slug: local.slug, plan: "basic", billingCycle: "yearly", reason: "  baja pedida por el cliente  " });
    expect(r).toEqual({ ok: true, data: undefined });

    const despues = await suscripcion(local.id);
    expect(despues.plan_code).toBe("basic");
    expect(despues.billing_cycle).toBe("yearly");
    expect(despues.current_period_end).toBe(antes.current_period_end);
    expect(despues.trial_ends_at).toBe(antes.trial_ends_at);
    expect(despues.suspended_at).toBe(antes.suspended_at);

    const filas = await auditoria(local.id);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      action: "subscription.plan_changed",
      actor_id: admin.id,
      actor_email: admin.email,
      organization_id: local.id,
      before: { plan: "pro", billing_cycle: antes.billing_cycle },
      after: { slug: local.slug, plan: "basic", billing_cycle: "yearly", reason: "baja pedida por el cliente" },
    });
  });

  it("el plan nuevo manda en seguida: los límites y las funciones cambian, el Dueño lo ve", async () => {
    const local = await crearLocal({ plan: "pro" });
    expect((await entitlements(local.owner, local.id)).features).toContain("waiter_call");
    await changePlan(ctx(admin), { slug: local.slug, plan: "basic", billingCycle: "monthly", reason: "baja" });
    const ent = await entitlements(local.owner, local.id);
    expect(ent.plan).toBe("basic");
    expect(ent.features).not.toContain("waiter_call");
    expect(ent.limits.active_products).toBe(80);
  });

  it("bajar de plan conserva lo que supera el tope y solo bloquea crear más", async () => {
    const local = await crearLocal({ plan: "pro" });
    const categoria = await createCategory(service, local.id);
    expect((await insertProducts(service, local.id, categoria, 85)).error).toBeNull();
    expect((await changePlan(ctx(admin), { slug: local.slug, plan: "basic", billingCycle: "monthly", reason: "baja" })).ok).toBe(true);
    expect(contar("products", `organization_id = '${local.id}' and is_active`)).toBe(85); // nada se borra ni se desactiva
    const mas = await insertProducts(service, local.id, categoria, 1, true, "tt-extra");
    expect(mas.error?.code).toBe("53400"); // crear uno activo más se rechaza
    const inactivo = await insertProducts(service, local.id, categoria, 1, false, "tt-oculto");
    expect(inactivo.error).toBeNull(); // uno oculto sí
  });

  it("sin cambios, motivo vacío o demasiado largo, plan o ciclo inválidos y organización inexistente: error claro y cero filas", async () => {
    const local = await crearLocal({ plan: "pro" });
    const antes = await suscripcion(local.id);
    const intentos: Array<[Parameters<typeof changePlan>[1], string]> = [
      [{ slug: local.slug, plan: "pro", billingCycle: antes.billing_cycle, reason: "igual" }, "plan_unchanged"],
      [{ slug: local.slug, plan: "basic", billingCycle: "monthly", reason: "   " }, "invalid_reason"],
      [{ slug: local.slug, plan: "basic", billingCycle: "monthly", reason: "x".repeat(201) }, "invalid_reason"],
      [{ slug: local.slug, plan: "enterprise", billingCycle: "monthly", reason: "x" }, "invalid_plan"],
      [{ slug: local.slug, plan: "basic", billingCycle: "weekly", reason: "x" }, "invalid_cycle"],
      [{ slug: "tt-plan-no-existe", plan: "basic", billingCycle: "monthly", reason: "x" }, "org_not_found"],
      [{ slug: "NO ES UN SLUG", plan: "basic", billingCycle: "monthly", reason: "x" }, "org_not_found"],
    ];
    for (const [entrada, error] of intentos) expect(await changePlan(ctx(admin), entrada), error).toEqual({ ok: false, error });
    expect(await suscripcion(local.id)).toEqual(antes);
    expect(await auditoria(local.id)).toEqual([]);
  });

  it("la base valida por sí sola (sin pasar por la aplicación) el plan, el ciclo y el motivo", async () => {
    const local = await crearLocal({ plan: "pro" });
    const base = { p_actor: admin.id, p_org: local.id, p_plan: "basic", p_billing_cycle: "monthly", p_reason: "x" };
    for (const [cambios, mensaje] of [
      [{ p_plan: "enterprise" }, "invalid_plan"],
      [{ p_billing_cycle: "weekly" }, "invalid_cycle"],
      [{ p_reason: "" }, "invalid_reason"],
      [{ p_reason: "x".repeat(201) }, "invalid_reason"],
      [{ p_org: "00000000-0000-4000-8000-0000000000fe" }, "subscription_not_found"],
    ] as const) {
      const r = await service.rpc("admin_change_plan", { ...base, ...cambios });
      expect(r.error?.message).toBe(mensaje);
    }
    expect((await suscripcion(local.id)).plan_code).toBe("pro");
    expect(await auditoria(local.id)).toEqual([]);
  });
});

describe("suspender y reactivar a mano", () => {
  it("suspender: la cuenta pasa a suspendida aunque las fechas estén al día, no se escribe y la carta se oculta", async () => {
    const local = await crearLocal({ finEnMs: 30 * DIA_MS });
    await service.from("branches").insert({ organization_id: local.id, slug: "centro", name: "Centro" });
    const categoria = await createCategory(service, local.id);
    expect(await estado(local)).toBe("active");
    expect(await anonClient().rpc("public_menu_status", { p_org_slug: local.slug, p_branch_slug: "centro" })).toMatchObject({ data: "available" });

    expect((await setSuspension(ctx(admin), { slug: local.slug, suspend: true, reason: "contracargo" })).ok).toBe(true);

    const dueno = await entitlements(local.owner, local.id);
    expect(dueno).toMatchObject({ state: "suspended", canWrite: false, suspendedManually: true });
    expect(dueno.features).toEqual([]);
    const personal = await entitlements(local.staff, local.id);
    expect(personal.state).toBe("suspended");
    expect(personal.plan).toBeUndefined(); // el Staff sigue sin ver plan, fechas ni el motivo
    expect(personal.suspendedManually).toBeUndefined();

    const escribir = await local.owner.db.from("categories").insert({ organization_id: local.id, name: "nueva" });
    expect(escribir.error?.code).toBe("42501");
    const actualizar = await local.staff.db.from("categories").update({ name: "otra" }).eq("id", categoria).select();
    expect(actualizar.data).toEqual([]);
    expect(await anonClient().rpc("public_menu_status", { p_org_slug: local.slug, p_branch_slug: "centro" })).toMatchObject({ data: "suspended" });
    expect((await anonClient().from("branches").select("id").eq("organization_id", local.id)).data).toEqual([]);
    // Los datos se conservan para el personal.
    expect((await local.owner.db.from("categories").select("id").eq("organization_id", local.id)).data).toHaveLength(1);

    const filas = await auditoria(local.id);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      action: "subscription.suspended",
      actor_id: admin.id,
      before: { suspended: false },
      after: { slug: local.slug, suspended: true, state: "suspended", reason: "contracargo" },
    });
  });

  it("reactivar no regala tiempo: vuelve al estado que digan las fechas y el vencimiento no se mueve", async () => {
    const local = await crearLocal({ finEnMs: -10 * DIA_MS }); // en solo lectura por mora
    const antes = await suscripcion(local.id);
    expect(await estado(local)).toBe("read_only");

    await setSuspension(ctx(admin), { slug: local.slug, suspend: true, reason: "pausa" });
    expect(await estado(local)).toBe("suspended");
    const r = await setSuspension(ctx(admin), { slug: local.slug, suspend: false, reason: "se resolvió" });
    expect(r.ok).toBe(true);

    expect(await estado(local)).toBe("read_only"); // sigue en mora: no se agregó tiempo
    const despues = await suscripcion(local.id);
    expect(despues.suspended_at).toBeNull();
    expect(despues.current_period_end).toBe(antes.current_period_end);
    expect(despues.trial_ends_at).toBe(antes.trial_ends_at);

    const filas = await auditoria(local.id);
    expect(filas.map((f) => f.action)).toEqual(["subscription.suspended", "subscription.reactivated"]);
    expect(filas[1]).toMatchObject({
      before: { suspended: true },
      after: { suspended: false, state: "read_only", reason: "se resolvió" },
    });
  });

  it("una cuenta al día vuelve a escribir al reactivarla", async () => {
    const local = await crearLocal({ finEnMs: 30 * DIA_MS });
    await setSuspension(ctx(admin), { slug: local.slug, suspend: true, reason: "pausa" });
    await setSuspension(ctx(admin), { slug: local.slug, suspend: false, reason: "fin de la pausa" });
    expect(await estado(local)).toBe("active");
    const escribir = await local.owner.db.from("categories").insert({ organization_id: local.id, name: "nueva" });
    expect(escribir.error).toBeNull();
  });

  it("suspender dos veces o reactivar sin suspensión da error claro y no agrega auditoría", async () => {
    const local = await crearLocal();
    expect(await setSuspension(ctx(admin), { slug: local.slug, suspend: false, reason: "x" })).toEqual({ ok: false, error: "not_suspended" });
    expect((await setSuspension(ctx(admin), { slug: local.slug, suspend: true, reason: "x" })).ok).toBe(true);
    const segunda = await setSuspension(ctx(otroAdmin), { slug: local.slug, suspend: true, reason: "x" });
    expect(segunda).toEqual({ ok: false, error: "already_suspended" });
    expect(await auditoria(local.id)).toHaveLength(1);
    const sinMotivo = await setSuspension(ctx(admin), { slug: local.slug, suspend: false, reason: " " });
    expect(sinMotivo).toEqual({ ok: false, error: "invalid_reason" });
    expect(await setSuspension(ctx(admin), { slug: "tt-plan-fantasma", suspend: true, reason: "x" })).toEqual({
      ok: false,
      error: "org_not_found",
    });
  });

  it("dos suspensiones simultáneas dejan una sola auditoría", async () => {
    const local = await crearLocal();
    const [a, b] = await Promise.all([
      setSuspension(ctx(admin), { slug: local.slug, suspend: true, reason: "a" }),
      setSuspension(ctx(otroAdmin), { slug: local.slug, suspend: true, reason: "b" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await auditoria(local.id)).toHaveLength(1);
  });

  it("registrar un pago no levanta la suspensión manual", async () => {
    const local = await crearLocal({ finEnMs: -3 * DIA_MS });
    await setSuspension(ctx(admin), { slug: local.slug, suspend: true, reason: "revisión" });
    expect((await registerPayment(ctx(admin), pago(local))).ok).toBe(true);
    expect(await estado(local)).toBe("suspended");
    await setSuspension(ctx(admin), { slug: local.slug, suspend: false, reason: "resuelto" });
    expect(await estado(local)).toBe("active");
  });

  it("suspender una organización no afecta a otra", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    await setSuspension(ctx(admin), { slug: a.slug, suspend: true, reason: "x" });
    expect(await estado(a)).toBe("suspended");
    expect(await estado(b)).toBe("active");
    expect((await suscripcion(b.id)).suspended_at).toBeNull();
  });
});

describe("registrar un pago", () => {
  it("un pago en gracia extiende la vigencia, restablece la cuenta y deja el pago y la auditoría", async () => {
    const local = await crearLocal({ finEnMs: -3 * DIA_MS + HORA_MS });
    expect(await estado(local)).toBe("grace");
    const antes = await suscripcion(local.id);

    const r = await registerPayment(ctx(admin), pago(local, { amount: "20.000,50", currency: "ARS", method: "payment_link", reference: " op 77 ", coversUntil: enDias(30) }));
    expect(r.ok).toBe(true);

    expect(await estado(local)).toBe("active");
    const despues = await suscripcion(local.id);
    const esperado = parsePeriodEnd(enDias(30), new Date())!;
    expect(new Date(despues.current_period_end!).getTime()).toBe(new Date(esperado).getTime());

    const filas = (await service.from("payments").select("*").eq("organization_id", local.id)).data!;
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      subscription_id: antes.id,
      plan_code: "pro",
      billing_cycle: antes.billing_cycle,
      amount_cents: 2_000_050,
      currency: "ARS",
      method: "payment_link",
      reference: "op 77",
      paid_on: hoyAr(),
      registered_by: admin.id,
    });
    expect(new Date(filas[0].previous_period_end).getTime()).toBe(new Date(antes.current_period_end!).getTime());
    expect(new Date(filas[0].covers_until).getTime()).toBe(new Date(esperado).getTime());

    const auditorias = await auditoria(local.id);
    expect(auditorias).toHaveLength(1);
    expect(auditorias[0]).toMatchObject({
      action: "payment.registered",
      actor_id: admin.id,
      after: { slug: local.slug, payment_id: filas[0].id, amount_cents: 2_000_050, currency: "ARS", method: "payment_link", paid_on: hoyAr() },
    });
    // La referencia no se copia a la auditoría (no se puede borrar y puede traer datos de terceros).
    expect(JSON.stringify(auditorias[0].after)).not.toContain("op 77");
  });

  it("un pago en solo lectura o en suspensión por mora también restablece todo", async () => {
    for (const finEnMs of [-10 * DIA_MS, -40 * DIA_MS]) {
      const local = await crearLocal({ finEnMs });
      expect(["read_only", "suspended"]).toContain(await estado(local));
      expect((await registerPayment(ctx(admin), pago(local))).ok).toBe(true);
      expect(await estado(local)).toBe("active");
      const escribir = await local.staff.db.from("categories").insert({ organization_id: local.id, name: "ya puedo" });
      expect(escribir.error).toBeNull();
    }
  });

  it("un pago adelantado extiende desde el vencimiento actual y nunca lo acorta ni lo repite", async () => {
    const local = await crearLocal({ finEnMs: 10 * DIA_MS });
    const finActual = new Date((await suscripcion(local.id)).current_period_end!).getTime();

    // Antes del vencimiento actual: rechazado.
    expect(await registerPayment(ctx(admin), pago(local, { coversUntil: enDias(5) }))).toEqual({ ok: false, error: "payment_not_extending" });
    // El mismo instante (el fin de ese día en Argentina) tampoco extiende.
    const igual = enDias(30);
    sql(`update public.subscriptions set current_period_end = '${parsePeriodEnd(igual, new Date())}' where organization_id = '${local.id}'`);
    expect(await registerPayment(ctx(admin), pago(local, { coversUntil: igual }))).toEqual({ ok: false, error: "payment_not_extending" });
    expect(contar("payments", `organization_id = '${local.id}'`)).toBe(0);
    expect(finActual).toBeLessThan(new Date(parsePeriodEnd(igual, new Date())!).getTime());

    // Posterior: extiende, y el pago guarda el vencimiento anterior.
    const mas = enDias(60);
    expect((await registerPayment(ctx(admin), pago(local, { coversUntil: mas }))).ok).toBe(true);
    const filas = (await service.from("payments").select("*").eq("organization_id", local.id)).data!;
    expect(new Date(filas[0].previous_period_end).getTime()).toBe(new Date(parsePeriodEnd(igual, new Date())!).getTime());
    expect(new Date((await suscripcion(local.id)).current_period_end!).getTime()).toBe(new Date(parsePeriodEnd(mas, new Date())!).getTime());
  });

  it("el doble envío no duplica: el segundo da «no extiende» y queda un solo pago y una sola auditoría", async () => {
    const local = await crearLocal({ finEnMs: -2 * DIA_MS });
    const entrada = pago(local, { coversUntil: enDias(30) });
    expect((await registerPayment(ctx(admin), entrada)).ok).toBe(true);
    expect(await registerPayment(ctx(admin), entrada)).toEqual({ ok: false, error: "payment_not_extending" });
    expect(contar("payments", `organization_id = '${local.id}'`)).toBe(1);
    expect(await auditoria(local.id)).toHaveLength(1);
  });

  it("dos pagos simultáneos iguales dejan uno; dos distintos terminan en el más lejano sin acortar nunca", async () => {
    const igual = await crearLocal({ finEnMs: -2 * DIA_MS });
    const resultados = await Promise.all([
      registerPayment(ctx(admin), pago(igual, { coversUntil: enDias(30) })),
      registerPayment(ctx(otroAdmin), pago(igual, { coversUntil: enDias(30) })),
    ]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(contar("payments", `organization_id = '${igual.id}'`)).toBe(1);

    // Dos pagos distintos a la vez: sin el lock de la suscripción el que termina último pisaría al otro y acortaría la
    // vigencia. Es una carrera: se repite en varias organizaciones para que la ausencia del lock se note.
    const masLejos = new Date(parsePeriodEnd(enDias(60), new Date())!).getTime();
    for (let ronda = 0; ronda < 8; ronda++) {
      const distintos = await crearLocal({ finEnMs: -2 * DIA_MS });
      await Promise.all([
        registerPayment(ctx(admin), pago(distintos, { coversUntil: enDias(30) })),
        registerPayment(ctx(otroAdmin), pago(distintos, { coversUntil: enDias(60) })),
      ]);
      const fin = new Date((await suscripcion(distintos.id)).current_period_end!).getTime();
      expect(fin, `ronda ${ronda}: la vigencia nunca se acorta`).toBe(masLejos);
      expect(contar("payments", `organization_id = '${distintos.id}'`)).toBeGreaterThanOrEqual(1);
    }
  });

  it("importe, moneda, medio, referencia y fechas inválidos: error claro, ni pago ni cambio de vigencia ni auditoría", async () => {
    const local = await crearLocal({ finEnMs: -2 * DIA_MS });
    const antes = await suscripcion(local.id);
    const manana = new Date(Date.now() + DIA_MS * 1.5).toISOString().slice(0, 10);
    const intentos: Array<[Partial<Parameters<typeof registerPayment>[1]>, string]> = [
      [{ amount: "0" }, "invalid_amount"],
      [{ amount: "-5" }, "invalid_amount"],
      [{ amount: "veinte" }, "invalid_amount"],
      [{ currency: "EUR" }, "invalid_currency"],
      [{ currency: "" }, "invalid_currency"],
      [{ method: "tarjeta" }, "invalid_method"],
      [{ reference: "x".repeat(121) }, "invalid_reference"],
      [{ paidOn: manana }, "invalid_paid_on"],
      [{ paidOn: "2020-01-01" }, "invalid_paid_on"],
      [{ paidOn: "no" }, "invalid_paid_on"],
      [{ coversUntil: "2020-01-01" }, "invalid_covers_until"],
      [{ coversUntil: enDias(800) }, "invalid_covers_until"],
      [{ coversUntil: "" }, "invalid_covers_until"],
      [{ slug: "tt-plan-fantasma" }, "org_not_found"],
    ];
    for (const [cambios, error] of intentos) {
      expect(await registerPayment(ctx(admin), pago(local, cambios)), JSON.stringify(cambios)).toEqual({ ok: false, error });
    }
    expect(await suscripcion(local.id)).toEqual(antes);
    expect(contar("payments", `organization_id = '${local.id}'`)).toBe(0);
    expect(await auditoria(local.id)).toEqual([]);
  });

  it("la base valida por sí sola importe, moneda, medio, referencia y fechas", async () => {
    const local = await crearLocal({ finEnMs: -2 * DIA_MS });
    const antes = await suscripcion(local.id);
    const base = {
      p_actor: admin.id,
      p_org: local.id,
      p_amount_cents: 2000,
      p_currency: "ARS",
      p_method: "cash",
      p_reference: "",
      p_paid_on: hoyAr(),
      p_covers_until: new Date(Date.now() + 30 * DIA_MS).toISOString(),
    };
    const manana = new Date(Date.now() + DIA_MS * 1.5).toISOString().slice(0, 10);
    for (const [cambios, mensaje] of [
      [{ p_amount_cents: 0 }, "invalid_amount"],
      [{ p_amount_cents: -1 }, "invalid_amount"],
      [{ p_amount_cents: 100_000_000_001 }, "invalid_amount"],
      [{ p_currency: "EUR" }, "invalid_currency"],
      [{ p_method: "card" }, "invalid_method"],
      [{ p_reference: "x".repeat(121) }, "invalid_reference"],
      [{ p_paid_on: manana }, "invalid_paid_on"],
      [{ p_paid_on: "2020-01-01" }, "invalid_paid_on"],
      [{ p_covers_until: new Date(Date.now() + 800 * DIA_MS).toISOString() }, "invalid_period"],
      [{ p_covers_until: new Date(Date.now() - DIA_MS).toISOString() }, "payment_not_extending"],
      [{ p_covers_until: new Date(Date.now() - 2.5 * DIA_MS).toISOString() }, "payment_not_extending"],
    ] as const) {
      const r = await service.rpc("admin_register_payment", { ...base, ...cambios });
      expect(r.error?.message, JSON.stringify(cambios)).toBe(mensaje);
    }
    expect(await suscripcion(local.id)).toEqual(antes);
    expect(contar("payments", `organization_id = '${local.id}'`)).toBe(0);
    expect(await auditoria(local.id)).toEqual([]);
  });

  it("el pago se registra con el plan y el ciclo del momento: un cambio posterior no lo reescribe", async () => {
    const local = await crearLocal({ plan: "pro" });
    await registerPayment(ctx(admin), pago(local, { coversUntil: enDias(60) }));
    await changePlan(ctx(admin), { slug: local.slug, plan: "premium", billingCycle: "yearly", reason: "sube" });
    const fila = (await service.from("payments").select("plan_code, billing_cycle").eq("organization_id", local.id).single()).data!;
    expect(fila.plan_code).toBe("pro");
  });

  it("los pagos sobreviven al borrado de la organización (sin clave foránea, ADR 0027)", async () => {
    const local = await crearLocal();
    await registerPayment(ctx(admin), pago(local));
    const borrar = await service.from("organizations").delete().eq("id", local.id);
    expect(borrar.error).toBeNull();
    expect(contar("organizations", `id = '${local.id}'`)).toBe(0);
    expect(contar("payments", `organization_id = '${local.id}'`)).toBe(1);
    purgePaymentsWhere(`organization_id = '${local.id}'`); // limpieza de la prueba (huérfano)
  });
});

describe("la prueba gratuita como concepto aparte", () => {
  it("una organización nueva está en prueba, con su fecha propia, y el Dueño la ve", async () => {
    const id = (await service.from("organizations").insert({ slug: `tt-plan-${sufijo}-prueba`, name: "prueba" }).select("id").single()).data!.id;
    orgs.push(id);
    const owner = await createUser(service, "plan-prueba");
    users.push(owner);
    await addMembership(service, owner, id, "owner");

    const ent = await entitlements(owner, id);
    expect(ent).toMatchObject({ state: "active", trialStatus: "in_trial", plan: "basic" });
    expect(ent.trialEndsAt).toBeTruthy();
    expect(ent.suspendedManually).toBeUndefined(); // no está suspendida a mano
    const sub = await suscripcion(id);
    expect(sub.current_period_end).toBeNull();
    expect(sub.trial_ends_at).not.toBeNull();
  });

  it("la prueba vencida es «expired» y sigue la regla de mora desde su fin; no es otro estado de cuenta", async () => {
    const id = (await service.from("organizations").insert({ slug: `tt-plan-${sufijo}-vencida`, name: "vencida" }).select("id").single()).data!.id;
    orgs.push(id);
    const owner = await createUser(service, "plan-vencida");
    users.push(owner);
    await addMembership(service, owner, id, "owner");

    await service.from("subscriptions").update({ trial_ends_at: new Date(Date.now() - 3 * DIA_MS + HORA_MS).toISOString() }).eq("organization_id", id);
    expect(await entitlements(owner, id)).toMatchObject({ trialStatus: "expired", state: "grace" });
    await service.from("subscriptions").update({ trial_ends_at: new Date(Date.now() - 10 * DIA_MS).toISOString() }).eq("organization_id", id);
    expect(await entitlements(owner, id)).toMatchObject({ trialStatus: "expired", state: "read_only" });
    await service.from("subscriptions").update({ trial_ends_at: new Date(Date.now() - 20 * DIA_MS).toISOString() }).eq("organization_id", id);
    expect(await entitlements(owner, id)).toMatchObject({ trialStatus: "expired", state: "suspended" });
  });

  it("un pago durante la prueba la convierte en período propio, conserva la fecha de la prueba y extiende desde su fin", async () => {
    const id = (await service.from("organizations").insert({ slug: `tt-plan-${sufijo}-convierte`, name: "convierte" }).select("id").single()).data!.id;
    orgs.push(id);
    const owner = await createUser(service, "plan-convierte");
    users.push(owner);
    await addMembership(service, owner, id, "owner");
    const sub = await suscripcion(id);
    const slug = `tt-plan-${sufijo}-convierte`;

    expect(await registerPayment(ctx(admin), pago({ slug } as Local, { coversUntil: enDias(60) }))).toMatchObject({ ok: true });

    const despues = await suscripcion(id);
    expect(despues.trial_ends_at).toBe(sub.trial_ends_at); // la historia de la prueba no se pierde
    const ent = await entitlements(owner, id);
    expect(ent).toMatchObject({ trialStatus: "converted", state: "active" });
    const fila = (await service.from("payments").select("previous_period_end").eq("organization_id", id).single()).data!;
    expect(new Date(fila.previous_period_end).getTime()).toBe(new Date(sub.trial_ends_at!).getTime()); // el pago empieza donde termina la prueba
  });

  it("un alta con plan y fecha del SuperAdmin no tiene prueba; la prueba no se confunde con la mora", async () => {
    const local = await crearLocal({ finEnMs: -3 * DIA_MS + HORA_MS }); // venció un período propio: en gracia
    expect(await entitlements(local.owner, local.id)).toMatchObject({ trialStatus: "none", state: "grace" });
  });

  it("trialStatus de la aplicación coincide con private.trial_status de la base en los bordes", () => {
    const fin = "2026-10-10 15:00:00+00";
    const casos: Array<[string | null, string | null, string]> = [
      [null, null, "2026-10-10 15:00:00+00"],
      [null, "2026-11-01 00:00:00+00", "2026-10-10 15:00:00+00"],
      [fin, null, "2026-10-10 14:59:59+00"],
      [fin, null, "2026-10-10 15:00:00+00"],
      [fin, null, "2026-10-10 15:00:01+00"],
      [fin, "2026-11-01 00:00:00+00", "2026-10-10 15:00:01+00"],
    ];
    for (const [trial, periodo, instante] of casos) {
      const literal = (v: string | null) => (v ? `'${v}'::timestamptz` : "null::timestamptz");
      const base = sql(`select private.trial_status(${literal(trial)}, ${literal(periodo)}, '${instante}'::timestamptz)`)[0][0];
      const app = trialStatus(trial && new Date(trial), periodo && new Date(periodo), new Date(instante));
      expect(app, `${trial} ${periodo} ${instante}`).toBe(base);
    }
  });
});

describe("lectura para el SuperAdmin", () => {
  it("el detalle trae suscripción, prueba, suspensión, pagos y movimientos; el listado marca la suspensión", async () => {
    const local = await crearLocal({ finEnMs: 20 * DIA_MS });
    await registerPayment(ctx(admin), pago(local, { coversUntil: enDias(60) }));
    await changePlan(ctx(admin), { slug: local.slug, plan: "basic", billingCycle: "yearly", reason: "baja" });
    await setSuspension(ctx(admin), { slug: local.slug, suspend: true, reason: "pausa" });

    const detalle = await getOrganizationDetail(ctx(admin), local.slug);
    if (!detalle.ok) throw new Error(detalle.error);
    expect(detalle.data).toMatchObject({
      slug: local.slug,
      plan: "basic",
      billingCycle: "yearly",
      state: "suspended",
      trial: "none",
      ownerEmails: [local.owner.email],
    });
    expect(detalle.data.suspendedAt).not.toBeNull();
    expect(detalle.data.payments).toHaveLength(1);
    expect(detalle.data.audit.map((a) => a.action).sort()).toEqual(["payment.registered", "subscription.plan_changed", "subscription.suspended"]);

    const lista = await listOrganizations(ctx(admin));
    if (!lista.ok) throw new Error(lista.error);
    const fila = lista.data.find((o) => o.slug === local.slug)!;
    expect(fila).toMatchObject({ suspended: true, state: "suspended", datesState: "active" });
  });

  it("una organización que no existe da org_not_found", async () => {
    expect(await getOrganizationDetail(ctx(admin), "tt-plan-fantasma")).toEqual({ ok: false, error: "org_not_found" });
    expect(await getOrganizationDetail(ctx(admin), "NO VALE")).toEqual({ ok: false, error: "org_not_found" });
  });
});
