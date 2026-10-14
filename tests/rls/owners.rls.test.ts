import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  createOrg,
  createUser,
  deleteOrg,
  deleteUser,
  serviceClient,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * Invariante «una organización nunca se queda sin owner» (nivel C, ficha acceso-del-personal).
 * Vale para todos los caminos: la API del servidor (service_role), el borrado del usuario de Auth
 * y las operaciones simultáneas. Requisitos: `pnpm db:start` y `pnpm db:reset`.
 */

const LAST_OWNER = "last_owner_required";
const CHECK_VIOLATION = "23514";
const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

let service: Db;
const orgs: string[] = [];
const users: TestUser[] = [];

async function nuevaOrg(etiqueta: string): Promise<string> {
  const id = await createOrg(service, `tt-own-${etiqueta}-${sufijo}`);
  orgs.push(id);
  return id;
}

async function nuevoUsuario(etiqueta: string): Promise<TestUser> {
  const u = await createUser(service, `own-${etiqueta}`);
  users.push(u);
  return u;
}

async function membresiaId(orgId: string, user: TestUser): Promise<string> {
  const { data, error } = await service
    .from("memberships")
    .select("id")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

const duenos = async (orgId: string) =>
  (await service.from("memberships").select("user_id").eq("organization_id", orgId).eq("role", "owner")).data ?? [];

beforeAll(() => {
  service = serviceClient();
});

afterAll(async () => {
  // Primero las organizaciones (la cascada se permite), después los usuarios.
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("el último owner no se puede quitar", () => {
  it("borrar la membresía del único owner se rechaza, incluso con service_role", async () => {
    const org = await nuevaOrg("borrar");
    const owner = await nuevoUsuario("borrar");
    await addMembership(service, owner, org, "owner");

    const { error } = await service.from("memberships").delete().eq("organization_id", org).eq("user_id", owner.id);

    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(error?.message).toContain(LAST_OWNER);
    expect(await duenos(org)).toHaveLength(1);
  });

  it("bajar de rol al único owner se rechaza", async () => {
    const org = await nuevaOrg("bajar");
    const owner = await nuevoUsuario("bajar");
    await addMembership(service, owner, org, "owner");

    const { error } = await service.from("memberships").update({ role: "staff" }).eq("organization_id", org).eq("user_id", owner.id);

    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(await duenos(org)).toHaveLength(1);
  });

  it("mover al único owner a otra organización se rechaza", async () => {
    const org = await nuevaOrg("mover-a");
    const otra = await nuevaOrg("mover-b");
    const owner = await nuevoUsuario("mover");
    await addMembership(service, owner, org, "owner");

    const { error } = await service.from("memberships").update({ organization_id: otra }).eq("organization_id", org).eq("user_id", owner.id);

    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(await duenos(org)).toHaveLength(1);
    expect(await duenos(otra)).toHaveLength(0);
  });

  it("borrar la cuenta de Auth del único owner se rechaza y la cuenta sigue existiendo", async () => {
    const org = await nuevaOrg("auth");
    const owner = await nuevoUsuario("auth");
    await addMembership(service, owner, org, "owner");

    const borrado = await service.auth.admin.deleteUser(owner.id);
    const sigue = await service.auth.admin.getUserById(owner.id);

    expect(borrado.error).not.toBeNull();
    expect(sigue.data.user?.id).toBe(owner.id);
    expect(await duenos(org)).toHaveLength(1);
  });

  it("un UPDATE que deja el rol de owner igual no se bloquea", async () => {
    const org = await nuevaOrg("noop");
    const owner = await nuevoUsuario("noop");
    await addMembership(service, owner, org, "owner");

    const { error } = await service.from("memberships").update({ role: "owner" }).eq("organization_id", org).eq("user_id", owner.id);

    expect(error).toBeNull();
  });
});

describe("con otro owner sí se puede, y queda al menos uno", () => {
  it("se baja a un owner cuando hay otro; después el que queda ya no se puede bajar", async () => {
    const org = await nuevaOrg("dos");
    const a = await nuevoUsuario("dos-a");
    const b = await nuevoUsuario("dos-b");
    await addMembership(service, a, org, "owner");
    await addMembership(service, b, org, "owner");

    const primero = await service.from("memberships").update({ role: "staff" }).eq("organization_id", org).eq("user_id", a.id);
    const segundo = await service.from("memberships").update({ role: "staff" }).eq("organization_id", org).eq("user_id", b.id);

    expect(primero.error).toBeNull();
    expect(segundo.error?.code).toBe(CHECK_VIOLATION);
    expect((await duenos(org)).map((d) => d.user_id)).toEqual([b.id]);
  });

  it("se quita a un owner (membresía) cuando hay otro", async () => {
    const org = await nuevaOrg("quitar");
    const a = await nuevoUsuario("quitar-a");
    const b = await nuevoUsuario("quitar-b");
    await addMembership(service, a, org, "owner");
    await addMembership(service, b, org, "owner");

    const { error } = await service.from("memberships").delete().eq("organization_id", org).eq("user_id", a.id);

    expect(error).toBeNull();
    expect((await duenos(org)).map((d) => d.user_id)).toEqual([b.id]);
  });

  it("un owner de otra organización no cuenta como «otro owner»", async () => {
    const org = await nuevaOrg("ajeno-a");
    const otra = await nuevaOrg("ajeno-b");
    const unico = await nuevoUsuario("ajeno-unico");
    const ajeno = await nuevoUsuario("ajeno-otro");
    await addMembership(service, unico, org, "owner");
    await addMembership(service, ajeno, otra, "owner");

    const { error } = await service.from("memberships").delete().eq("organization_id", org).eq("user_id", unico.id);

    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("un staff no cuenta como owner: el único owner sigue protegido y el staff se puede quitar", async () => {
    const org = await nuevaOrg("staff");
    const owner = await nuevoUsuario("staff-owner");
    const staff = await nuevoUsuario("staff-staff");
    await addMembership(service, owner, org, "owner");
    await addMembership(service, staff, org, "staff");

    const bajaOwner = await service.from("memberships").delete().eq("organization_id", org).eq("user_id", owner.id);
    const bajaStaff = await service.from("memberships").delete().eq("organization_id", org).eq("user_id", staff.id);

    expect(bajaOwner.error?.code).toBe(CHECK_VIOLATION);
    expect(bajaStaff.error).toBeNull();
  });
});

describe("lo que no debe afectar", () => {
  it("borrar la organización completa (cascada) funciona aunque tenga un solo owner", async () => {
    const org = await createOrg(service, `tt-own-cascada-${sufijo}`);
    const owner = await nuevoUsuario("cascada");
    await addMembership(service, owner, org, "owner");

    const { error } = await service.from("organizations").delete().eq("id", org);

    expect(error).toBeNull();
    expect((await service.from("memberships").select("id").eq("organization_id", org)).data).toEqual([]);
  });

  it("una vez borrada la organización, la cuenta del ex owner se puede borrar", async () => {
    const org = await createOrg(service, `tt-own-exowner-${sufijo}`);
    const owner = await createUser(service, "own-exowner");
    await addMembership(service, owner, org, "owner");
    await deleteOrg(service, org);

    const borrado = await service.auth.admin.deleteUser(owner.id);

    expect(borrado.error).toBeNull();
  });

  it("se puede crear una organización sin dueños y sumarle el primero después", async () => {
    const org = await nuevaOrg("sin-duenos");
    const owner = await nuevoUsuario("sin-duenos");

    expect(await duenos(org)).toHaveLength(0);
    await addMembership(service, owner, org, "owner");

    expect(await duenos(org)).toHaveLength(1);
  });

  it("la cuenta de un staff se puede borrar sin restricciones", async () => {
    const org = await nuevaOrg("staff-libre");
    const owner = await nuevoUsuario("staff-libre-o");
    const staff = await nuevoUsuario("staff-libre-s");
    await addMembership(service, owner, org, "owner");
    await addMembership(service, staff, org, "staff");

    const borrado = await service.auth.admin.deleteUser(staff.id);
    users.splice(users.indexOf(staff), 1);

    expect(borrado.error).toBeNull();
  });
});

describe("concurrencia", () => {
  it("dos owners que se bajan a la vez dejan exactamente uno (5 rondas)", async () => {
    for (let ronda = 0; ronda < 5; ronda++) {
      const org = await nuevaOrg(`carrera-${ronda}`);
      const a = await nuevoUsuario(`carrera-a${ronda}`);
      const b = await nuevoUsuario(`carrera-b${ronda}`);
      await addMembership(service, a, org, "owner");
      await addMembership(service, b, org, "owner");

      const [ra, rb] = await Promise.all([
        service.from("memberships").update({ role: "staff" }).eq("organization_id", org).eq("user_id", a.id),
        service.from("memberships").update({ role: "staff" }).eq("organization_id", org).eq("user_id", b.id),
      ]);

      const errores = [ra.error, rb.error].filter(Boolean);
      expect(errores, `ronda ${ronda}: una sola puede fallar`).toHaveLength(1);
      expect(errores[0]?.code).toBe(CHECK_VIOLATION);
      expect(await duenos(org), `ronda ${ronda}: queda un owner`).toHaveLength(1);
    }
  });

  it("dos owners que se quitan a la vez (borrado) dejan exactamente uno (5 rondas)", async () => {
    for (let ronda = 0; ronda < 5; ronda++) {
      const org = await nuevaOrg(`carrera-del-${ronda}`);
      const a = await nuevoUsuario(`carrera-del-a${ronda}`);
      const b = await nuevoUsuario(`carrera-del-b${ronda}`);
      await addMembership(service, a, org, "owner");
      await addMembership(service, b, org, "owner");
      const ida = await membresiaId(org, a);
      const idb = await membresiaId(org, b);

      const [ra, rb] = await Promise.all([
        service.from("memberships").delete().eq("id", ida),
        service.from("memberships").delete().eq("id", idb),
      ]);

      expect([ra.error, rb.error].filter(Boolean), `ronda ${ronda}`).toHaveLength(1);
      expect(await duenos(org), `ronda ${ronda}`).toHaveLength(1);
    }
  });
});
