import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changeOwnPassword } from "@/lib/auth/account";
import {
  createMember,
  listMembers,
  removeMember,
  resetMemberPassword,
  setMemberBranches,
  setMemberRole,
  type PersonnelContext,
} from "@/lib/personnel";
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
  TEST_PASSWORD,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * Gestión del personal (nivel C, ficha acceso-del-personal) contra el Supabase local, con los
 * mismos clientes que usa el servidor: el de la PERSONA (RLS) como prueba de identidad y el de
 * servicio para actuar. El foco son los casos adversarios: Staff, Dueño de otro local, objetivos
 * ajenos, cuentas compartidas y emails ya registrados.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const NUEVA = "otra-contrasena-123";

let service: Db;
const orgs: string[] = [];
const users: TestUser[] = [];
const creadosPorElModulo: string[] = []; // ids de cuentas creadas por createMember

const ctx = (user: TestUser): PersonnelContext => ({ session: user.db, admin: service, actorId: user.id });

async function nuevaOrg(etiqueta: string, estado: "active" | "grace" | "read_only" | "suspended" = "active", plan: "basic" | "pro" = "basic") {
  const id = await createOrg(service, `tt-per-${etiqueta}-${sufijo}`, plan);
  orgs.push(id);
  const finEnMs = { active: 5 * DIA_MS, grace: -3 * DIA_MS, read_only: -10 * DIA_MS, suspended: -20 * DIA_MS }[estado];
  await setSubscription(service, id, { finEnMs });
  return id;
}

async function nuevoUsuario(etiqueta: string) {
  const u = await createUser(service, `per-${etiqueta}`);
  users.push(u);
  return u;
}

async function miembro(orgId: string, etiqueta: string, role: "owner" | "staff") {
  const u = await nuevoUsuario(etiqueta);
  await addMembership(service, u, orgId, role);
  return u;
}

const puedeEntrar = async (email: string, password: string) => {
  const { error } = await anonClient().auth.signInWithPassword({ email, password });
  return error === null;
};

const membresia = async (orgId: string, userId: string) =>
  (await service.from("memberships").select("id, role").eq("organization_id", orgId).eq("user_id", userId).maybeSingle()).data;

const cuentaExiste = async (userId: string) => (await service.auth.admin.getUserById(userId)).data.user !== null;

function correo(etiqueta: string) {
  return `rls-per-${etiqueta}-${sufijo}@example.test`;
}

async function alta(orgId: string, actor: TestUser, etiqueta: string, role: "owner" | "staff" = "staff") {
  const resultado = await createMember(ctx(actor), orgId, { email: correo(etiqueta), password: TEST_PASSWORD, role });
  if (resultado.ok) creadosPorElModulo.push(resultado.data.userId);
  return resultado;
}

beforeAll(() => {
  service = serviceClient();
});

afterAll(async () => {
  for (const id of orgs) await deleteOrg(service, id);
  for (const id of creadosPorElModulo) await service.auth.admin.deleteUser(id);
  for (const u of users) await deleteUser(service, u);
});

describe("alta de personal", () => {
  it("el Dueño crea un Staff con contraseña temporal; la persona entra y queda con rol staff", async () => {
    const org = await nuevaOrg("alta");
    const dueno = await miembro(org, "alta-d", "owner");

    const r = await alta(org, dueno, "alta-s");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await membresia(org, r.data.userId))?.role).toBe("staff");
    expect(await puedeEntrar(correo("alta-s"), TEST_PASSWORD)).toBe(true);
  });

  it("el Dueño crea a otro Dueño", async () => {
    const org = await nuevaOrg("alta-owner");
    const dueno = await miembro(org, "alta-owner-d", "owner");

    const r = await alta(org, dueno, "alta-owner-n", "owner");

    expect(r.ok).toBe(true);
    if (r.ok) expect((await membresia(org, r.data.userId))?.role).toBe("owner");
  });

  it("el email se normaliza (mayúsculas y espacios)", async () => {
    const org = await nuevaOrg("alta-norm");
    const dueno = await miembro(org, "alta-norm-d", "owner");

    const r = await createMember(ctx(dueno), org, { email: `  ${correo("alta-norm-s").toUpperCase()} `, password: TEST_PASSWORD, role: "staff" });

    expect(r.ok).toBe(true);
    if (r.ok) creadosPorElModulo.push(r.data.userId);
    expect(await puedeEntrar(correo("alta-norm-s"), TEST_PASSWORD)).toBe(true);
  });

  it("un Staff no puede dar de alta: no se crea ninguna cuenta", async () => {
    const org = await nuevaOrg("alta-staff");
    await miembro(org, "alta-staff-d", "owner");
    const staff = await miembro(org, "alta-staff-s", "staff");

    const r = await createMember(ctx(staff), org, { email: correo("alta-staff-x"), password: TEST_PASSWORD, role: "staff" });

    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(await puedeEntrar(correo("alta-staff-x"), TEST_PASSWORD)).toBe(false);
  });

  it("un Staff no puede darse a sí mismo el rol de Dueño dando de alta con el mismo email", async () => {
    const org = await nuevaOrg("alta-escala");
    await miembro(org, "alta-escala-d", "owner");
    const staff = await miembro(org, "alta-escala-s", "staff");

    const r = await createMember(ctx(staff), org, { email: staff.email, password: TEST_PASSWORD, role: "owner" });

    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect((await membresia(org, staff.id))?.role).toBe("staff");
  });

  it("el Dueño de otro local no puede dar de alta en este", async () => {
    const org = await nuevaOrg("alta-a");
    const otra = await nuevaOrg("alta-b");
    await miembro(org, "alta-a-d", "owner");
    const duenoB = await miembro(otra, "alta-b-d", "owner");

    const r = await createMember(ctx(duenoB), org, { email: correo("alta-x"), password: TEST_PASSWORD, role: "staff" });

    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(await puedeEntrar(correo("alta-x"), TEST_PASSWORD)).toBe(false);
  });

  it("un email ya registrado se rechaza con error genérico y la cuenta existente no cambia", async () => {
    const org = await nuevaOrg("alta-dup");
    const dueno = await miembro(org, "alta-dup-d", "owner");
    const otraOrg = await nuevaOrg("alta-dup-o");
    const existente = await miembro(otraOrg, "alta-dup-e", "staff");

    const r = await createMember(ctx(dueno), org, { email: existente.email, password: NUEVA, role: "owner" });

    expect(r).toEqual({ ok: false, error: "email_unavailable" });
    expect(await puedeEntrar(existente.email, TEST_PASSWORD)).toBe(true); // contraseña intacta
    expect(await puedeEntrar(existente.email, NUEVA)).toBe(false); // la del atacante no sirve
    expect(await membresia(org, existente.id)).toBeNull(); // no quedó dentro del local
  });

  it("rechaza email inválido, rol inválido y contraseña débil sin crear nada", async () => {
    const org = await nuevaOrg("alta-val");
    const dueno = await miembro(org, "alta-val-d", "owner");
    const antes = (await service.auth.admin.listUsers({ perPage: 1000 })).data.users.length;

    const casos = [
      await createMember(ctx(dueno), org, { email: "no-es-email", password: TEST_PASSWORD, role: "staff" }),
      await createMember(ctx(dueno), org, { email: correo("alta-val"), password: TEST_PASSWORD, role: "superadmin" }),
      await createMember(ctx(dueno), org, { email: correo("alta-val"), password: "corta", role: "staff" }),
      await createMember(ctx(dueno), org, { email: correo("alta-val"), password: "a".repeat(80), role: "staff" }),
    ];

    expect(casos).toEqual([
      { ok: false, error: "invalid_email" },
      { ok: false, error: "invalid_role" },
      { ok: false, error: "too_short" },
      { ok: false, error: "too_long" },
    ]);
    expect((await service.auth.admin.listUsers({ perPage: 1000 })).data.users.length).toBe(antes);
  });

  it("con la cuenta en gracia se puede dar de alta; en solo lectura y suspendida no", async () => {
    const gracia = await nuevaOrg("alta-gracia", "grace");
    const ro = await nuevaOrg("alta-ro", "read_only");
    const susp = await nuevaOrg("alta-susp", "suspended");
    const dGracia = await miembro(gracia, "alta-gracia-d", "owner");
    const dRo = await miembro(ro, "alta-ro-d", "owner");
    const dSusp = await miembro(susp, "alta-susp-d", "owner");

    expect((await alta(gracia, dGracia, "alta-gracia-s")).ok).toBe(true);
    expect(await alta(ro, dRo, "alta-ro-s")).toEqual({ ok: false, error: "read_only" });
    expect(await alta(susp, dSusp, "alta-susp-s")).toEqual({ ok: false, error: "read_only" });
    expect(await puedeEntrar(correo("alta-ro-s"), TEST_PASSWORD)).toBe(false);
  });

  it("si falla la membresía, la cuenta recién creada se borra (no queda huérfana)", async () => {
    const org = await nuevaOrg("alta-comp");
    const dueno = await miembro(org, "alta-comp-d", "owner");
    // Cliente de servicio que falla solo al insertar la membresía.
    const adminRoto = new Proxy(service, {
      get(target, prop) {
        if (prop === "from") {
          return (tabla: string) =>
            tabla === "memberships"
              ? { insert: async () => ({ error: { message: "falla simulada", code: "XX000" } }) }
              : target.from(tabla as "memberships");
        }
        const valor = Reflect.get(target, prop);
        return typeof valor === "function" ? valor.bind(target) : valor;
      },
    }) as Db;

    const r = await createMember({ session: dueno.db, admin: adminRoto, actorId: dueno.id }, org, {
      email: correo("alta-comp-s"),
      password: TEST_PASSWORD,
      role: "staff",
    });

    expect(r).toEqual({ ok: false, error: "unexpected" });
    expect(await puedeEntrar(correo("alta-comp-s"), TEST_PASSWORD)).toBe(false);
  });
});

describe("cambio de rol", () => {
  it("el Dueño sube a Dueño a un Staff y lo baja de nuevo", async () => {
    const org = await nuevaOrg("rol");
    const dueno = await miembro(org, "rol-d", "owner");
    const staff = await miembro(org, "rol-s", "staff");
    const id = (await membresia(org, staff.id))!.id;

    expect((await setMemberRole(ctx(dueno), org, id, "owner")).ok).toBe(true);
    expect((await membresia(org, staff.id))?.role).toBe("owner");
    expect((await setMemberRole(ctx(dueno), org, id, "staff")).ok).toBe(true);
    expect((await membresia(org, staff.id))?.role).toBe("staff");
  });

  it("el Staff no puede cambiar roles (ni el propio); un Dueño ajeno tampoco", async () => {
    const org = await nuevaOrg("rol-adv");
    const otra = await nuevaOrg("rol-adv-b");
    const dueno = await miembro(org, "rol-adv-d", "owner");
    const staff = await miembro(org, "rol-adv-s", "staff");
    const ajeno = await miembro(otra, "rol-adv-a", "owner");
    const idStaff = (await membresia(org, staff.id))!.id;
    const idDueno = (await membresia(org, dueno.id))!.id;

    expect(await setMemberRole(ctx(staff), org, idStaff, "owner")).toEqual({ ok: false, error: "forbidden" });
    expect(await setMemberRole(ctx(staff), org, idDueno, "staff")).toEqual({ ok: false, error: "forbidden" });
    expect(await setMemberRole(ctx(ajeno), org, idStaff, "owner")).toEqual({ ok: false, error: "forbidden" });
    expect((await membresia(org, staff.id))?.role).toBe("staff");
    expect((await membresia(org, dueno.id))?.role).toBe("owner");
  });

  it("un Dueño no puede operar sobre una membresía de otro local aunque conozca su id", async () => {
    const org = await nuevaOrg("rol-idor-a");
    const otra = await nuevaOrg("rol-idor-b");
    const dueno = await miembro(org, "rol-idor-d", "owner");
    const victima = await miembro(otra, "rol-idor-v", "staff");
    const idVictima = (await membresia(otra, victima.id))!.id;

    expect(await setMemberRole(ctx(dueno), org, idVictima, "owner")).toEqual({ ok: false, error: "not_found" });
    expect((await membresia(otra, victima.id))?.role).toBe("staff");
  });

  it("no se cambia el rol propio desde el módulo", async () => {
    const org = await nuevaOrg("rol-self");
    const dueno = await miembro(org, "rol-self-d", "owner");
    await miembro(org, "rol-self-o", "owner");
    const id = (await membresia(org, dueno.id))!.id;

    expect(await setMemberRole(ctx(dueno), org, id, "staff")).toEqual({ ok: false, error: "self" });
  });

  it("subir a Dueño requiere cuenta al día; bajar de rol se puede siempre", async () => {
    const ro = await nuevaOrg("rol-ro", "read_only");
    const dueno = await miembro(ro, "rol-ro-d", "owner");
    const staff = await miembro(ro, "rol-ro-s", "staff");
    const otroDueno = await miembro(ro, "rol-ro-o", "owner");

    const subir = await setMemberRole(ctx(dueno), ro, (await membresia(ro, staff.id))!.id, "owner");
    const bajar = await setMemberRole(ctx(dueno), ro, (await membresia(ro, otroDueno.id))!.id, "staff");

    expect(subir).toEqual({ ok: false, error: "read_only" });
    expect(bajar.ok).toBe(true);
  });

  it("dos Dueños que se bajan a la vez: exactamente uno lo logra y la organización conserva un Dueño", async () => {
    for (let ronda = 0; ronda < 3; ronda++) {
      const org = await nuevaOrg(`rol-carrera-${ronda}`);
      const a = await miembro(org, `rol-carrera-a${ronda}`, "owner");
      const b = await miembro(org, `rol-carrera-b${ronda}`, "owner");
      const ida = (await membresia(org, a.id))!.id;
      const idb = (await membresia(org, b.id))!.id;

      const [ra, rb] = await Promise.all([
        setMemberRole(ctx(b), org, ida, "staff"), // b baja a a
        setMemberRole(ctx(a), org, idb, "staff"), // a baja a b
      ]);

      expect([ra.ok, rb.ok].filter(Boolean), `ronda ${ronda}`).toHaveLength(1);
      const duenos = (await service.from("memberships").select("id").eq("organization_id", org).eq("role", "owner")).data;
      expect(duenos, `ronda ${ronda}`).toHaveLength(1);
    }
  });
});

describe("sucursales asignadas al personal (ficha personal-por-sucursal)", () => {
  async function ramas(org: string) {
    const r = await service
      .from("branches")
      .insert([
        { organization_id: org, slug: "centro", name: "Centro", is_active: true },
        { organization_id: org, slug: "norte", name: "Norte", is_active: true },
        { organization_id: org, slug: "vieja", name: "Vieja", is_active: false },
      ])
      .select("id, slug");
    if (r.error) throw new Error(r.error.message);
    const por = (slug: string) => r.data.find((x) => x.slug === slug)!.id;
    return { centro: por("centro"), norte: por("norte"), vieja: por("vieja") };
  }
  const asignadas = async (org: string, userId: string) =>
    (await service.from("memberships").select("assigned_branch_ids").eq("organization_id", org).eq("user_id", userId).single()).data?.assigned_branch_ids;

  it("el Dueño asigna y quita sucursales a un Staff; el listado las devuelve", async () => {
    const org = await nuevaOrg("suc", "active", "pro");
    const r = await ramas(org);
    const dueno = await miembro(org, "suc-d", "owner");
    const staff = await miembro(org, "suc-s", "staff");
    const id = (await membresia(org, staff.id))!.id;

    expect((await setMemberBranches(ctx(dueno), org, id, [r.centro])).ok).toBe(true);
    expect(await asignadas(org, staff.id)).toEqual([r.centro]);
    const lista = await listMembers(ctx(dueno), org);
    expect(lista.ok && lista.data.find((m) => m.userId === staff.id)?.assignedBranchIds).toEqual([r.centro]);

    expect((await setMemberBranches(ctx(dueno), org, id, [])).ok).toBe(true);
    expect(await asignadas(org, staff.id)).toEqual([]);
  });

  it("no se asignan sucursales inactivas, ajenas o mal formadas, ni a un Dueño", async () => {
    const org = await nuevaOrg("suc-mal", "active", "pro");
    const otra = await nuevaOrg("suc-mal-b", "active", "pro");
    const r = await ramas(org);
    const ajena = await ramas(otra);
    const dueno = await miembro(org, "suc-mal-d", "owner");
    const staff = await miembro(org, "suc-mal-s", "staff");
    const idStaff = (await membresia(org, staff.id))!.id;
    const idDueno = (await membresia(org, dueno.id))!.id;

    for (const malas of [[r.vieja], [ajena.centro], [r.centro, ajena.norte], ["no-es-uuid"], "centro", null]) {
      expect(await setMemberBranches(ctx(dueno), org, idStaff, malas), JSON.stringify(malas)).toEqual({ ok: false, error: "invalid_branches" });
    }
    expect(await setMemberBranches(ctx(dueno), org, idDueno, [r.centro])).toEqual({ ok: false, error: "invalid_branches" });
    expect(await asignadas(org, staff.id)).toEqual([]);
    expect(await asignadas(org, dueno.id)).toEqual([]);
  });

  it("el Staff, el Dueño ajeno y una membresía de otro local no pueden asignar", async () => {
    const org = await nuevaOrg("suc-adv", "active", "pro");
    const otra = await nuevaOrg("suc-adv-b", "active", "pro");
    const r = await ramas(org);
    const staff = await miembro(org, "suc-adv-s", "staff");
    const ajeno = await miembro(otra, "suc-adv-a", "owner");
    const idStaff = (await membresia(org, staff.id))!.id;

    expect(await setMemberBranches(ctx(staff), org, idStaff, [r.centro])).toEqual({ ok: false, error: "forbidden" });
    expect(await setMemberBranches(ctx(ajeno), org, idStaff, [r.centro])).toEqual({ ok: false, error: "forbidden" });
    // Un Dueño que conoce el id de una membresía de otro local la ve «no encontrada».
    expect(await setMemberBranches(ctx(ajeno), otra, idStaff, [])).toEqual({ ok: false, error: "not_found" });
    expect(await asignadas(org, staff.id)).toEqual([]);
  });

  it("se puede asignar con la cuenta en solo lectura (no es acceso nuevo)", async () => {
    const org = await nuevaOrg("suc-ro", "read_only", "pro");
    const r = await ramas(org);
    const dueno = await miembro(org, "suc-ro-d", "owner");
    const staff = await miembro(org, "suc-ro-s", "staff");
    const id = (await membresia(org, staff.id))!.id;
    expect((await setMemberBranches(ctx(dueno), org, id, [r.norte])).ok).toBe(true);
    expect(await asignadas(org, staff.id)).toEqual([r.norte]);
  });
});

describe("baja de personal", () => {
  it("la baja borra la membresía y la cuenta (si no tiene otro local); ya no puede entrar", async () => {
    const org = await nuevaOrg("baja");
    const dueno = await miembro(org, "baja-d", "owner");
    const staff = await miembro(org, "baja-s", "staff");

    const r = await removeMember(ctx(dueno), org, (await membresia(org, staff.id))!.id);

    expect(r.ok).toBe(true);
    expect(await membresia(org, staff.id)).toBeNull();
    expect(await cuentaExiste(staff.id)).toBe(false);
    expect(await puedeEntrar(staff.email, TEST_PASSWORD)).toBe(false);
    users.splice(users.indexOf(staff), 1);
  });

  it("si la persona tiene otro local, solo se le quita este y la cuenta sigue", async () => {
    const org = await nuevaOrg("baja-multi-a");
    const otra = await nuevaOrg("baja-multi-b");
    const dueno = await miembro(org, "baja-multi-d", "owner");
    const multi = await miembro(org, "baja-multi-m", "staff");
    await addMembership(service, multi, otra, "staff");

    const r = await removeMember(ctx(dueno), org, (await membresia(org, multi.id))!.id);

    expect(r.ok).toBe(true);
    expect(await membresia(org, multi.id)).toBeNull();
    expect(await membresia(otra, multi.id)).not.toBeNull();
    expect(await cuentaExiste(multi.id)).toBe(true);
    expect(await puedeEntrar(multi.email, TEST_PASSWORD)).toBe(true);
  });

  it("la baja corta el acceso a los datos del local en el siguiente pedido, con el token aún vigente", async () => {
    const org = await nuevaOrg("baja-token");
    const dueno = await miembro(org, "baja-token-d", "owner");
    const staff = await miembro(org, "baja-token-s", "staff");
    // El token del Staff sigue siendo válido, pero la base autoriza por membresía.
    const antes = await staff.db.from("organizations").select("id").eq("id", org);
    expect(antes.data).toHaveLength(1);

    await removeMember(ctx(dueno), org, (await membresia(org, staff.id))!.id);

    const despues = await staff.db.from("memberships").select("id");
    expect(despues.data ?? []).toEqual([]);
    users.splice(users.indexOf(staff), 1);
  });

  it("el Staff y el Dueño ajeno no pueden dar de baja; el objetivo de otro local es «no encontrado»", async () => {
    const org = await nuevaOrg("baja-adv");
    const otra = await nuevaOrg("baja-adv-b");
    await miembro(org, "baja-adv-d", "owner");
    const staff = await miembro(org, "baja-adv-s", "staff");
    const otroStaff = await miembro(org, "baja-adv-s2", "staff");
    const duenoB = await miembro(otra, "baja-adv-b-d", "owner");
    const idOtro = (await membresia(org, otroStaff.id))!.id;

    expect(await removeMember(ctx(staff), org, idOtro)).toEqual({ ok: false, error: "forbidden" });
    expect(await removeMember(ctx(duenoB), org, idOtro)).toEqual({ ok: false, error: "forbidden" });
    // El Dueño de B apuntando a su propio local con el id de una membresía de A.
    expect(await removeMember(ctx(duenoB), otra, idOtro)).toEqual({ ok: false, error: "not_found" });
    expect(await membresia(org, otroStaff.id)).not.toBeNull();
    expect(await cuentaExiste(otroStaff.id)).toBe(true);
  });

  it("no se da de baja a uno mismo", async () => {
    const org = await nuevaOrg("baja-self");
    const dueno = await miembro(org, "baja-self-d", "owner");
    await miembro(org, "baja-self-o", "owner");

    expect(await removeMember(ctx(dueno), org, (await membresia(org, dueno.id))!.id)).toEqual({ ok: false, error: "self" });
  });

  it("se puede dar de baja con la cuenta en solo lectura o suspendida", async () => {
    for (const estado of ["read_only", "suspended"] as const) {
      const slug = estado.replace("_", "-");
      const org = await nuevaOrg(`baja-${slug}`, estado);
      const dueno = await miembro(org, `baja-${estado}-d`, "owner");
      const staff = await miembro(org, `baja-${estado}-s`, "staff");

      const r = await removeMember(ctx(dueno), org, (await membresia(org, staff.id))!.id);

      expect(r.ok, estado).toBe(true);
      expect(await cuentaExiste(staff.id), estado).toBe(false);
      users.splice(users.indexOf(staff), 1);
    }
  });

  it("se puede quitar a otro Dueño si queda alguno; el último queda protegido por la base", async () => {
    const org = await nuevaOrg("baja-owner");
    const a = await miembro(org, "baja-owner-a", "owner");
    const b = await miembro(org, "baja-owner-b", "owner");

    expect((await removeMember(ctx(a), org, (await membresia(org, b.id))!.id)).ok).toBe(true);
    users.splice(users.indexOf(b), 1);

    // El único Dueño que queda no puede quitarse (self) y nadie más es Dueño.
    expect(await removeMember(ctx(a), org, (await membresia(org, a.id))!.id)).toEqual({ ok: false, error: "self" });
    const forzado = await service.from("memberships").delete().eq("organization_id", org).eq("user_id", a.id);
    expect(forzado.error?.code).toBe("23514");
  });
});

describe("restablecer la contraseña de un Staff", () => {
  it("el Dueño la restablece: la anterior deja de servir y la nueva sirve", async () => {
    const org = await nuevaOrg("reset");
    const dueno = await miembro(org, "reset-d", "owner");
    const staff = await miembro(org, "reset-s", "staff");

    const r = await resetMemberPassword(ctx(dueno), org, (await membresia(org, staff.id))!.id, NUEVA);

    expect(r.ok).toBe(true);
    expect(await puedeEntrar(staff.email, TEST_PASSWORD)).toBe(false);
    expect(await puedeEntrar(staff.email, NUEVA)).toBe(true);
  });

  it("rechaza una contraseña débil sin cambiar nada", async () => {
    const org = await nuevaOrg("reset-debil");
    const dueno = await miembro(org, "reset-debil-d", "owner");
    const staff = await miembro(org, "reset-debil-s", "staff");

    const r = await resetMemberPassword(ctx(dueno), org, (await membresia(org, staff.id))!.id, "corta");

    expect(r).toEqual({ ok: false, error: "too_short" });
    expect(await puedeEntrar(staff.email, TEST_PASSWORD)).toBe(true);
  });

  it("no se restablece la contraseña de un Dueño (ni la propia)", async () => {
    const org = await nuevaOrg("reset-owner");
    const a = await miembro(org, "reset-owner-a", "owner");
    const b = await miembro(org, "reset-owner-b", "owner");

    expect(await resetMemberPassword(ctx(a), org, (await membresia(org, b.id))!.id, NUEVA)).toEqual({ ok: false, error: "owner_target" });
    expect(await resetMemberPassword(ctx(a), org, (await membresia(org, a.id))!.id, NUEVA)).toEqual({ ok: false, error: "self" });
    expect(await puedeEntrar(b.email, TEST_PASSWORD)).toBe(true);
  });

  it("no se toma una cuenta compartida con otro local: la contraseña no cambia", async () => {
    const org = await nuevaOrg("reset-comp-a");
    const otra = await nuevaOrg("reset-comp-b");
    const dueno = await miembro(org, "reset-comp-d", "owner");
    const multi = await miembro(org, "reset-comp-m", "staff");
    await addMembership(service, multi, otra, "owner");

    const r = await resetMemberPassword(ctx(dueno), org, (await membresia(org, multi.id))!.id, NUEVA);

    expect(r).toEqual({ ok: false, error: "shared_account" });
    expect(await puedeEntrar(multi.email, TEST_PASSWORD)).toBe(true);
    expect(await puedeEntrar(multi.email, NUEVA)).toBe(false);
  });

  it("el Staff, el Dueño ajeno y un id de otro local no pueden restablecer", async () => {
    const org = await nuevaOrg("reset-adv");
    const otra = await nuevaOrg("reset-adv-b");
    await miembro(org, "reset-adv-d", "owner");
    const staff = await miembro(org, "reset-adv-s", "staff");
    const objetivo = await miembro(org, "reset-adv-t", "staff");
    const duenoB = await miembro(otra, "reset-adv-bd", "owner");
    const idObjetivo = (await membresia(org, objetivo.id))!.id;

    expect(await resetMemberPassword(ctx(staff), org, idObjetivo, NUEVA)).toEqual({ ok: false, error: "forbidden" });
    expect(await resetMemberPassword(ctx(duenoB), org, idObjetivo, NUEVA)).toEqual({ ok: false, error: "forbidden" });
    expect(await resetMemberPassword(ctx(duenoB), otra, idObjetivo, NUEVA)).toEqual({ ok: false, error: "not_found" });
    expect(await puedeEntrar(objetivo.email, TEST_PASSWORD)).toBe(true);
  });

  it("se puede restablecer con la cuenta en solo lectura o suspendida", async () => {
    for (const estado of ["read_only", "suspended"] as const) {
      const slug = estado.replace("_", "-");
      const org = await nuevaOrg(`reset-${slug}`, estado);
      const dueno = await miembro(org, `reset-${estado}-d`, "owner");
      const staff = await miembro(org, `reset-${estado}-s`, "staff");

      const r = await resetMemberPassword(ctx(dueno), org, (await membresia(org, staff.id))!.id, NUEVA);

      expect(r.ok, estado).toBe(true);
      expect(await puedeEntrar(staff.email, NUEVA), estado).toBe(true);
    }
  });
});

describe("listado del personal", () => {
  it("el Dueño ve a su equipo con email y rol, y marca las cuentas compartidas", async () => {
    const org = await nuevaOrg("lista");
    const otra = await nuevaOrg("lista-b");
    const dueno = await miembro(org, "lista-d", "owner");
    const staff = await miembro(org, "lista-s", "staff");
    const multi = await miembro(org, "lista-m", "staff");
    await addMembership(service, multi, otra, "staff");

    const r = await listMembers(ctx(dueno), org);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.map((m) => [m.email, m.role, m.isSelf, m.sharedAccount])).toEqual(
      [
        [dueno.email, "owner", true, false],
        [multi.email, "staff", false, true],
        [staff.email, "staff", false, false],
      ].sort((a, b) => (a[1] === b[1] ? String(a[0]).localeCompare(String(b[0])) : a[1] === "owner" ? -1 : 1)),
    );
  });

  it("el Staff y el Dueño ajeno no reciben el listado", async () => {
    const org = await nuevaOrg("lista-adv");
    const otra = await nuevaOrg("lista-adv-b");
    await miembro(org, "lista-adv-d", "owner");
    const staff = await miembro(org, "lista-adv-s", "staff");
    const duenoB = await miembro(otra, "lista-adv-bd", "owner");

    expect(await listMembers(ctx(staff), org)).toEqual({ ok: false, error: "forbidden" });
    expect(await listMembers(ctx(duenoB), org)).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("cambiar la propia contraseña", () => {
  const verifier = () => anonClient();

  it("con la actual correcta cambia; la anterior deja de servir", async () => {
    const u = await nuevoUsuario("mi-cuenta");

    const r = await changeOwnPassword({ session: u.db, verifier: verifier() }, { current: TEST_PASSWORD, next: NUEVA });

    expect(r).toEqual({ ok: true });
    expect(await puedeEntrar(u.email, NUEVA)).toBe(true);
    expect(await puedeEntrar(u.email, TEST_PASSWORD)).toBe(false);
  });

  it("con la actual incorrecta no cambia nada", async () => {
    const u = await nuevoUsuario("mi-cuenta-mala");

    const r = await changeOwnPassword({ session: u.db, verifier: verifier() }, { current: "no-es-esta-123", next: NUEVA });

    expect(r).toEqual({ ok: false, error: "wrong_current" });
    expect(await puedeEntrar(u.email, TEST_PASSWORD)).toBe(true);
  });

  it("rechaza la nueva débil o igual a la actual", async () => {
    const u = await nuevoUsuario("mi-cuenta-debil");

    expect(await changeOwnPassword({ session: u.db, verifier: verifier() }, { current: TEST_PASSWORD, next: "corta" })).toEqual({
      ok: false,
      error: "too_short",
    });
    expect(await changeOwnPassword({ session: u.db, verifier: verifier() }, { current: TEST_PASSWORD, next: TEST_PASSWORD })).toEqual({
      ok: false,
      error: "same_password",
    });
  });

  it("sin sesión no cambia nada", async () => {
    const u = await nuevoUsuario("mi-cuenta-anon");

    const r = await changeOwnPassword({ session: anonClient(), verifier: verifier() }, { current: TEST_PASSWORD, next: NUEVA });

    expect(r).toEqual({ ok: false, error: "unauthenticated" });
    expect(await puedeEntrar(u.email, TEST_PASSWORD)).toBe(true);
  });
});
