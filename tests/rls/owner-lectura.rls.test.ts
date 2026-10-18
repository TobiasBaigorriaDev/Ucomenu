import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminContext } from "@/lib/admin/organizations";
import { addExistingOwner } from "@/lib/admin/owners";
import { changePlan, registerPayment, setSuspension } from "@/lib/admin/subscriptions";
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
 * El Dueño lee los pagos y el historial de cambios de SU cuenta (nivel C; ficha dueno-lee-pagos-y-auditoria, ADR 0021)
 * contra el Supabase local. El foco es lo que NO debe salir (quién del equipo actuó, motivos internos, ids y locales de
 * terceros), quién no recibe nada y que las tablas siguen cerradas.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const enDias = (dias: number) => new Date(Date.now() + dias * DIA_MS).toISOString().slice(0, 10);
const hoyAr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
const MOTIVO_INTERNO = `nota-interna-solo-del-equipo-${sufijo}`;
const REFERENCIA = `op-visible-${sufijo}`;

let service: Db;
let admin: TestUser; // SuperAdmin que hace los cambios
let adminSinMembresia: TestUser; // otro SuperAdmin, sin rol en el local
let comun: TestUser;
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

type Local = { id: string; slug: string; owner: TestUser; owner2: TestUser; staff: TestUser };

const ctx = (user: TestUser): AdminContext => ({ session: user.db, admin: service, actorId: user.id });

async function crearLocal(opciones: { finEnMs?: number } = {}): Promise<Local> {
  contador += 1;
  const slug = `tt-lectura-${sufijo}-${contador}`;
  const id = await createOrg(service, slug, "pro");
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: opciones.finEnMs ?? 30 * DIA_MS });
  const [owner, owner2, staff] = await Promise.all([
    createUser(service, `lec-d${contador}`),
    createUser(service, `lec-e${contador}`),
    createUser(service, `lec-s${contador}`),
  ]);
  users.push(owner, owner2, staff);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, owner2, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, slug, owner, owner2, staff };
}

const pago = (local: Local, dias: number, cambios: Record<string, string> = {}) => ({
  slug: local.slug,
  amount: "20000",
  currency: "ARS",
  method: "transfer",
  reference: REFERENCIA,
  paidOn: hoyAr(),
  coversUntil: enDias(dias),
  ...cambios,
});

const pagos = (db: Db, org: string, extra: { p_limit?: number; p_before?: string } = {}) =>
  db.rpc("owner_payments", { p_org: org, ...extra });
const historial = (db: Db, org: string, extra: { p_limit?: number; p_before?: string } = {}) =>
  db.rpc("owner_account_history", { p_org: org, ...extra });

/** Un local con un movimiento de cada tipo, hechos como los hace el servidor (por las funciones de SuperAdmin). */
async function localConHistoria(): Promise<Local> {
  const local = await crearLocal();
  expect((await registerPayment(ctx(admin), pago(local, 30))).ok).toBe(true);
  expect((await changePlan(ctx(admin), { slug: local.slug, plan: "premium", billingCycle: "yearly", reason: MOTIVO_INTERNO })).ok).toBe(true);
  expect((await setSuspension(ctx(admin), { slug: local.slug, suspend: true, reason: MOTIVO_INTERNO })).ok).toBe(true);
  expect((await setSuspension(ctx(admin), { slug: local.slug, suspend: false, reason: MOTIVO_INTERNO })).ok).toBe(true);
  return local;
}

beforeAll(async () => {
  service = serviceClient();
  admin = await createUser(service, "lec-admin");
  adminSinMembresia = await createUser(service, "lec-admin2");
  comun = await createUser(service, "lec-comun");
  users.push(admin, adminSinMembresia, comun);
  sql(`insert into public.platform_admins (user_id) values ('${admin.id}'), ('${adminSinMembresia.id}')`);
});

afterAll(async () => {
  purgeAuditLogWhere(`after->>'slug' like 'tt-lectura-%' or after->>'slug' like 'tt-oculto-%'`);
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("quién recibe filas", () => {
  it("el Dueño ve los pagos y el historial de su organización; el otro Dueño de la misma, lo mismo", async () => {
    const local = await localConHistoria();
    for (const dueno of [local.owner, local.owner2]) {
      const p = await pagos(dueno.db, local.id);
      expect(p.error).toBeNull();
      expect(p.data).toHaveLength(1);
      expect(p.data![0]).toMatchObject({ plan_code: "pro", billing_cycle: "monthly", amount_cents: 2_000_000, currency: "ARS", method: "transfer", reference: REFERENCIA });
      const h = await historial(dueno.db, local.id);
      expect(h.error).toBeNull();
      // Del más nuevo al más viejo: reactivación, suspensión, cambio de plan, pago.
      expect(h.data!.map((fila) => fila.action)).toEqual([
        "subscription.reactivated",
        "subscription.suspended",
        "subscription.plan_changed",
        "payment.registered",
      ]);
    }
  });

  it("nadie más recibe nada: Staff, Dueño de otro local, sin rol, SuperAdmin sin membresía y anon", async () => {
    const local = await localConHistoria();
    const otro = await crearLocal();
    for (const [nombre, db] of [
      ["Staff del mismo local", local.staff.db],
      ["Dueño de otro local", otro.owner.db],
      ["sin rol", comun.db],
      ["SuperAdmin sin membresía", adminSinMembresia.db],
      ["SuperAdmin que hizo los cambios", admin.db],
    ] as const) {
      const p = await pagos(db, local.id);
      const h = await historial(db, local.id);
      expect([nombre, p.error, p.data], nombre).toEqual([nombre, null, []]);
      expect([nombre, h.error, h.data], nombre).toEqual([nombre, null, []]);
    }
    // anon: ni siquiera puede ejecutar las funciones.
    expect((await pagos(anonClient(), local.id)).error).not.toBeNull();
    expect((await historial(anonClient(), local.id)).error).not.toBeNull();
    // Un local inexistente o un parámetro nulo se ven igual que uno ajeno: vacío.
    expect((await pagos(local.owner.db, "00000000-0000-4000-8000-0000000000aa")).data).toEqual([]);
    expect((await historial(local.owner.db, null as unknown as string)).data).toEqual([]);
  });

  it("cada Dueño ve solo lo suyo aunque haya historia en varios locales", async () => {
    const a = await localConHistoria();
    const b = await crearLocal();
    expect((await registerPayment(ctx(admin), pago(b, 45, { amount: "999" }))).ok).toBe(true);
    const deA = (await pagos(a.owner.db, a.id)).data!;
    const deB = (await pagos(b.owner.db, b.id)).data!;
    expect(deA).toHaveLength(1);
    expect(deB).toHaveLength(1);
    expect(deB[0].amount_cents).toBe(99_900);
    expect((await pagos(a.owner.db, b.id)).data).toEqual([]);
    expect((await historial(b.owner.db, a.id)).data).toEqual([]);
  });

  it("quien deja de ser Dueño deja de ver todo al instante; con la cuenta vencida o suspendida el Dueño sigue viendo", async () => {
    const local = await localConHistoria();
    expect((await pagos(local.owner2.db, local.id)).data).toHaveLength(1);
    sql(`delete from public.memberships where user_id = '${local.owner2.id}' and organization_id = '${local.id}'`);
    expect((await pagos(local.owner2.db, local.id)).data).toEqual([]);
    expect((await historial(local.owner2.db, local.id)).data).toEqual([]);

    // Pasa a Staff: tampoco.
    await addMembership(service, local.owner2, local.id, "staff");
    expect((await pagos(local.owner2.db, local.id)).data).toEqual([]);

    // Vencida hace mucho y suspendida a mano: justo cuando más lo necesita, sigue viendo su historia.
    await setSubscription(service, local.id, { finEnMs: -200 * DIA_MS });
    expect((await setSuspension(ctx(admin), { slug: local.slug, suspend: true, reason: MOTIVO_INTERNO })).ok).toBe(true);
    expect((await pagos(local.owner.db, local.id)).data).toHaveLength(1);
    expect((await historial(local.owner.db, local.id)).data!.length).toBeGreaterThan(0);
  });
});

describe("qué NO sale", () => {
  it("la respuesta tiene exactamente las columnas previstas y ni rastro del equipo, de los motivos ni de terceros", async () => {
    const local = await localConHistoria();
    // Un Dueño nuevo que además trabaja en OTRO local: el audit guarda ese local, la respuesta no debe mostrarlo.
    const tercero = await createUser(service, "lec-tercero");
    users.push(tercero);
    const ajeno = `tt-oculto-${sufijo}`;
    const idAjeno = await createOrg(service, ajeno, "basic");
    orgs.push(idAjeno);
    await addMembership(service, tercero, idAjeno, "staff");
    const sumado = await addExistingOwner(ctx(admin), { slug: local.slug, email: tercero.email, confirmed: true, expectedUserId: tercero.id });
    expect(sumado.ok).toBe(true);
    // Esa fila de auditoría SÍ guarda el local ajeno (lo comprueba la fuente, para que la prueba no sea vacía).
    expect(sql(`select count(*) from public.audit_log where organization_id = '${local.id}' and before::text like '%${ajeno}%'`)[0][0]).toBe("1");

    const p = await pagos(local.owner.db, local.id);
    const h = await historial(local.owner.db, local.id);
    expect(Object.keys(p.data![0]).sort()).toEqual(
      ["amount_cents", "billing_cycle", "covers_until", "created_at", "currency", "id", "method", "paid_on", "plan_code", "previous_period_end", "reference"].sort(),
    );
    for (const fila of h.data!) expect(Object.keys(fila).sort()).toEqual(["action", "created_at", "detail", "id"]);

    const crudo = JSON.stringify({ p: p.data, h: h.data });
    for (const secreto of [admin.id, admin.email, tercero.id, tercero.email, MOTIVO_INTERNO, ajeno, "registered_by", "actor", "owner_user_id", "reason", "slug", local.slug]) {
      expect(crudo.includes(secreto), `no debería salir «${secreto}»`).toBe(false);
    }
  });

  it("el detalle de cada acción es el previsto y nada más", async () => {
    const local = await localConHistoria();
    const tercero = await createUser(service, "lec-sumado");
    users.push(tercero);
    expect((await addExistingOwner(ctx(admin), { slug: local.slug, email: tercero.email, confirmed: true, expectedUserId: tercero.id })).ok).toBe(true);
    const h = (await historial(local.owner.db, local.id)).data!;
    const por = (accion: string) => h.find((fila) => fila.action === accion)!.detail as Record<string, unknown>;

    expect(por("owner.added")).toEqual({ promoted: false });
    expect(por("subscription.suspended")).toEqual({});
    expect(por("subscription.reactivated")).toEqual({ state: expect.any(String) });
    expect(por("subscription.plan_changed")).toEqual({ from_plan: "pro", from_billing_cycle: "monthly", plan: "premium", billing_cycle: "yearly" });
    expect(Object.keys(por("payment.registered")).sort()).toEqual(
      ["amount_cents", "billing_cycle", "currency", "method", "paid_on", "period_end", "plan", "previous_period_end"].sort(),
    );
    expect(por("payment.registered")).toMatchObject({ amount_cents: 2_000_000, currency: "ARS", method: "transfer", plan: "pro", billing_cycle: "monthly" });
  });

  it("el alta guarda más datos de los que salen: del Dueño y del nombre del local no sale nada", async () => {
    const local = await crearLocal();
    const intruso = "00000000-0000-4000-8000-00000000beef";
    sql(
      `insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after) values ` +
        `('${admin.id}', '${admin.email}', 'organization.created', '${local.id}', null, ` +
        `'{"slug":"${local.slug}","name":"Nombre interno del cliente","plan":"pro","billing_cycle":"monthly","period_end":"2030-01-01T00:00:00Z","owner_user_id":"${intruso}","branch":{"slug":"x","name":"y"}}')`,
    );
    const h = (await historial(local.owner.db, local.id)).data!;
    expect(h).toHaveLength(1);
    expect(h[0].detail).toEqual({ plan: "pro", billing_cycle: "monthly", period_end: "2030-01-01T00:00:00Z" });
    expect(JSON.stringify(h)).not.toContain(intruso);
    expect(JSON.stringify(h)).not.toContain("Nombre interno");
  });

  it("una acción de auditoría que no está en la lista blanca no se muestra (aunque la base la permita)", async () => {
    const local = await crearLocal();
    const original = sql(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'audit_log_action_check'`)[0][0];
    try {
      sql(
        `alter table public.audit_log drop constraint audit_log_action_check; ` +
          `alter table public.audit_log add constraint audit_log_action_check check (action in ('organization.created','subscription.plan_changed','subscription.suspended','subscription.reactivated','payment.registered','owner.added','internal.note'))`,
      );
      sql(
        `insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after) values ` +
          `('${admin.id}', '${admin.email}', 'internal.note', '${local.id}', null, '{"slug":"${local.slug}","nota":"no debería verse"}')`,
      );
      expect((await historial(local.owner.db, local.id)).data).toEqual([]);
    } finally {
      purgeAuditLogWhere(`action = 'internal.note'`);
      sql(`alter table public.audit_log drop constraint audit_log_action_check; alter table public.audit_log add constraint audit_log_action_check ${original}`);
    }
    expect(sql(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'audit_log_action_check'`)[0][0]).toBe(original);
  });
});

describe("paginación", () => {
  it("«Ver más» pide los anteriores a una fecha sin repetir ni saltar; un tope fuera de rango se acota", async () => {
    const local = await crearLocal();
    for (const dias of [30, 60, 90]) expect((await registerPayment(ctx(admin), pago(local, dias, { amount: String(dias) }))).ok).toBe(true);

    const todos = (await pagos(local.owner.db, local.id)).data!;
    expect(todos.map((p) => p.amount_cents)).toEqual([9_000, 6_000, 3_000]); // el más nuevo primero

    const primera = (await pagos(local.owner.db, local.id, { p_limit: 2 })).data!;
    expect(primera.map((p) => p.amount_cents)).toEqual([9_000, 6_000]);
    const resto = (await pagos(local.owner.db, local.id, { p_limit: 2, p_before: primera[1].created_at })).data!;
    expect(resto.map((p) => p.amount_cents)).toEqual([3_000]);

    expect((await pagos(local.owner.db, local.id, { p_limit: 0 })).data).toHaveLength(1); // mínimo 1
    expect((await pagos(local.owner.db, local.id, { p_limit: -5 })).data).toHaveLength(1);
    expect((await pagos(local.owner.db, local.id, { p_limit: 1_000_000 })).data).toHaveLength(3); // tope 100, no explota
    expect((await historial(local.owner.db, local.id, { p_limit: 1 })).data).toHaveLength(1);
    const antiguo = (await pagos(local.owner.db, local.id, { p_before: "2000-01-01T00:00:00Z" })).data;
    expect(antiguo).toEqual([]);
  });

  it("el tope por pedido es 100", async () => {
    const local = await crearLocal();
    // 105 movimientos de auditoría de un local propio: se ve que nunca vuelven más de 100.
    sql(
      `insert into public.audit_log (actor_id, actor_email, action, organization_id, before, after) ` +
        `select '${admin.id}', '${admin.email}', 'subscription.suspended', '${local.id}', null, '{"slug":"${local.slug}"}'::jsonb from generate_series(1, 105)`,
    );
    expect((await historial(local.owner.db, local.id, { p_limit: 100_000 })).data).toHaveLength(100);
  });
});

describe("las tablas siguen cerradas", () => {
  it("el Dueño no lee ni escribe payments y audit_log por la API, ni siquiera lo suyo", async () => {
    const local = await localConHistoria();
    const foto = () =>
      [
        sql(`select count(*), coalesce(sum(amount_cents), 0) from public.payments where organization_id = '${local.id}'`)[0].join("|"),
        sql(`select count(*), string_agg(action, ',' order by created_at) from public.audit_log where organization_id = '${local.id}'`)[0].join("|"),
      ].join(" / ");
    const antes = foto();
    for (const tabla of ["payments", "audit_log"] as const) {
      const lectura = await local.owner.db.from(tabla).select("*");
      expect([tabla, lectura.error, lectura.data], tabla).toEqual([tabla, null, []]);
      expect((await local.owner.db.from(tabla).insert({ organization_id: local.id } as never)).error, `${tabla}: insert`).not.toBeNull();
      await local.owner.db.from(tabla).update({ organization_id: local.id } as never).eq("organization_id", local.id);
      await local.owner.db.from(tabla).delete().eq("organization_id", local.id);
    }
    expect(foto()).toBe(antes); // ni un cambio ni un borrado llegó a la tabla
  });

  it("las funciones no escriben: el estado de la cuenta es el mismo antes y después de leer", async () => {
    const local = await localConHistoria();
    const antes = sql(`select count(*) from public.audit_log where organization_id = '${local.id}'`)[0][0];
    const sub = sql(`select current_period_end::text, plan_code from public.subscriptions where organization_id = '${local.id}'`)[0].join("|");
    await pagos(local.owner.db, local.id);
    await historial(local.owner.db, local.id);
    expect(sql(`select count(*) from public.audit_log where organization_id = '${local.id}'`)[0][0]).toBe(antes);
    expect(sql(`select current_period_end::text, plan_code from public.subscriptions where organization_id = '${local.id}'`)[0].join("|")).toBe(sub);
  });
});
