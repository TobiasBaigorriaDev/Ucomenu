import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminContext } from "@/lib/admin/organizations";
import { deleteOrphanAccount, listOrphanAccounts } from "@/lib/admin/orphan-accounts";
import { purgeAuditLogWhere } from "./purge-price-history";
import { addMembership, anonClient, createOrg, createUser, deleteOrg, deleteUser, serviceClient, sql, type Db, type TestUser } from "./helpers";

/**
 * Cuentas de Auth sin ningún local (nivel C, ficha cuentas-sin-local), contra el Supabase local y con los mismos clientes que usa el
 * servidor. El SuperAdmin las ve y borra una a mano, con el email escrito, el motivo y una constancia sin el email. Una cuenta con
 * membresía, de SuperAdmin o de menos de una hora no se borra; y mientras se borra, nadie le suma una membresía (reserva de la cuenta).
 */

const MOTIVO = "tt-csl limpieza de prueba";
const HACE_2_HORAS = "now() - interval '2 hours'";
let service: Db;
let superAdmin: TestUser;
let outsider: TestUser;
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

const adminCtx = (user: TestUser, admin: Db = service): AdminContext => ({ session: user.db, admin, actorId: user.id });
const existe = async (user: TestUser) => (await service.auth.admin.getUserById(user.id)).data.user !== null;
const reservas = (user: TestUser) => Number(sql(`select count(*) from private.account_leases where user_id = '${user.id}'`)[0][0]);
const movimientos = (user: TestUser) =>
  sql(`select count(*) from public.audit_log where action = 'account.deleted' and before->>'user_id' = '${user.id}'`)[0][0];

/** Una cuenta sin local y vieja (más de una hora), como las que deja el borrado de una organización. */
async function cuentaSinLocal(): Promise<TestUser> {
  contador += 1;
  const user = await createUser(service, `csl-${contador}`);
  users.push(user);
  sql(`update auth.users set created_at = ${HACE_2_HORAS} where id = '${user.id}'`);
  return user;
}

const borrar = (user: TestUser, extra: Partial<{ confirmEmail: string; reason: string; userId: string }> = {}, ctx = adminCtx(superAdmin)) =>
  deleteOrphanAccount(ctx, { userId: user.id, confirmEmail: user.email, reason: MOTIVO, ...extra });

/** El cliente de servicio con un gancho antes de `auth.admin.deleteUser`: una operación concurrente cae justo antes de borrar. */
function conGancho(db: Db, antesDeBorrar: () => Promise<void>): Db {
  const authAdmin = new Proxy(db.auth.admin, {
    get(destino, propiedad) {
      const valor = Reflect.get(destino, propiedad, destino);
      if (typeof valor !== "function") return valor;
      return async (...args: unknown[]) => {
        if (propiedad === "deleteUser") await antesDeBorrar();
        return valor.apply(destino, args);
      };
    },
  });
  const auth = new Proxy(db.auth, { get: (destino, propiedad) => (propiedad === "admin" ? authAdmin : Reflect.get(destino, propiedad, destino)) });
  return new Proxy(db, {
    get(destino, propiedad) {
      if (propiedad === "auth") return auth;
      const valor = Reflect.get(destino, propiedad, destino);
      return typeof valor === "function" ? valor.bind(destino) : valor;
    },
  });
}

beforeAll(async () => {
  service = serviceClient();
  superAdmin = await createUser(service, "csl-admin");
  outsider = await createUser(service, "csl-ajeno");
  users.push(superAdmin, outsider);
  sql(`insert into public.platform_admins (user_id) values ('${superAdmin.id}')`);
});

afterAll(async () => {
  purgeAuditLogWhere(`action = 'account.deleted' and after->>'reason' like 'tt-csl%'`);
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("la lista de cuentas sin local", () => {
  it("muestra la cuenta vieja sin membresías y deja afuera las nuevas, las de un local y las de SuperAdmin", async () => {
    const vieja = await cuentaSinLocal();
    const reciente = await createUser(service, "csl-reciente");
    const conLocal = await cuentaSinLocal();
    const admin = await cuentaSinLocal();
    users.push(reciente);
    const orgId = await createOrg(service, `tt-csl-${Date.now()}`, "pro");
    orgs.push(orgId);
    await addMembership(service, conLocal, orgId, "staff");
    sql(`insert into public.platform_admins (user_id) values ('${admin.id}')`);

    const lista = await listOrphanAccounts(adminCtx(superAdmin));
    expect(lista.ok).toBe(true);
    if (!lista.ok) return;
    const ids = lista.data.map((c) => c.userId);
    expect(ids).toContain(vieja.id);
    expect(ids).not.toContain(reciente.id); // puede estar en medio de un alta
    expect(ids).not.toContain(conLocal.id);
    expect(ids).not.toContain(admin.id);
    expect(lista.data.find((c) => c.userId === vieja.id)).toMatchObject({ email: vieja.email, lastSignInAt: expect.any(String) });
  });

  it("una cuenta con una reserva vigente no se lista", async () => {
    const reservada = await cuentaSinLocal();
    sql(`insert into private.account_leases (user_id, purpose, expires_at) values ('${reservada.id}', 'password_reset', now() + interval '2 minutes')`);
    const lista = await listOrphanAccounts(adminCtx(superAdmin));
    expect(lista.ok && lista.data.map((c) => c.userId)).not.toContain(reservada.id);
  });

  it("quien no es SuperAdmin no la ve: ni por la aplicación ni llamando a la función; anon y authenticated no la ejecutan", async () => {
    expect(await listOrphanAccounts(adminCtx(outsider))).toEqual({ ok: false, error: "forbidden" });
    const directo = await service.rpc("admin_list_orphan_accounts", { p_actor: outsider.id });
    expect(directo.error?.code).toBe("42501");
    for (const [nombre, db] of [["anon", anonClient()], ["autenticado", outsider.db]] as const) {
      expect((await db.rpc("admin_list_orphan_accounts", { p_actor: superAdmin.id })).error?.code, nombre).toBe("42501");
    }
  });
});

describe("borrar una cuenta sin local", () => {
  it("la borra de Auth con el email escrito (sin distinguir mayúsculas), audita sin el email y no deja reserva", async () => {
    const cuenta = await cuentaSinLocal();
    expect(await borrar(cuenta, { confirmEmail: `  ${cuenta.email.toUpperCase()} ` })).toEqual({ ok: true, data: undefined });
    expect(await existe(cuenta)).toBe(false);
    expect(reservas(cuenta)).toBe(0);
    expect(movimientos(cuenta)).toBe("1");
    const fila = sql(`select actor_id, before::text, after::text, coalesce(organization_id::text, '') from public.audit_log where action = 'account.deleted' and before->>'user_id' = '${cuenta.id}'`)[0];
    expect(fila[0]).toBe(superAdmin.id);
    expect(fila[1] + fila[2]).not.toContain(cuenta.email);
    expect(fila[2]).toContain(MOTIVO);
    expect(fila[3]).toBe("");
  });

  it("con otro email, sin motivo o con un id inexistente no borra nada", async () => {
    const cuenta = await cuentaSinLocal();
    expect(await borrar(cuenta, { confirmEmail: outsider.email })).toEqual({ ok: false, error: "orphan_email_mismatch" });
    expect(await borrar(cuenta, { confirmEmail: "" })).toEqual({ ok: false, error: "orphan_email_mismatch" });
    expect(await borrar(cuenta, { reason: "   " })).toEqual({ ok: false, error: "invalid_reason" });
    expect(await borrar(cuenta, { userId: "no-es-un-uuid" })).toEqual({ ok: false, error: "orphan_not_found" });
    expect(await borrar(cuenta, { userId: "00000000-0000-4000-8000-0000000000ff" })).toEqual({ ok: false, error: "orphan_not_found" });
    expect(await existe(cuenta)).toBe(true);
    expect(movimientos(cuenta)).toBe("0");
  });

  it("una cuenta con membresía, de SuperAdmin o de menos de una hora no se borra", async () => {
    const orgId = await createOrg(service, `tt-csl-m-${Date.now()}`, "pro");
    orgs.push(orgId);
    const conLocal = await cuentaSinLocal();
    await addMembership(service, conLocal, orgId, "staff");
    const admin = await cuentaSinLocal();
    sql(`insert into public.platform_admins (user_id) values ('${admin.id}')`);
    const reciente = await createUser(service, "csl-reciente-b");
    users.push(reciente);

    expect(await borrar(conLocal)).toEqual({ ok: false, error: "orphan_not_orphan" });
    expect(await borrar(admin)).toEqual({ ok: false, error: "orphan_not_orphan" });
    expect(await borrar(reciente)).toEqual({ ok: false, error: "orphan_too_recent" });
    for (const u of [conLocal, admin, reciente]) expect(await existe(u), u.email).toBe(true);
  });

  it("quien no es SuperAdmin no borra, ni por la aplicación ni llamando a las funciones", async () => {
    const cuenta = await cuentaSinLocal();
    expect(await borrar(cuenta, {}, adminCtx(outsider))).toEqual({ ok: false, error: "forbidden" });
    const directo = await service.rpc("admin_begin_orphan_delete", { p_actor: outsider.id, p_user: cuenta.id, p_email: cuenta.email, p_reason: MOTIVO });
    expect(directo.error?.code).toBe("42501");
    for (const [nombre, db] of [["anon", anonClient()], ["autenticado", outsider.db]] as const) {
      const r = await db.rpc("admin_begin_orphan_delete", { p_actor: superAdmin.id, p_user: cuenta.id, p_email: cuenta.email, p_reason: MOTIVO });
      expect(r.error?.code, nombre).toBe("42501");
      const c = await db.rpc("admin_record_account_deleted", { p_actor: superAdmin.id, p_user: cuenta.id, p_reason: MOTIVO });
      expect(c.error?.code, `${nombre} constancia`).toBe("42501");
    }
    expect(await existe(cuenta)).toBe(true);
    expect(reservas(cuenta)).toBe(0);
  });

  it("con una reserva vigente de otra operación no se borra", async () => {
    const cuenta = await cuentaSinLocal();
    sql(`insert into private.account_leases (user_id, purpose, expires_at) values ('${cuenta.id}', 'password_reset', now() + interval '2 minutes')`);
    expect(await borrar(cuenta)).toEqual({ ok: false, error: "orphan_busy" });
    expect(await existe(cuenta)).toBe(true);
  });

  it("mientras se borra, nadie le suma una membresía (reserva); y tras borrarla no queda nada", async () => {
    const cuenta = await cuentaSinLocal();
    const orgId = await createOrg(service, `tt-csl-r-${Date.now()}`, "pro");
    orgs.push(orgId);
    let intento: { code?: string; message?: string } | null = null;
    const ctx = adminCtx(superAdmin, conGancho(service, async () => {
      // Justo entre la reserva y la llamada a Auth, otro camino intenta sumar la cuenta a un local.
      const r = await service.from("memberships").insert({ user_id: cuenta.id, organization_id: orgId, role: "staff" });
      intento = r.error;
    }));
    expect(await borrar(cuenta, {}, ctx)).toEqual({ ok: true, data: undefined });
    expect(intento).toMatchObject({ code: "55006" });
    expect(await existe(cuenta)).toBe(false);
    expect(sql(`select count(*) from public.memberships where organization_id = '${orgId}'`)[0][0]).toBe("0");
  });

  it("si la membresía entra antes de la reserva, la cuenta deja de estar sin local y no se borra", async () => {
    const cuenta = await cuentaSinLocal();
    const orgId = await createOrg(service, `tt-csl-a-${Date.now()}`, "pro");
    orgs.push(orgId);
    await addMembership(service, cuenta, orgId, "staff");
    expect(await borrar(cuenta)).toEqual({ ok: false, error: "orphan_not_orphan" });
    expect(await existe(cuenta)).toBe(true);
    expect(reservas(cuenta)).toBe(0);
  });

  it("la constancia solo se escribe para una cuenta que ya no existe y una sola vez", async () => {
    const viva = await cuentaSinLocal();
    const antes = await service.rpc("admin_record_account_deleted", { p_actor: superAdmin.id, p_user: viva.id, p_reason: MOTIVO });
    expect(antes.error?.code).toBe("55000");
    expect(movimientos(viva)).toBe("0");

    const borrada = await cuentaSinLocal();
    expect(await borrar(borrada)).toEqual({ ok: true, data: undefined });
    const otra = await service.rpc("admin_record_account_deleted", { p_actor: superAdmin.id, p_user: borrada.id, p_reason: MOTIVO });
    expect(otra.data).toEqual({ status: "already_recorded" });
    expect(movimientos(borrada)).toBe("1");
  });
});
