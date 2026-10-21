import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addExistingOwner } from "@/lib/admin/owners";
import type { AdminContext } from "@/lib/admin/organizations";
import { listMembers, removeMember, resetMemberPassword, setMemberRole, type PersonnelContext } from "@/lib/personnel";
import { purgeAuditLogWhere } from "./purge-price-history";
import {
  addMembership,
  anonClient,
  createOrg,
  createUser,
  deleteOrg,
  deleteUser,
  serviceClient,
  sql,
  TEST_PASSWORD,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * Cuentas globales de Auth frente a la gestión de personal (nivel C, ficha proteger-cuentas-globales), contra el Supabase
 * local y con los mismos clientes que usa el servidor.
 *  - Un Dueño no cambia la contraseña ni borra la cuenta de un SuperAdmin, tampoco después de bajarlo a Staff.
 *  - Una cuenta recién sumada a otro local no puede tomarse ni borrarse desde el primero. Las intercalaciones son
 *    DETERMINISTAS: un «gancho» ejecuta el `admin_add_owner` justo entre dos pasos del módulo (no se espera a la suerte), y
 *    dos pruebas retienen una transacción real de Postgres para demostrar que el lock bloquea, no que se vio un SELECT.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const NUEVA = "otra-contrasena-larga-1";
let service: Db;
let superAdmin: TestUser;
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

const adminCtx = (user: TestUser): AdminContext => ({ session: user.db, admin: service, actorId: user.id });
const personalCtx = (user: TestUser, admin: Db = service): PersonnelContext => ({ session: user.db, admin, actorId: user.id });

const cuentaExiste = async (user: TestUser) => (await service.auth.admin.getUserById(user.id)).data.user !== null;
const puedeEntrar = async (user: TestUser, password: string) =>
  (await anonClient().auth.signInWithPassword({ email: user.email, password })).error === null;
const hash = (user: TestUser) => sql(`select encrypted_password from auth.users where id = '${user.id}'`)[0]?.[0] ?? null;
const rol = (orgId: string, user: TestUser) =>
  sql(`select role from public.memberships where organization_id = '${orgId}' and user_id = '${user.id}'`)[0]?.[0] ?? null;
const membresiaId = (orgId: string, user: TestUser) =>
  sql(`select id from public.memberships where organization_id = '${orgId}' and user_id = '${user.id}'`)[0]?.[0] as string;
const esSuperAdmin = (user: TestUser) => sql(`select count(*) from public.platform_admins where user_id = '${user.id}'`)[0][0] === "1";
const reservas = (user: TestUser) => Number(sql(`select count(*) from private.account_leases where user_id = '${user.id}'`)[0][0]);

type Local = { id: string; slug: string; owner: TestUser; staff: TestUser };

/** Una organización propia con un Dueño y un Personal. */
async function crearLocal(): Promise<Local> {
  contador += 1;
  const slug = `tt-cgl-${sufijo}-${contador}`;
  const id = await createOrg(service, slug, "pro");
  orgs.push(id);
  const owner = await createUser(service, `cgl-d${contador}`);
  const staff = await createUser(service, `cgl-s${contador}`);
  users.push(owner, staff);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, slug, owner, staff };
}

/** El SuperAdmin suma la cuenta de `user` como Dueño de `destino` (con la confirmación de dos pasos ya hecha). */
const sumarComoDueno = (destino: Local, user: TestUser) =>
  addExistingOwner(adminCtx(superAdmin), { slug: destino.slug, email: user.email, confirmed: true, expectedUserId: user.id });

/**
 * El cliente de servicio con «ganchos»: antes de cada llamada a `rpc:<función>` o `auth:<método>` corre lo que diga la
 * prueba. Así una operación concurrente cae EXACTAMENTE entre dos pasos del módulo, siempre en el mismo orden.
 */
function conGanchos(db: Db, ganchos: Record<string, () => Promise<void>>): Db {
  const authAdmin = new Proxy(db.auth.admin, {
    get(destino, propiedad) {
      const valor = Reflect.get(destino, propiedad, destino);
      if (typeof valor !== "function") return valor;
      return async (...args: unknown[]) => {
        await ganchos[`auth:${String(propiedad)}`]?.();
        return valor.apply(destino, args);
      };
    },
  });
  const auth = new Proxy(db.auth, {
    get: (destino, propiedad) => (propiedad === "admin" ? authAdmin : Reflect.get(destino, propiedad, destino)),
  });
  return new Proxy(db, {
    get(destino, propiedad) {
      if (propiedad === "auth") return auth;
      if (propiedad === "rpc") {
        return async (nombre: string, ...resto: unknown[]) => {
          await ganchos[`rpc:${nombre}`]?.();
          return (destino.rpc as (...a: unknown[]) => unknown).call(destino, nombre, ...resto);
        };
      }
      const valor = Reflect.get(destino, propiedad, destino);
      return typeof valor === "function" ? valor.bind(destino) : valor;
    },
  });
}

const CONTENEDOR = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
const NL = String.fromCharCode(10);

/** Una transacción real de Postgres que se deja abierta hasta `confirmar()`. */
function retener(sentencias: string) {
  const proceso = spawn("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-q", "-v", "ON_ERROR_STOP=1"], {
    stdio: ["pipe", "ignore", "ignore"],
  });
  const terminado = new Promise<number | null>((resolve) => proceso.on("close", resolve));
  proceso.stdin.write(`begin; ${sentencias}${NL}`);
  return {
    confirmar: async () => {
      proceso.stdin.end(`commit;${NL}`);
      return terminado;
    },
  };
}

async function hasta(descripcion: string, consulta: string) {
  for (let i = 0; i < 100; i++) {
    if (sql(consulta)[0]?.[0] === "1") return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No se alcanzó: ${descripcion}`);
}
const transaccionAbierta = (fragmento: string) =>
  hasta("la transacción retenida está abierta", `select (count(*) > 0)::int from pg_stat_activity where state = 'idle in transaction' and query ilike '%${fragmento}%'`);
const esperandoLock = (fragmento: string) =>
  hasta("el pedido espera el lock", `select (count(*) > 0)::int from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%${fragmento}%' and pid <> pg_backend_pid()`);

beforeAll(async () => {
  service = serviceClient();
  superAdmin = await createUser(service, "cgl-admin");
  users.push(superAdmin);
  sql(`insert into public.platform_admins (user_id) values ('${superAdmin.id}')`);
});

afterAll(async () => {
  purgeAuditLogWhere(`after->>'slug' like 'tt-cgl-%'`);
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("una cuenta de SuperAdmin no se toma desde un local", () => {
  /** Un local donde el SuperAdmin trabaja (como Dueño, y es el único local de su cuenta). */
  async function localConSuperAdmin() {
    const local = await crearLocal();
    const admin = await createUser(service, `cgl-sa${contador}`);
    users.push(admin);
    sql(`insert into public.platform_admins (user_id) values ('${admin.id}')`);
    await addMembership(service, admin, local.id, "owner");
    return { local, admin };
  }

  it("bajarlo a Staff y restablecer su contraseña: se rechaza y la contraseña no cambia", async () => {
    const { local, admin } = await localConSuperAdmin();
    const antes = hash(admin);

    expect(await setMemberRole(personalCtx(local.owner), local.id, membresiaId(local.id, admin), "staff")).toEqual({ ok: true, data: undefined });
    expect(rol(local.id, admin)).toBe("staff"); // ya no es Dueño: la guarda de «un Dueño» no lo frena
    const r = await resetMemberPassword(personalCtx(local.owner), local.id, membresiaId(local.id, admin), NUEVA);

    expect(r).toEqual({ ok: false, error: "shared_account" });
    expect(hash(admin)).toBe(antes);
    expect(await puedeEntrar(admin, TEST_PASSWORD)).toBe(true);
    expect(await puedeEntrar(admin, NUEVA)).toBe(false);
    expect(reservas(admin)).toBe(0);
  });

  it("un SuperAdmin que ya era Staff de un local tampoco: se rechaza sin distinguirlo de una cuenta compartida", async () => {
    const local = await crearLocal();
    const admin = await createUser(service, `cgl-sa-staff${contador}`);
    users.push(admin);
    sql(`insert into public.platform_admins (user_id) values ('${admin.id}')`);
    await addMembership(service, admin, local.id, "staff");

    const r = await resetMemberPassword(personalCtx(local.owner), local.id, membresiaId(local.id, admin), NUEVA);

    expect(r).toEqual({ ok: false, error: "shared_account" });
    expect(await puedeEntrar(admin, TEST_PASSWORD)).toBe(true);
  });

  it("la baja del personal le quita el local pero conserva su cuenta, su sesión posible y su rol de SuperAdmin", async () => {
    const { local, admin } = await localConSuperAdmin();
    expect(await setMemberRole(personalCtx(local.owner), local.id, membresiaId(local.id, admin), "staff")).toEqual({ ok: true, data: undefined });

    const r = await removeMember(personalCtx(local.owner), local.id, membresiaId(local.id, admin));

    expect(r).toEqual({ ok: true, data: undefined });
    expect(rol(local.id, admin)).toBeNull();
    expect(await cuentaExiste(admin)).toBe(true);
    expect(esSuperAdmin(admin)).toBe(true);
    expect(await puedeEntrar(admin, TEST_PASSWORD)).toBe(true);
    expect(reservas(admin)).toBe(0);
  });

  it("el listado marca la cuenta de SuperAdmin como no editable desde el local (la pantalla no ofrece cambiar la contraseña)", async () => {
    const { local, admin } = await localConSuperAdmin();
    await setMemberRole(personalCtx(local.owner), local.id, membresiaId(local.id, admin), "staff");

    const lista = await listMembers(personalCtx(local.owner), local.id);

    expect(lista.ok && lista.data.find((m) => m.userId === admin.id)?.sharedAccount).toBe(true);
    expect(lista.ok && lista.data.find((m) => m.userId === local.staff.id)?.sharedAccount).toBe(false);
  });

  it("la función de base lo rechaza aunque se la llame directo con la clave de servicio", async () => {
    const { local, admin } = await localConSuperAdmin();
    await setMemberRole(personalCtx(local.owner), local.id, membresiaId(local.id, admin), "staff");

    const reset = await service.rpc("personnel_begin_reset", { p_actor: local.owner.id, p_org: local.id, p_membership: membresiaId(local.id, admin) });
    const baja = await service.rpc("personnel_remove_member", { p_actor: local.owner.id, p_org: local.id, p_membership: membresiaId(local.id, admin) });

    expect(reset.data).toMatchObject({ status: "platform_admin" });
    expect(baja.data).toMatchObject({ status: "removed", delete_account: false, reason: "platform_admin" });
    expect(reservas(admin)).toBe(0);
  });

  it("el flujo legítimo se conserva: una cuenta común y exclusiva se restablece y se borra", async () => {
    const local = await crearLocal();
    const otro = await createUser(service, `cgl-comun${contador}`);
    users.push(otro);
    await addMembership(service, otro, local.id, "staff");

    expect((await resetMemberPassword(personalCtx(local.owner), local.id, membresiaId(local.id, otro), NUEVA)).ok).toBe(true);
    expect(await puedeEntrar(otro, NUEVA)).toBe(true);
    expect(reservas(otro)).toBe(0);

    expect((await removeMember(personalCtx(local.owner), local.id, membresiaId(local.id, otro))).ok).toBe(true);
    expect(await cuentaExiste(otro)).toBe(false);
  });
});

describe("intercalaciones deterministas con admin_add_owner", () => {
  it("restablecer: el SuperAdmin suma la cuenta DESPUÉS de la reserva y ANTES de llamar a Auth → se rechaza, nadie queda tomado", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    let intento: Awaited<ReturnType<typeof sumarComoDueno>> | undefined;
    const admin = conGanchos(service, {
      "auth:updateUserById": async () => {
        intento = await sumarComoDueno(b, a.staff);
      },
    });

    const r = await resetMemberPassword(personalCtx(a.owner, admin), a.id, membresiaId(a.id, a.staff), NUEVA);

    expect(r).toEqual({ ok: true, data: undefined });
    expect(intento).toEqual({ ok: false, error: "account_busy" });
    expect(rol(b.id, a.staff)).toBeNull(); // la cuenta no entró a B mientras se le cambiaba la contraseña
    expect(reservas(a.staff)).toBe(0); // reserva liberada
    // Y pasado el instante el SuperAdmin sí puede: el flujo legítimo se conserva.
    expect((await sumarComoDueno(b, a.staff)).ok).toBe(true);
    expect(rol(b.id, a.staff)).toBe("owner");
  });

  it("restablecer: el SuperAdmin suma la cuenta ANTES de la comprobación definitiva → shared_account y la contraseña no cambia", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    const admin = conGanchos(service, {
      "rpc:personnel_begin_reset": async () => {
        expect((await sumarComoDueno(b, a.staff)).ok).toBe(true);
      },
    });

    const r = await resetMemberPassword(personalCtx(a.owner, admin), a.id, membresiaId(a.id, a.staff), NUEVA);

    expect(r).toEqual({ ok: false, error: "shared_account" });
    expect(await puedeEntrar(a.staff, TEST_PASSWORD)).toBe(true);
    expect(await puedeEntrar(a.staff, NUEVA)).toBe(false);
    expect(rol(b.id, a.staff)).toBe("owner");
  });

  it("restablecer: tampoco se asciende una membresía existente del mismo local durante la reserva", async () => {
    const a = await crearLocal();
    let intento: Awaited<ReturnType<typeof sumarComoDueno>> | undefined;
    const admin = conGanchos(service, {
      "auth:updateUserById": async () => {
        intento = await sumarComoDueno(a, a.staff);
      },
    });

    await resetMemberPassword(personalCtx(a.owner, admin), a.id, membresiaId(a.id, a.staff), NUEVA);

    expect(intento).toEqual({ ok: false, error: "account_busy" });
    expect(rol(a.id, a.staff)).toBe("staff");
  });

  it("baja: la cuenta se suma a otro local ANTES de quitarla → se conserva y la otra membresía sigue", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    const admin = conGanchos(service, {
      "rpc:personnel_remove_member": async () => {
        expect((await sumarComoDueno(b, a.staff)).ok).toBe(true);
      },
    });

    const r = await removeMember(personalCtx(a.owner, admin), a.id, membresiaId(a.id, a.staff));

    expect(r).toEqual({ ok: true, data: undefined });
    expect(rol(a.id, a.staff)).toBeNull();
    expect(rol(b.id, a.staff)).toBe("owner");
    expect(await cuentaExiste(a.staff)).toBe(true);
    expect(await puedeEntrar(a.staff, TEST_PASSWORD)).toBe(true);
  });

  it("baja: el SuperAdmin intenta sumar la cuenta DESPUÉS de reservar su borrado y ANTES de llamar a Auth → se rechaza; no se pierde ninguna membresía", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    let intento: Awaited<ReturnType<typeof sumarComoDueno>> | undefined;
    const admin = conGanchos(service, {
      "auth:deleteUser": async () => {
        intento = await sumarComoDueno(b, a.staff);
      },
    });

    const r = await removeMember(personalCtx(a.owner, admin), a.id, membresiaId(a.id, a.staff));

    expect(r).toEqual({ ok: true, data: undefined });
    expect(intento).toEqual({ ok: false, error: "account_busy" }); // antes: «added» y la membresía de B se borraba en cascada
    expect(await cuentaExiste(a.staff)).toBe(false);
    expect(rol(b.id, a.staff)).toBeNull();
    expect((await sumarComoDueno(b, a.staff)).ok).toBe(false); // la cuenta ya no existe: el SuperAdmin lo ve claro
  });

  it("si Auth falla, la reserva se libera igual y se puede reintentar", async () => {
    const a = await crearLocal();
    const admin = conGanchos(service, {
      "auth:updateUserById": async () => {
        throw new Error("Auth caído");
      },
    });

    await expect(resetMemberPassword(personalCtx(a.owner, admin), a.id, membresiaId(a.id, a.staff), NUEVA)).rejects.toThrow("Auth caído");

    expect(reservas(a.staff)).toBe(0);
    expect((await resetMemberPassword(personalCtx(a.owner), a.id, membresiaId(a.id, a.staff), NUEVA)).ok).toBe(true);
  });
});

describe("el lock de Postgres bloquea de verdad (transacciones reales)", () => {
  it("una reserva sin confirmar frena a admin_add_owner hasta que se confirma, y después se rechaza", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    const retenida = retener(
      `select public.personnel_begin_reset('${a.owner.id}', '${a.id}', '${membresiaId(a.id, a.staff)}');`,
    );
    await transaccionAbierta("personnel_begin_reset");

    const pedido = sumarComoDueno(b, a.staff);
    await esperandoLock("admin_add_owner"); // espera de verdad el lock de la cuenta, no «vio» una fila
    await retenida.confirmar();
    const r = await pedido;

    expect(r).toEqual({ ok: false, error: "account_busy" });
    expect(rol(b.id, a.staff)).toBeNull();
    sql(`delete from private.account_leases where user_id = '${a.staff.id}'`);
  });

  it("una membresía nueva sin confirmar frena la comprobación de restablecer, que después ve la cuenta compartida", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    const retenida = retener(`insert into public.memberships (user_id, organization_id, role) values ('${a.staff.id}', '${b.id}', 'owner');`);
    await transaccionAbierta("insert into public.memberships");

    const pedido = resetMemberPassword(personalCtx(a.owner), a.id, membresiaId(a.id, a.staff), NUEVA);
    await esperandoLock("personnel_begin_reset");
    await retenida.confirmar();
    const r = await pedido;

    expect(r).toEqual({ ok: false, error: "shared_account" });
    expect(await puedeEntrar(a.staff, TEST_PASSWORD)).toBe(true);
    expect(rol(b.id, a.staff)).toBe("owner");
  });

  it("una membresía nueva sin confirmar frena la baja, que después conserva la cuenta", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    const retenida = retener(`insert into public.memberships (user_id, organization_id, role) values ('${a.staff.id}', '${b.id}', 'owner');`);
    await transaccionAbierta("insert into public.memberships");

    const pedido = removeMember(personalCtx(a.owner), a.id, membresiaId(a.id, a.staff));
    await esperandoLock("personnel_remove_member");
    await retenida.confirmar();
    const r = await pedido;

    expect(r).toEqual({ ok: true, data: undefined });
    expect(rol(a.id, a.staff)).toBeNull();
    expect(rol(b.id, a.staff)).toBe("owner");
    expect(await cuentaExiste(a.staff)).toBe(true);
  });
});

describe("la reserva", () => {
  it("es exclusiva por cuenta y solo la libera su dueño (token)", async () => {
    const a = await crearLocal();
    const pedir = () => service.rpc("personnel_begin_reset", { p_actor: a.owner.id, p_org: a.id, p_membership: membresiaId(a.id, a.staff) });

    const primera = await pedir();
    const segunda = await pedir();
    expect(primera.data).toMatchObject({ status: "ok", user_id: a.staff.id });
    expect(segunda.data).toEqual({ status: "busy" });

    const token = (primera.data as { token: string }).token;
    await service.rpc("personnel_end_operation", { p_user: a.staff.id, p_token: "00000000-0000-4000-8000-000000000000" });
    expect(reservas(a.staff)).toBe(1); // un token ajeno no libera
    await service.rpc("personnel_end_operation", { p_user: a.staff.id, p_token: token });
    expect(reservas(a.staff)).toBe(0);
    expect((await pedir()).data).toMatchObject({ status: "ok" });
    sql(`delete from private.account_leases where user_id = '${a.staff.id}'`);
  });

  it("vence sola: con el servidor caído entre la reserva y Auth no queda la cuenta bloqueada para siempre", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    await service.rpc("personnel_begin_reset", { p_actor: a.owner.id, p_org: a.id, p_membership: membresiaId(a.id, a.staff) });
    expect(await sumarComoDueno(b, a.staff)).toEqual({ ok: false, error: "account_busy" });

    sql(`update private.account_leases set expires_at = now() - interval '1 second' where user_id = '${a.staff.id}'`);

    expect((await sumarComoDueno(b, a.staff)).ok).toBe(true);
    expect(rol(b.id, a.staff)).toBe("owner");
  });

  it("ninguna membresía nueva entra a una cuenta reservada, ni siquiera por service_role directo (trigger)", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    await service.rpc("personnel_begin_reset", { p_actor: a.owner.id, p_org: a.id, p_membership: membresiaId(a.id, a.staff) });

    const directo = await service.from("memberships").insert({ user_id: a.staff.id, organization_id: b.id, role: "staff" });

    expect(directo.error?.code).toBe("55006");
    expect(directo.error?.message).toBe("account_busy");
    sql(`delete from private.account_leases where user_id = '${a.staff.id}'`);
  });
});

describe("quién puede llamar a las funciones", () => {
  it("solo service_role; anon y las sesiones de personas reciben «permission denied»; la función vuelve a exigir un Dueño", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    const args = { p_actor: a.owner.id, p_org: a.id, p_membership: membresiaId(a.id, a.staff) };

    for (const [nombre, db] of [
      ["anon", anonClient()],
      ["Dueño", a.owner.db],
      ["Staff", a.staff.db],
      ["SuperAdmin", superAdmin.db],
    ] as const) {
      for (const funcion of ["personnel_begin_reset", "personnel_remove_member"] as const) {
        const r = await db.rpc(funcion, args);
        expect(r.error?.code, `${nombre} ${funcion}`).toBe("42501");
      }
      const fin = await db.rpc("personnel_end_operation", { p_user: a.staff.id, p_token: "00000000-0000-4000-8000-000000000000" });
      expect(fin.error?.code, `${nombre} end`).toBe("42501");
    }

    // service_role sin ser Dueño del local: la propia función lo rechaza.
    for (const actor of [a.staff.id, b.owner.id, superAdmin.id]) {
      for (const funcion of ["personnel_begin_reset", "personnel_remove_member"] as const) {
        const r = await service.rpc(funcion, { ...args, p_actor: actor });
        expect(r.error?.code, `${actor} ${funcion}`).toBe("42501");
        expect(r.error?.message).toBe("not_owner");
      }
    }
    expect(rol(a.id, a.staff)).toBe("staff");
    expect(reservas(a.staff)).toBe(0);
    // La tabla de reservas no es accesible por la API.
    expect((await service.from("account_leases" as never).select("*")).error).not.toBeNull();
  });
});
