import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createOrganization,
  isPlatformAdmin,
  listAuditLog,
  listOrganizations,
  type AdminContext,
  type CreateOrganizationInput,
} from "@/lib/admin/organizations";
import { billingState, parseEntitlements } from "@/lib/entitlements";
import { purgeAuditLogWhere } from "./purge-price-history";
import {
  anonClient,
  createUser,
  deleteOrg,
  deleteUser,
  serviceClient,
  setSubscription,
  sql,
  TEST_PASSWORD,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * SuperAdmin: alta de organizaciones (nivel C, ficha superadmin-alta-de-organizaciones) contra el Supabase local, con
 * los mismos clientes que usa el servidor: el de la PERSONA (RLS) como prueba de identidad y el de servicio para actuar.
 * El foco son los casos adversarios: quien no es SuperAdmin, escrituras directas a las tablas y a la función, y que un
 * alta fallida no deje nada (ni organización, ni cuenta de Auth, ni auditoría).
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const FUTURO = "2099-01-01"; // fuera de rango a propósito, para las pruebas de rechazo
const enDias = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
const OWNER_PASSWORD = "contrasena-del-dueno-123";

let service: Db;
let admin: TestUser;
let otroAdmin: TestUser;
let comun: TestUser; // con sesión pero sin ningún rol
let duenoAjeno: TestUser; // Dueño de otra organización
const orgsCreadas: string[] = [];
const emailsCreados: string[] = [];
const users: TestUser[] = [];
let orgAjena: string;

const ctx = (user: TestUser): AdminContext => ({ session: user.db, admin: service, actorId: user.id });

let contador = 0;
function entrada(cambios: Partial<CreateOrganizationInput> = {}): CreateOrganizationInput {
  contador += 1;
  const email = `rls-adm-dueno-${sufijo}-${contador}@example.test`;
  return {
    name: `Org de prueba ${contador}`,
    slug: `tt-adm-${sufijo}-${contador}`,
    ownerEmail: email,
    ownerPassword: OWNER_PASSWORD,
    plan: "pro",
    billingCycle: "yearly",
    periodEnd: enDias(30),
    ...cambios,
  };
}

async function crearOk(cambios: Partial<CreateOrganizationInput> = {}, actor: TestUser = admin) {
  const input = entrada(cambios);
  const result = await createOrganization(ctx(actor), input);
  if (!result.ok) throw new Error(`El alta debía funcionar y dio ${result.error}`);
  orgsCreadas.push(result.data.orgId);
  emailsCreados.push(result.data.ownerEmail);
  return { input, ...result.data };
}

const contar = (tabla: string, donde = "true") => Number(sql(`select count(*) from public.${tabla} where ${donde}`)[0][0]);
const totalUsuarios = async () => (await service.auth.admin.listUsers({ perPage: 1000 })).data.users.length;

/** Estado observable de «nada cambió»: organizaciones de prueba, auditoría de prueba y cuentas de Auth. */
async function foto() {
  return {
    orgs: contar("organizations", "slug like 'tt-adm-%'"),
    auditoria: contar("audit_log", "after->>'slug' like 'tt-adm-%'"),
    usuarios: await totalUsuarios(),
  };
}

async function nuevoUsuario(etiqueta: string) {
  const u = await createUser(service, `adm-${etiqueta}`);
  users.push(u);
  return u;
}

beforeAll(async () => {
  service = serviceClient();
  admin = await nuevoUsuario("admin");
  otroAdmin = await nuevoUsuario("otro-admin");
  comun = await nuevoUsuario("comun");
  duenoAjeno = await nuevoUsuario("dueno-ajeno");
  // Los SuperAdmin los agrega el operador con SQL: ni la API ni service_role pueden escribir esa tabla.
  sql(`insert into public.platform_admins (user_id) values ('${admin.id}'), ('${otroAdmin.id}')`);

  orgAjena = (await service.from("organizations").insert({ slug: `tt-adm-ajena-${sufijo}`, name: "ajena" }).select("id").single()).data!.id;
  orgsCreadas.push(orgAjena);
  await service.from("memberships").insert({ user_id: duenoAjeno.id, organization_id: orgAjena, role: "owner" });
});

afterAll(async () => {
  purgeAuditLogWhere(`after->>'slug' like 'tt-adm-%'`);
  for (const id of orgsCreadas) await deleteOrg(service, id);
  for (const email of emailsCreados) {
    const lista = (await service.auth.admin.listUsers({ perPage: 1000 })).data.users;
    const cuenta = lista.find((u) => u.email === email);
    if (cuenta) await service.auth.admin.deleteUser(cuenta.id);
  }
  for (const u of users) await deleteUser(service, u);
});

describe("platform_admins", () => {
  it("cada SuperAdmin ve solo su propia fila; el resto de las personas no ve ninguna", async () => {
    const propia = await admin.db.from("platform_admins").select("user_id");
    expect(propia.data?.map((r) => r.user_id)).toEqual([admin.id]);
    const otra = await comun.db.from("platform_admins").select("user_id");
    expect(otra.error).toBeNull();
    expect(otra.data).toEqual([]);
    expect(await isPlatformAdmin(ctx(admin))).toBe(true);
    expect(await isPlatformAdmin(ctx(comun))).toBe(false);
    expect(await isPlatformAdmin(ctx(duenoAjeno))).toBe(false);
  });

  it("anon no lee nada", async () => {
    const r = await anonClient().from("platform_admins").select("user_id");
    expect(r.data ?? []).toEqual([]);
  });

  it("nadie escribe por la API: ni un usuario común, ni un SuperAdmin, ni service_role", async () => {
    const miId = comun.id;
    expect((await comun.db.from("platform_admins").insert({ user_id: miId })).error).not.toBeNull();
    expect((await admin.db.from("platform_admins").insert({ user_id: comun.id })).error).not.toBeNull();
    expect((await service.from("platform_admins").insert({ user_id: comun.id })).error).not.toBeNull();
    expect((await service.from("platform_admins").delete().eq("user_id", otroAdmin.id)).error).not.toBeNull();
    expect(contar("platform_admins", `user_id = '${comun.id}'`)).toBe(0);
    expect(contar("platform_admins", `user_id = '${otroAdmin.id}'`)).toBe(1);
  });
});

describe("alta de una organización", () => {
  it("crea organización, cuenta del Dueño, membresía, suscripción y auditoría", async () => {
    const antes = Date.now();
    const alta = await crearOk({ plan: "pro", billingCycle: "yearly", periodEnd: enDias(30), name: "  Café Nuevo  " });

    const org = await service.from("organizations").select("id, slug, name, is_active").eq("id", alta.orgId).single();
    expect(org.data).toMatchObject({ slug: alta.input.slug, name: "Café Nuevo", is_active: true });

    const sub = await service.from("subscriptions").select("*").eq("organization_id", alta.orgId).single();
    expect(sub.data).toMatchObject({ plan_code: "pro", billing_cycle: "yearly", trial_ends_at: null });
    const fin = new Date(sub.data!.current_period_end!).getTime();
    // Final del día (UTC−3) de dentro de 30 días: entre 29 y 31 días desde ahora.
    expect(fin).toBeGreaterThan(antes + 29 * 86_400_000);
    expect(fin).toBeLessThan(antes + 31.2 * 86_400_000);

    const memberships = await service.from("memberships").select("user_id, role").eq("organization_id", alta.orgId);
    expect(memberships.data).toEqual([{ user_id: alta.ownerUserId, role: "owner" }]);

    const cuenta = await service.auth.admin.getUserById(alta.ownerUserId);
    expect(cuenta.data.user?.email).toBe(alta.ownerEmail);
  });

  it("deja UNA fila de auditoría con quién lo hizo, qué se hizo y cómo quedó, sin el email del Dueño", async () => {
    const alta = await crearOk({ plan: "premium", billingCycle: "monthly" });

    const filas = await sql(
      `select actor_id, actor_email, action, organization_id, before is null, after::text from public.audit_log where organization_id = '${alta.orgId}'`,
    );
    expect(filas).toHaveLength(1);
    const [actorId, actorEmail, action, orgId, beforeNulo, after] = filas[0];
    expect(actorId).toBe(admin.id);
    expect(actorEmail).toBe(admin.email);
    expect(action).toBe("organization.created");
    expect(orgId).toBe(alta.orgId);
    expect(beforeNulo).toBe("t");
    const despues = JSON.parse(after) as Record<string, unknown>;
    expect(despues).toMatchObject({
      slug: alta.input.slug,
      plan: "premium",
      billing_cycle: "monthly",
      owner_user_id: alta.ownerUserId,
    });
    expect(after).not.toContain(alta.ownerEmail);
  });

  it("el Dueño nuevo entra con su email y contraseña y ve el plan que se le asignó", async () => {
    const alta = await crearOk({ plan: "pro", billingCycle: "monthly", periodEnd: enDias(10) });
    const db = anonClient();
    const sesion = await db.auth.signInWithPassword({ email: alta.ownerEmail, password: OWNER_PASSWORD });
    expect(sesion.error).toBeNull();

    const ent = parseEntitlements((await db.rpc("org_entitlements", { p_org: alta.orgId })).data);
    expect(ent).toMatchObject({ state: "active", canWrite: true, plan: "pro", billingCycle: "monthly" });
    expect(ent?.features).toContain("waiter_call");
    const propias = await db.from("memberships").select("organization_id, role").eq("user_id", alta.ownerUserId);
    expect(propias.data).toEqual([{ organization_id: alta.orgId, role: "owner" }]);
  });

  it("el plan Básico tampoco conserva la prueba de 14 días: vale la fecha elegida", async () => {
    const alta = await crearOk({ plan: "basic", periodEnd: enDias(3) });
    const sub = await service.from("subscriptions").select("plan_code, trial_ends_at, current_period_end").eq("organization_id", alta.orgId).single();
    expect(sub.data?.plan_code).toBe("basic");
    expect(sub.data?.trial_ends_at).toBeNull();
    expect(new Date(sub.data!.current_period_end!).getTime()).toBeLessThan(Date.now() + 4.2 * 86_400_000);
  });

  it("no modifica nada de las demás organizaciones", async () => {
    const antes = sql(`select count(*), coalesce(sum(length(name)), 0) from public.organizations where id = '${orgAjena}'`);
    const sinAjena = sql(`select count(*) from public.memberships where organization_id = '${orgAjena}'`);
    await crearOk();
    expect(sql(`select count(*), coalesce(sum(length(name)), 0) from public.organizations where id = '${orgAjena}'`)).toEqual(antes);
    expect(sql(`select count(*) from public.memberships where organization_id = '${orgAjena}'`)).toEqual(sinAjena);
  });
});

describe("quién puede hacerlo", () => {
  it.each([
    ["una persona sin rol", () => comun],
    ["el Dueño de otra organización", () => duenoAjeno],
  ])("%s recibe «forbidden» y no se crea nada", async (_etiqueta, quien) => {
    const antes = await foto();
    const result = await createOrganization(ctx(quien()), entrada());
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(await foto()).toEqual(antes);
  });

  it("listar organizaciones también exige ser SuperAdmin", async () => {
    expect(await listOrganizations(ctx(comun))).toEqual({ ok: false, error: "forbidden" });
    expect(await listOrganizations(ctx(duenoAjeno))).toEqual({ ok: false, error: "forbidden" });
  });

  it("la función de base no se puede llamar por la API: ni anon, ni un SuperAdmin con su propia sesión", async () => {
    const antes = await foto();
    const args = (actor: string) => ({
      p_actor: actor,
      p_slug: `tt-adm-${sufijo}-api`,
      p_name: "directa",
      p_owner: comun.id,
      p_plan: "premium",
      p_billing_cycle: "monthly",
      p_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    });
    for (const [etiqueta, db, actor] of [
      ["anon", anonClient(), admin.id],
      ["SuperAdmin", admin.db, admin.id],
      ["usuario común", comun.db, comun.id],
    ] as const) {
      const r = await db.rpc("admin_create_organization", args(actor));
      expect(r.error?.code, etiqueta).toBe("42501");
    }
    expect(await foto()).toEqual(antes);
  });

  it("service_role tampoco puede crear «a nombre» de quien no es SuperAdmin (la función lo vuelve a comprobar)", async () => {
    const antes = await foto();
    const r = await service.rpc("admin_create_organization", {
      p_actor: comun.id,
      p_slug: `tt-adm-${sufijo}-falso`,
      p_name: "falso",
      p_owner: comun.id,
      p_plan: "basic",
      p_billing_cycle: "monthly",
      p_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(r.error?.code).toBe("42501");
    expect(r.error?.message).toContain("not_platform_admin");
    expect(await foto()).toEqual(antes);
  });
});

describe("un alta que falla no deja nada", () => {
  const invalidos: [string, Partial<CreateOrganizationInput>, string][] = [
    ["nombre vacío", { name: "   " }, "invalid_name"],
    ["slug con espacio", { slug: "Con Espacio" }, "invalid_slug"],
    ["slug con guion doble", { slug: "tt-adm--doble" }, "invalid_slug"],
    ["email inválido", { ownerEmail: "no-es-un-email" }, "invalid_email"],
    ["contraseña corta", { ownerPassword: "corta" }, "too_short"],
    ["contraseña en blanco", { ownerPassword: "          " }, "blank"],
    ["plan inexistente", { plan: "enterprise" }, "invalid_plan"],
    ["ciclo inexistente", { billingCycle: "weekly" }, "invalid_cycle"],
    ["fecha pasada", { periodEnd: "2020-01-01" }, "invalid_period"],
    ["fecha a más de 2 años", { periodEnd: FUTURO }, "invalid_period"],
    ["fecha imposible", { periodEnd: "2026-02-30" }, "invalid_period"],
  ];

  it.each(invalidos)("%s", async (_etiqueta, cambios, error) => {
    const antes = await foto();
    const result = await createOrganization(ctx(admin), entrada(cambios));
    expect(result).toEqual({ ok: false, error });
    expect(await foto()).toEqual(antes);
  });

  it("slug ya usado: «slug_taken», sin cuenta nueva ni auditoría", async () => {
    const primera = await crearOk();
    const antes = await foto();
    const result = await createOrganization(ctx(admin), entrada({ slug: primera.input.slug }));
    expect(result).toEqual({ ok: false, error: "slug_taken" });
    expect(await foto()).toEqual(antes);
  });

  it("email ya registrado: «email_taken», sin tocar esa cuenta ni crear la organización", async () => {
    const antes = await foto();
    const result = await createOrganization(ctx(admin), entrada({ ownerEmail: comun.email, ownerPassword: "otra-contrasena-123" }));
    expect(result).toEqual({ ok: false, error: "email_taken" });
    expect(await foto()).toEqual(antes);
    // La cuenta existente conserva SU contraseña (no se la pisó).
    const sesion = await anonClient().auth.signInWithPassword({ email: comun.email, password: TEST_PASSWORD });
    expect(sesion.error).toBeNull();
  });

  it("la transacción de base es de todo o nada: si falla al final, no queda ni la organización ni la suscripción", async () => {
    // La base rechaza (23503: el Dueño no existe) DESPUÉS de haber insertado la organización y la suscripción.
    const antes = await foto();
    const r = await service.rpc("admin_create_organization", {
      p_actor: admin.id,
      p_slug: `tt-adm-${sufijo}-rollback`,
      p_name: "rollback",
      p_owner: "00000000-0000-4000-8000-0000000000ff",
      p_plan: "pro",
      p_billing_cycle: "monthly",
      p_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(r.error?.code).toBe("23503");
    expect(await foto()).toEqual(antes);
    expect(contar("subscriptions", `organization_id in (select id from public.organizations where slug = 'tt-adm-${sufijo}-rollback')`)).toBe(0);
  });

  it("la función de base también valida por sí sola el período y el plan (no depende de la aplicación)", async () => {
    const antes = await foto();
    const base = {
      p_actor: admin.id,
      p_name: "directa",
      p_owner: comun.id,
      p_plan: "pro",
      p_billing_cycle: "monthly",
    };
    const manana = new Date(Date.now() + 86_400_000).toISOString();
    const casos: [string, Record<string, string | null>, string][] = [
      ["período pasado", { p_period_end: new Date(Date.now() - 1000).toISOString() }, "invalid_period"],
      ["período a más de 731 días", { p_period_end: new Date(Date.now() + 732 * 86_400_000).toISOString() }, "invalid_period"],
      ["período nulo", { p_period_end: null }, "invalid_period"],
      ["plan inexistente", { p_period_end: manana, p_plan: "enterprise" }, "invalid_plan"],
    ];
    for (const [etiqueta, extra, mensaje] of casos) {
      const r = await service.rpc("admin_create_organization", { ...base, p_slug: `tt-adm-${sufijo}-directa`, p_period_end: manana, ...extra } as never);
      expect(r.error?.code, etiqueta).toBe("22023");
      expect(r.error?.message, etiqueta).toContain(mensaje);
    }
    const ciclo = await service.rpc("admin_create_organization", { ...base, p_slug: `tt-adm-${sufijo}-directa`, p_period_end: manana, p_billing_cycle: "weekly" });
    expect(ciclo.error?.code).toBe("23514");
    const sinActor = await service.rpc("admin_create_organization", { ...base, p_actor: null as never, p_slug: `tt-adm-${sufijo}-directa`, p_period_end: manana });
    expect(sinActor.error?.code).toBe("42501");
    expect(await foto()).toEqual(antes);
  });

  it("si la base rechaza el alta DESPUÉS de crear la cuenta de Auth, esa cuenta se borra (compensación)", async () => {
    const ocupada = await crearOk();
    const antes = await foto();
    // Se salta la comprobación temprana del slug para forzar el choque dentro de la transacción de base.
    const sinPrecomprobacion = new Proxy(service, {
      get(target, prop) {
        if (prop === "from") {
          return (tabla: string) =>
            tabla === "organizations"
              ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
              : target.from(tabla as never);
        }
        const valor = Reflect.get(target, prop, target);
        return typeof valor === "function" ? valor.bind(target) : valor;
      },
    }) as Db;

    const input = entrada({ slug: ocupada.input.slug });
    const result = await createOrganization({ session: admin.db, admin: sinPrecomprobacion, actorId: admin.id }, input);
    expect(result).toEqual({ ok: false, error: "slug_taken" });
    expect(await foto()).toEqual(antes); // la cuenta que llegó a crearse ya no está
    const lista = (await service.auth.admin.listUsers({ perPage: 1000 })).data.users;
    expect(lista.some((u) => u.email === String(input.ownerEmail).toLowerCase())).toBe(false);
  });

  it("dos altas simultáneas con el mismo slug: gana una y la otra no deja cuenta de Auth ni auditoría", async () => {
    const slug = `tt-adm-${sufijo}-carrera`;
    const a = entrada({ slug });
    const b = entrada({ slug });
    const antes = await totalUsuarios();
    const [ra, rb] = await Promise.all([createOrganization(ctx(admin), a), createOrganization(ctx(otroAdmin), b)]);

    const ganadoras = [ra, rb].filter((r) => r.ok);
    const perdedoras = [ra, rb].filter((r) => !r.ok);
    expect(ganadoras).toHaveLength(1);
    expect(perdedoras).toEqual([{ ok: false, error: "slug_taken" }]);
    const ganadora = ganadoras[0];
    if (!ganadora.ok) throw new Error("inalcanzable");
    orgsCreadas.push(ganadora.data.orgId);
    emailsCreados.push(ganadora.data.ownerEmail);

    expect(contar("audit_log", `after->>'slug' = '${slug}'`)).toBe(1);
    expect(contar("organizations", `slug = '${slug}'`)).toBe(1);
    expect(await totalUsuarios()).toBe(antes + 1); // solo la cuenta de la ganadora
  });
});

describe("resultado incierto del alta (se pierde la respuesta)", () => {
  type Modo = "perdida-despues-del-commit" | "perdida-antes-de-llegar";

  /** Un cliente de servicio cuya llamada a la función «se corta»: ejecuta o no la real, pero devuelve un error sin SQLSTATE. */
  function conRespuestaPerdida(
    modo: Modo,
    opciones: { fallaLaBusqueda?: boolean; mientrasTanto?: () => Promise<unknown>; confirmaAntesDeCompensar?: boolean } = {},
  ): Db {
    let llamada = false;
    // Con `confirmaAntesDeCompensar` la función real se ejecuta RECIÉN cuando la aplicación va a borrar la cuenta:
    // la comprobación previa no la ve y el commit cae justo antes del borrado (la carrera que reportó la revisión).
    let diferida: (() => PromiseLike<unknown>) | undefined;
    const perdido = { data: null, error: { message: "TypeError: fetch failed", details: "", hint: "", code: "" }, status: 0, statusText: "", count: null };
    return new Proxy(service, {
      get(target, prop) {
        if (prop === "rpc") {
          return async (...args: unknown[]) => {
            llamada = true;
            await opciones.mientrasTanto?.();
            const real = () => (target.rpc as (...a: unknown[]) => PromiseLike<unknown>)(...args);
            if (opciones.confirmaAntesDeCompensar) diferida = real;
            else if (modo === "perdida-despues-del-commit") await real();
            return perdido;
          };
        }
        if (prop === "auth" && opciones.confirmaAntesDeCompensar) {
          return new Proxy(target.auth, {
            get(auth, q) {
              if (q !== "admin") return Reflect.get(auth, q, auth);
              return new Proxy(auth.admin, {
                get(admin, r) {
                  if (r === "deleteUser") {
                    return async (id: string) => {
                      await diferida?.(); // el alta se confirma justo antes del borrado
                      return admin.deleteUser(id);
                    };
                  }
                  const valor = Reflect.get(admin, r, admin);
                  return typeof valor === "function" ? valor.bind(admin) : valor;
                },
              });
            },
          });
        }
        if (prop === "from" && opciones.fallaLaBusqueda) {
          return (tabla: string) =>
            llamada && tabla === "organizations"
              ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) }) }
              : target.from(tabla as never);
        }
        const valor = Reflect.get(target, prop, target);
        return typeof valor === "function" ? valor.bind(target) : valor;
      },
    }) as Db;
  }

  const con = (cliente: Db): AdminContext => ({ session: admin.db, admin: cliente, actorId: admin.id });

  it("si el alta se confirmó y solo se perdió la respuesta, se reconcilia: éxito, sin borrar al Dueño", async () => {
    const input = entrada();
    const result = await createOrganization(con(conRespuestaPerdida("perdida-despues-del-commit")), input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    orgsCreadas.push(result.data.orgId);
    emailsCreados.push(result.data.ownerEmail);

    const cuenta = await service.auth.admin.getUserById(result.data.ownerUserId);
    expect(cuenta.data.user?.email).toBe(result.data.ownerEmail);
    expect(contar("memberships", `organization_id = '${result.data.orgId}' and role = 'owner'`)).toBe(1);
    expect(contar("audit_log", `organization_id = '${result.data.orgId}'`)).toBe(1);
    // El Dueño puede entrar: nada se compensó.
    const sesion = await anonClient().auth.signInWithPassword({ email: result.data.ownerEmail, password: OWNER_PASSWORD });
    expect(sesion.error).toBeNull();
  });

  it("si el alta se confirma justo entre la comprobación y el borrado, la guarda del último Dueño frena el borrado y se informa éxito", async () => {
    const input = entrada();
    const cliente = conRespuestaPerdida("perdida-despues-del-commit", { confirmaAntesDeCompensar: true });
    const result = await createOrganization(con(cliente), input);

    expect(result.ok).toBe(true); // no «No se creó nada»: el alta existe
    if (!result.ok) return;
    orgsCreadas.push(result.data.orgId);
    emailsCreados.push(result.data.ownerEmail);
    expect(contar("memberships", `organization_id = '${result.data.orgId}' and role = 'owner'`)).toBe(1);
    const sesion = await anonClient().auth.signInWithPassword({ email: result.data.ownerEmail, password: OWNER_PASSWORD });
    expect(sesion.error).toBeNull();
  });

  it("si el pedido no llegó a la base, se comprueba que no hay alta y se compensa (sin cuenta suelta)", async () => {
    const antes = await foto();
    const result = await createOrganization(con(conRespuestaPerdida("perdida-antes-de-llegar")), entrada());
    expect(result).toEqual({ ok: false, error: "unexpected" });
    expect(await foto()).toEqual(antes);
  });

  it("si el slug lo ganó OTRA alta mientras tanto, no se toma por propia: se compensa y la otra organización queda intacta", async () => {
    const slug = `tt-adm-${sufijo}-ganada`;
    const mia = entrada({ slug });
    const otra = entrada({ slug });
    let ajena: Awaited<ReturnType<typeof crearOk>> | undefined;
    const cliente = conRespuestaPerdida("perdida-antes-de-llegar", {
      mientrasTanto: async () => {
        ajena = await crearOk({ slug, ownerEmail: otra.ownerEmail });
      },
    });
    const result = await createOrganization(con(cliente), mia);

    expect(result.ok).toBe(false); // no se hace pasar la organización de otro por la propia
    expect(ajena).toBeDefined();
    const duenos = await service.from("memberships").select("user_id").eq("organization_id", ajena!.orgId).eq("role", "owner");
    expect(duenos.data).toEqual([{ user_id: ajena!.ownerUserId }]); // sigue siendo de la otra alta
    const lista = (await service.auth.admin.listUsers({ perPage: 1000 })).data.users;
    expect(lista.some((u) => u.email === String(mia.ownerEmail).toLowerCase())).toBe(false); // su cuenta se compensó
    expect(contar("audit_log", `organization_id = '${ajena!.orgId}'`)).toBe(1);
  });

  it("si ni siquiera se puede comprobar, devuelve «uncertain» y NO borra nada (el alta quedó hecha y sigue válida)", async () => {
    const input = entrada();
    const result = await createOrganization(con(conRespuestaPerdida("perdida-despues-del-commit", { fallaLaBusqueda: true })), input);
    expect(result).toEqual({ ok: false, error: "uncertain" });

    const slug = String(input.slug);
    const org = await service.from("organizations").select("id").eq("slug", slug).single();
    expect(org.data?.id).toBeTruthy();
    orgsCreadas.push(org.data!.id);
    emailsCreados.push(String(input.ownerEmail).toLowerCase());
    // La cuenta del Dueño sigue y la organización es usable.
    const sesion = await anonClient().auth.signInWithPassword({ email: String(input.ownerEmail).toLowerCase(), password: OWNER_PASSWORD });
    expect(sesion.error).toBeNull();
    expect(contar("memberships", `organization_id = '${org.data!.id}' and role = 'owner'`)).toBe(1);
  });

  it("un error de la base (SQLSTATE) no se reconcilia: es un rollback seguro y compensa directo", async () => {
    // slug ocupado por otra organización con otro Dueño: 23505, se compensa y se informa «slug_taken».
    const ocupada = await crearOk();
    const antes = await foto();
    const sinPrecomprobacion = new Proxy(service, {
      get(target, prop) {
        if (prop === "from") {
          return (tabla: string) =>
            tabla === "organizations"
              ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
              : target.from(tabla as never);
        }
        const valor = Reflect.get(target, prop, target);
        return typeof valor === "function" ? valor.bind(target) : valor;
      },
    }) as Db;
    const result = await createOrganization(con(sinPrecomprobacion), entrada({ slug: ocupada.input.slug }));
    expect(result).toEqual({ ok: false, error: "slug_taken" });
    expect(await foto()).toEqual(antes);
  });
});

describe("estado de la cuenta en el listado", () => {
  const HORA = 3600_000;

  it.each([
    ["al día (vence en 2 días)", 2 * 24 * HORA, "active"],
    ["2 días vencida: gracia", -2 * 24 * HORA, "grace"],
    ["10 días vencida: solo lectura", -10 * 24 * HORA, "read_only"],
    ["20 días vencida: suspendida", -20 * 24 * HORA, "suspended"],
  ] as const)("%s", async (_etiqueta, finEnMs, estado) => {
    const alta = await crearOk();
    await setSubscription(service, alta.orgId, { finEnMs });
    const result = await listOrganizations(ctx(admin));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fila = result.data.find((o) => o.id === alta.orgId);
    expect(fila?.state).toBe(estado);
    // Es el mismo estado que decide la base.
    expect(sql(`select private.org_state('${alta.orgId}')`)).toEqual([[estado]]);
  });

  it("la regla de la aplicación coincide con private.billing_state de la base en los bordes", () => {
    const fin = new Date("2026-10-01T15:00:00.000Z");
    const HORAS = [0, 168, 360];
    for (const horas of HORAS) {
      for (const delta of [-1000, 0, 1000]) {
        const en = new Date(fin.getTime() + horas * HORA + delta);
        const base = sql(`select private.billing_state('${fin.toISOString()}'::timestamptz, '${en.toISOString()}'::timestamptz)`)[0][0];
        expect(billingState(fin, en), `+${horas} h ${delta} ms`).toBe(base);
      }
    }
    expect(sql(`select private.billing_state(null, now())`)[0][0]).toBe(billingState(null));
  });
});

describe("auditoría (audit_log)", () => {
  it("los SuperAdmin la leen; las demás personas y anon no ven nada", async () => {
    const alta = await crearOk();
    const propia = await listAuditLog(ctx(admin));
    expect(propia.ok && propia.data.some((e) => e.organizationId === alta.orgId && e.actorEmail === admin.email)).toBe(true);
    // Otro SuperAdmin ve el movimiento del primero: la auditoría es de la plataforma.
    const ajena = await listAuditLog(ctx(otroAdmin));
    expect(ajena.ok && ajena.data.some((e) => e.organizationId === alta.orgId)).toBe(true);

    for (const db of [comun.db, duenoAjeno.db, anonClient()]) {
      const r = await db.from("audit_log").select("id").eq("organization_id", alta.orgId);
      expect(r.data ?? []).toEqual([]);
    }
    // Ni siquiera el Dueño de la organización recién creada la ve (por ahora: ficha, decisión 6).
    const sesion = anonClient();
    await sesion.auth.signInWithPassword({ email: alta.ownerEmail, password: OWNER_PASSWORD });
    expect((await sesion.from("audit_log").select("id")).data ?? []).toEqual([]);
  });

  it("nadie escribe por la API (ni SuperAdmin ni service_role): ni insertar, ni modificar, ni borrar", async () => {
    const alta = await crearOk();
    const fila = {
      actor_id: admin.id,
      actor_email: admin.email,
      action: "organization.created",
      organization_id: alta.orgId,
    };
    for (const [etiqueta, db] of [
      ["SuperAdmin", admin.db],
      ["service_role", service],
      ["común", comun.db],
    ] as const) {
      expect((await db.from("audit_log").insert(fila)).error, `${etiqueta} insert`).not.toBeNull();
      expect((await db.from("audit_log").update({ actor_email: "x@x.test" }).eq("organization_id", alta.orgId)).error, `${etiqueta} update`).not.toBeNull();
      expect((await db.from("audit_log").delete().eq("organization_id", alta.orgId)).error, `${etiqueta} delete`).not.toBeNull();
    }
    expect(contar("audit_log", `organization_id = '${alta.orgId}'`)).toBe(1);
  });

  it("ni siquiera el dueño de la tabla modifica o borra una fila (trigger de solo-agregado)", async () => {
    const alta = await crearOk();
    expect(() => sql(`update public.audit_log set actor_email = 'otro' where organization_id = '${alta.orgId}'`)).toThrow();
    expect(() => sql(`delete from public.audit_log where organization_id = '${alta.orgId}'`)).toThrow();
    expect(() => sql(`truncate public.audit_log`)).toThrow();
    expect(contar("audit_log", `organization_id = '${alta.orgId}' and actor_email = '${admin.email}'`)).toBe(1);
  });

  it("sobrevive a la baja del SuperAdmin y de la organización (sin claves foráneas)", async () => {
    const efimero = await nuevoUsuario("efimero");
    sql(`insert into public.platform_admins (user_id) values ('${efimero.id}')`);
    const alta = await crearOk({}, efimero);
    await deleteUser(service, efimero);
    users.splice(users.indexOf(efimero), 1);
    expect(contar("platform_admins", `user_id = '${efimero.id}'`)).toBe(0);
    const fila = sql(`select actor_id, actor_email from public.audit_log where organization_id = '${alta.orgId}'`);
    expect(fila).toEqual([[efimero.id, efimero.email]]);

    await deleteOrg(service, alta.orgId); // borra la organización: la fila de auditoría queda
    expect(contar("audit_log", `organization_id = '${alta.orgId}'`)).toBe(1);
  });
});

describe("listado de organizaciones", () => {
  it("un SuperAdmin ve la organización nueva con su plan, su vencimiento y su Dueño", async () => {
    const alta = await crearOk({ plan: "premium", billingCycle: "yearly", periodEnd: enDias(60) });
    const result = await listOrganizations(ctx(admin));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fila = result.data.find((o) => o.id === alta.orgId);
    expect(fila).toMatchObject({ slug: alta.input.slug, plan: "premium", billingCycle: "yearly", ownerEmails: [alta.ownerEmail], isActive: true });
    expect(new Date(fila!.periodEnd!).getTime()).toBeGreaterThan(Date.now() + 59 * 86_400_000);
  });
});
