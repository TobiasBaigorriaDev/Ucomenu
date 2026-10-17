import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addExistingOwner } from "@/lib/admin/owners";
import type { AdminContext } from "@/lib/admin/organizations";
import { resetMemberPassword } from "@/lib/personnel";
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
 * SuperAdmin suma una cuenta EXISTENTE como Dueño de otra organización (nivel C, ficha dueno-existente) contra el Supabase
 * local, con los mismos clientes que usa el servidor. El foco: solo SuperAdmin y solo por el servidor, nada se escribe sin
 * confirmar, la cuenta de Auth no se toca, una sola membresía y una sola auditoría aunque lleguen pedidos repetidos o
 * paralelos, y el aislamiento entre locales que sigue valiendo después de sumar.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let service: Db;
let admin: TestUser; // SuperAdmin
let comun: TestUser; // con sesión pero sin ningún rol
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

const ctx = (user: TestUser): AdminContext => ({ session: user.db, admin: service, actorId: user.id });
const contar = (tabla: string, donde = "true") => Number(sql(`select count(*) from public.${tabla} where ${donde}`)[0][0]);
const cuentas = () => Number(sql("select count(*) from auth.users")[0][0]);
const cuentaDe = (user: TestUser) => sql(`select encrypted_password, email, updated_at, email_confirmed_at from auth.users where id = '${user.id}'`)[0];

type Local = { id: string; slug: string; owner: TestUser; staff: TestUser };

/** Una organización propia con un Dueño y un Personal. */
async function crearLocal(): Promise<Local> {
  contador += 1;
  const slug = `tt-dex-${sufijo}-${contador}`;
  const id = await createOrg(service, slug, "pro");
  orgs.push(id);
  const owner = await createUser(service, `dex-d${contador}`);
  const staff = await createUser(service, `dex-s${contador}`);
  users.push(owner, staff);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, slug, owner, staff };
}

const rol = (orgId: string, user: TestUser) =>
  sql(`select role from public.memberships where organization_id = '${orgId}' and user_id = '${user.id}'`)[0]?.[0] ?? null;
const auditoria = async (orgId: string) =>
  (await service.from("audit_log").select("*").eq("organization_id", orgId).eq("action", "owner.added")).data ?? [];

beforeAll(async () => {
  service = serviceClient();
  admin = await createUser(service, "dex-admin");
  comun = await createUser(service, "dex-comun");
  users.push(admin, comun);
  sql(`insert into public.platform_admins (user_id) values ('${admin.id}')`);
});

afterAll(async () => {
  purgeAuditLogWhere(`after->>'slug' like 'tt-dex-%'`); // la auditoría solo se agrega: se limpia como dueño de la tabla
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("quién puede: solo SuperAdmin, solo por el servidor", () => {
  it("ninguna sesión (ni la de un SuperAdmin) ni anon llaman la función por la API", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    for (const [nombre, db, actor] of [
      ["SuperAdmin con sesión", admin.db, admin.id],
      ["Dueño", a.owner.db, a.owner.id],
      ["Staff", a.staff.db, a.staff.id],
      ["anon", anonClient(), admin.id],
    ] as const) {
      const r = await db.rpc("admin_add_owner", { p_actor: actor, p_org: b.id, p_email: a.owner.email, p_confirmed: true });
      expect(r.error, nombre).not.toBeNull();
      expect(r.error?.code, nombre).toBe("42501");
    }
    expect(rol(b.id, a.owner)).toBeNull();
    expect((await auditoria(b.id)).length).toBe(0);
  });

  it("aunque llegue con service_role, la función exige que el actor sea SuperAdmin", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    for (const actor of [a.owner.id, comun.id, "00000000-0000-4000-8000-000000000000"]) {
      const r = await service.rpc("admin_add_owner", { p_actor: actor, p_org: b.id, p_email: a.owner.email, p_confirmed: true });
      expect(r.error?.code, actor).toBe("42501");
    }
    expect(rol(b.id, a.owner)).toBeNull();
  });

  it("quien no es SuperAdmin (Dueño, Staff o sin rol) recibe «forbidden» y no cambia nada", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    for (const user of [a.owner, a.staff, b.owner, comun]) {
      const r = await addExistingOwner(ctx(user), { slug: b.slug, email: a.owner.email, confirmed: true });
      expect(r, user.email).toEqual({ ok: false, error: "forbidden" });
    }
    expect(rol(b.id, a.owner)).toBeNull();
    expect((await auditoria(b.id)).length).toBe(0);
  });
});

describe("buscar y confirmar", () => {
  it("un email sin cuenta no crea nada ni cuenta de Auth", async () => {
    const b = await crearLocal();
    const antes = { cuentas: cuentas(), membresias: contar("memberships") };
    const r = await addExistingOwner(ctx(admin), { slug: b.slug, email: `no-existe-${sufijo}@example.test`, confirmed: true });
    expect(r).toEqual({ ok: false, error: "account_not_found" });
    expect({ cuentas: cuentas(), membresias: contar("memberships") }).toEqual(antes);
  });

  it("datos inválidos se rechazan antes de la base: email malformado, organización inexistente", async () => {
    const b = await crearLocal();
    expect(await addExistingOwner(ctx(admin), { slug: b.slug, email: "no-es-un-email", confirmed: true })).toEqual({ ok: false, error: "invalid_email" });
    expect(await addExistingOwner(ctx(admin), { slug: b.slug, email: undefined, confirmed: true })).toEqual({ ok: false, error: "invalid_email" });
    expect(await addExistingOwner(ctx(admin), { slug: "no-existe-esa-org", email: b.owner.email, confirmed: true })).toEqual({ ok: false, error: "org_not_found" });
    expect(await addExistingOwner(ctx(admin), { slug: "MAL SLUG!", email: b.owner.email, confirmed: true })).toEqual({ ok: false, error: "org_not_found" });
  });

  it("sin confirmar solo informa dónde trabaja la cuenta y no escribe nada", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    await addMembership(service, a.staff, b.id, "staff"); // la cuenta de Personal de A también es Personal de B
    const antes = { membresias: contar("memberships"), auditoria: contar("audit_log") };

    const r = await addExistingOwner(ctx(admin), { slug: b.slug, email: a.owner.email, confirmed: false });
    expect(r.ok && r.data.status === "needs_confirmation").toBe(true);
    if (r.ok && r.data.status === "needs_confirmation") {
      expect(r.data.currentRole).toBeNull();
      expect(r.data.others).toEqual([{ name: a.slug, slug: a.slug, role: "owner" }]);
    }

    const staff = await addExistingOwner(ctx(admin), { slug: b.slug, email: a.staff.email.toUpperCase(), confirmed: false });
    expect(staff.ok && staff.data.status === "needs_confirmation" && staff.data.currentRole === "staff").toBe(true);
    expect(staff.ok && staff.data.status === "needs_confirmation" ? staff.data.others.map((o) => [o.slug, o.role]) : null).toEqual([[a.slug, "staff"]]);

    expect({ membresias: contar("memberships"), auditoria: contar("audit_log") }).toEqual(antes);
    expect(rol(b.id, a.owner)).toBeNull();
  });
});

describe("sumar", () => {
  it("confirmado, la cuenta es Dueño de la otra organización de verdad y la cuenta de Auth no se toca", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    const antes = cuentaDe(a.owner);
    const cuentasAntes = cuentas();

    const r = await addExistingOwner(ctx(admin), { slug: b.slug, email: a.owner.email, confirmed: true });
    expect(r.ok && r.data.status).toBe("added");

    expect(rol(b.id, a.owner)).toBe("owner");
    expect(rol(a.id, a.owner)).toBe("owner"); // su otro local no cambia
    expect(cuentaDe(a.owner)).toEqual(antes); // misma contraseña, mismo email, misma fecha de modificación
    expect(cuentas()).toBe(cuentasAntes);

    // Sigue entrando con su contraseña de siempre y en B se comporta como Dueño: ve los entitlements y escribe.
    const login = await anonClient().auth.signInWithPassword({ email: a.owner.email, password: TEST_PASSWORD });
    expect(login.error).toBeNull();
    expect((await a.owner.db.rpc("org_entitlements", { p_org: b.id })).data).not.toBeNull();
    const escribe = await a.owner.db.from("organizations").update({ name: "Renombrada por su nuevo Dueño" }).eq("id", b.id).select("name");
    expect(escribe.data).toEqual([{ name: "Renombrada por su nuevo Dueño" }]);
    // Y no se volvió Dueño de ninguna otra: sigue sin ver una tercera organización.
    const c = await crearLocal();
    expect((await a.owner.db.from("subscriptions").select("id").eq("organization_id", c.id)).data).toEqual([]);
  });

  it("una cuenta de Personal de esa misma organización se asciende a Dueño", async () => {
    const b = await crearLocal();
    const r = await addExistingOwner(ctx(admin), { slug: b.slug, email: b.staff.email, confirmed: true });
    expect(r.ok && r.data.status).toBe("promoted");
    expect(rol(b.id, b.staff)).toBe("owner");
    expect(contar("memberships", `organization_id = '${b.id}' and user_id = '${b.staff.id}'`)).toBe(1);
  });

  it("si ya es Dueño no cambia nada y no audita otra vez; repetir es seguro", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    expect((await addExistingOwner(ctx(admin), { slug: b.slug, email: a.owner.email, confirmed: true })).ok).toBe(true);
    const antes = { membresias: contar("memberships"), auditoria: (await auditoria(b.id)).length };

    for (const confirmed of [true, false]) {
      expect(await addExistingOwner(ctx(admin), { slug: b.slug, email: a.owner.email, confirmed })).toEqual({ ok: false, error: "already_owner" });
    }
    expect({ membresias: contar("memberships"), auditoria: (await auditoria(b.id)).length }).toEqual(antes);
  });

  it("pedidos paralelos para la misma cuenta: una membresía y una sola auditoría", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    const resultados = await Promise.all(
      [1, 2, 3, 4].map(() => addExistingOwner(ctx(admin), { slug: b.slug, email: a.owner.email, confirmed: true })),
    );
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok && r.error === "already_owner")).toHaveLength(3);
    expect(contar("memberships", `organization_id = '${b.id}' and user_id = '${a.owner.id}'`)).toBe(1);
    expect((await auditoria(b.id)).length).toBe(1);
  });

  it("deja un movimiento «owner.added» con el actor, la organización y las membresías previas, sin emails de terceros", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    await addMembership(service, a.staff, b.id, "staff");
    await addExistingOwner(ctx(admin), { slug: b.slug, email: a.staff.email, confirmed: true });

    const filas = await auditoria(b.id);
    expect(filas).toHaveLength(1);
    const fila = filas[0];
    expect(fila.actor_id).toBe(admin.id);
    expect(fila.actor_email).toBe(admin.email);
    expect(fila.after).toMatchObject({ slug: b.slug, owner_user_id: a.staff.id, promoted: true });
    expect(fila.before).toEqual({ role_here: "staff", elsewhere: [{ slug: a.slug, role: "staff" }] });
    expect(JSON.stringify([fila.before, fila.after])).not.toContain("@");
  });
});

describe("el aislamiento entre locales sigue valiendo", () => {
  it("al compartir cuenta, el Dueño del otro local ya no puede restablecer su contraseña (guarda shared_account)", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    await addExistingOwner(ctx(admin), { slug: b.slug, email: a.staff.email, confirmed: true });

    const membresia = await service.from("memberships").select("id").eq("organization_id", a.id).eq("user_id", a.staff.id).single();
    const r = await resetMemberPassword({ session: a.owner.db, admin: service, actorId: a.owner.id }, a.id, membresia.data!.id, "otra-contrasena-larga-1");
    expect(r).toEqual({ ok: false, error: "shared_account" });
    expect((await anonClient().auth.signInWithPassword({ email: a.staff.email, password: TEST_PASSWORD })).error).toBeNull();
  });

  it("sumar a B no le da a nadie acceso a A: el Dueño de B no ve datos de A", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    await addExistingOwner(ctx(admin), { slug: b.slug, email: a.owner.email, confirmed: true });
    expect((await b.owner.db.from("subscriptions").select("id").eq("organization_id", a.id)).data).toEqual([]);
    expect((await b.owner.db.from("memberships").select("user_id").eq("organization_id", a.id)).data).toEqual([]);
  });
});
