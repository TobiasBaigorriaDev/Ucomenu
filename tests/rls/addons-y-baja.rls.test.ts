import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminContext } from "@/lib/admin/organizations";
import { endAddon, getOrganizationDetail, registerPayment, setAddon, setOrganizationActive } from "@/lib/admin/subscriptions";
import { parseEntitlements } from "@/lib/entitlements";
import { asegurarDestinoLocal, purgeAuditLogWhere } from "./purge-price-history";
import {
  addMembership,
  anonClient,
  createCategory,
  createOrg,
  createUser,
  deleteOrg,
  deleteUser,
  DIA_MS,
  serviceClient,
  setSubscription,
  sql,
  type Db,
  type PlanCode,
  type TestUser,
} from "./helpers";

/**
 * SuperAdmin: add-ons y baja de organizaciones (nivel C, ficha addons-y-baja-de-organizaciones, ADR 0025) contra el
 * Supabase local, con los mismos clientes que usa el servidor. El foco: quién puede, que cada rechazo no deje huella,
 * que el cupo y las features salgan del add-on vigente y del plan, y que una organización dada de baja quede cerrada por RLS
 * (nadie del local lee ni escribe) sin perder nada y vuelva entera al reactivarla.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const hoyAr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
const enDias = (dias: number) => new Date(Date.now() + dias * DIA_MS).toISOString().slice(0, 10);

let service: Db;
let admin: TestUser;
let comun: TestUser;
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

const ctx = (user: TestUser): AdminContext => ({ session: user.db, admin: service, actorId: user.id });

type Local = { id: string; slug: string; owner: TestUser; staff: TestUser };

/** Una organización propia con Dueño y Staff, al día (vence en 30 días), con una sucursal «principal». */
async function crearLocal(plan: PlanCode = "pro"): Promise<Local> {
  contador += 1;
  const slug = `tt-addon-${sufijo}-${contador}`;
  const id = await createOrg(service, slug, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const branch = await service.from("branches").insert({ organization_id: id, slug: "principal", name: "Principal" });
  if (branch.error) throw new Error(`No se pudo crear la sucursal: ${branch.error.message}`);
  const owner = await createUser(service, `addon-d${contador}`);
  const staff = await createUser(service, `addon-s${contador}`);
  users.push(owner, staff);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, slug, owner, staff };
}

const auditoria = async (orgId: string) =>
  (await service.from("audit_log").select("*").eq("organization_id", orgId).order("created_at", { ascending: true })).data!;
const accionesDe = async (orgId: string) => (await auditoria(orgId)).map((a) => a.action);
const contratos = async (orgId: string) => (await service.from("subscription_addons").select("*").eq("organization_id", orgId)).data!;
const suscripcion = async (orgId: string) => (await service.from("subscriptions").select("*").eq("organization_id", orgId).single()).data!;
const organizacion = async (orgId: string) => (await service.from("organizations").select("*").eq("id", orgId).single()).data!;

async function entitlements(user: TestUser, orgId: string) {
  const { data, error } = await user.db.rpc("org_entitlements", { p_org: orgId });
  expect(error).toBeNull();
  return parseEntitlements(data);
}

const activar = (local: Pick<Local, "slug">, cambios: Partial<Parameters<typeof setAddon>[1]> = {}, quien: TestUser = admin) =>
  setAddon(ctx(quien), { slug: local.slug, addon: "webar", extraPacks: "0", endsOn: "", reason: "Contrató WebAR", ...cambios });
const finalizar = (local: Pick<Local, "slug">, reason: unknown = "Dejó de pagarlo", quien: TestUser = admin) =>
  endAddon(ctx(quien), { slug: local.slug, addon: "webar", reason });
const baja = (local: Pick<Local, "slug">, active: boolean, reason: unknown = "Cierra el local", quien: TestUser = admin) =>
  setOrganizationActive(ctx(quien), { slug: local.slug, active, reason });

const estadoCarta = (local: Pick<Local, "slug">, branch = "principal") =>
  anonClient().rpc("public_menu_status", { p_org_slug: local.slug, p_branch_slug: branch });

const execFileAsync = promisify(execFile);

/**
 * Una llamada con el reloj de transacción VIEJO: una sola transacción de psql que fija `now()` al empezar, espera y recién
 * entonces llama a la función. Es lo que le pasa a un pedido que esperó el lock mientras otro confirmaba su cambio, pero sin
 * depender de la suerte del orden: con `now()` en lugar del instante real, ve «del futuro» lo que el otro confirmó.
 */
async function conRelojViejo(llamada: string, esperaSegundos: number, enMedio: () => Promise<unknown>) {
  const contenedor = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
  asegurarDestinoLocal(contenedor);
  const lenta = execFileAsync(
    "docker",
    ["exec", contenedor, "psql", "-U", "postgres", "-At", "-c", `select now(); select pg_sleep(${esperaSegundos}); select ${llamada};`],
    { encoding: "utf8" },
  ).then(
    () => ({ error: null as string | null }),
    (e: { stderr?: string }) => ({ error: String(e.stderr ?? e) }),
  );
  // Sincronización explícita: no sigue hasta que la base muestre esa sesión DENTRO de pg_sleep (o sea, con la transacción ya
  // iniciada y su `now()` fijado). Un tiempo fijo podría dejar que `enMedio` confirme antes y la prueba no probaría nada.
  const marca = llamada.replaceAll("'", "''");
  let durmiendo = false;
  for (let intento = 0; intento < 50 && !durmiendo; intento++) {
    durmiendo =
      sql(
        `select count(*) from pg_stat_activity where pid <> pg_backend_pid() and wait_event = 'PgSleep' and query like '%${marca}%'`,
      )[0][0] === "1";
    if (!durmiendo) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!durmiendo) throw new Error("la transacción con el reloj viejo no llegó a dormir: la prueba no sería válida");
  await enMedio();
  return lenta;
}

beforeAll(async () => {
  service = serviceClient();
  admin = await createUser(service, "addon-admin");
  comun = await createUser(service, "addon-comun");
  users.push(admin, comun);
  sql(`insert into public.platform_admins (user_id) values ('${admin.id}')`);
});

afterAll(async () => {
  purgeAuditLogWhere(`after->>'slug' like 'tt-addon-%'`);
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("quién puede: solo SuperAdmin, solo por el servidor", () => {
  it("ninguna sesión (ni la de un SuperAdmin) ni anon pueden llamar las tres funciones por la API", async () => {
    const local = await crearLocal();
    const antesSub = await suscripcion(local.id);
    for (const [nombre, db, actor] of [
      ["SuperAdmin con sesión", admin.db, admin.id],
      ["Dueño", local.owner.db, local.owner.id],
      ["Staff", local.staff.db, local.staff.id],
      ["anon", anonClient(), admin.id],
    ] as const) {
      const llamadas = [
        db.rpc("admin_set_addon", { p_actor: actor, p_org: local.id, p_addon: "webar", p_extra_packs: 0, p_ends_at: null as unknown as string, p_reason: "x" }),
        db.rpc("admin_end_addon", { p_actor: actor, p_org: local.id, p_addon: "webar", p_reason: "x" }),
        db.rpc("admin_set_organization_active", { p_actor: actor, p_org: local.id, p_active: false, p_reason: "x" }),
      ];
      for (const r of await Promise.all(llamadas)) expect(r.error?.code, nombre).toBe("42501");
    }
    expect(await contratos(local.id)).toEqual([]);
    expect((await organizacion(local.id)).is_active).toBe(true);
    expect(await suscripcion(local.id)).toEqual(antesSub);
    expect(await auditoria(local.id)).toEqual([]);
  });

  it("con service_role, un actor que no es SuperAdmin (Dueño, Staff, cuenta común, nulo, desconocido) no cambia nada", async () => {
    const local = await crearLocal();
    for (const actor of [local.owner.id, local.staff.id, comun.id, null, randomUUID()]) {
      const llamadas = [
        service.rpc("admin_set_addon", { p_actor: actor as string, p_org: local.id, p_addon: "webar", p_extra_packs: 0, p_ends_at: null as unknown as string, p_reason: "x" }),
        service.rpc("admin_end_addon", { p_actor: actor as string, p_org: local.id, p_addon: "webar", p_reason: "x" }),
        service.rpc("admin_set_organization_active", { p_actor: actor as string, p_org: local.id, p_active: false, p_reason: "x" }),
      ];
      for (const r of await Promise.all(llamadas)) {
        expect(r.error?.code, String(actor)).toBe("42501");
        expect(r.error?.message).toBe("not_platform_admin");
      }
    }
    expect(await contratos(local.id)).toEqual([]);
    expect((await organizacion(local.id)).is_active).toBe(true);
    expect(await auditoria(local.id)).toEqual([]);
  });

  it("el módulo rechaza a quien no es SuperAdmin antes de tocar nada", async () => {
    const local = await crearLocal();
    for (const quien of [local.owner, local.staff, comun]) {
      expect(await activar(local, {}, quien)).toEqual({ ok: false, error: "forbidden" });
      expect(await finalizar(local, "x", quien)).toEqual({ ok: false, error: "forbidden" });
      expect(await baja(local, false, "x", quien)).toEqual({ ok: false, error: "forbidden" });
    }
    expect(await contratos(local.id)).toEqual([]);
    expect((await organizacion(local.id)).is_active).toBe(true);
  });

  it("el Dueño no escribe subscription_addons ni is_active por la API", async () => {
    const local = await crearLocal();
    expect((await activar(local)).ok).toBe(true);
    const insertar = await local.owner.db.from("subscription_addons").insert({ organization_id: local.id, addon_code: "webar", extra_packs: 9 });
    expect(insertar.error).not.toBeNull();
    const actualizar = await local.owner.db.from("subscription_addons").update({ extra_packs: 40 }).eq("organization_id", local.id).select("id");
    expect(actualizar.error ?? actualizar.data?.length === 0 ? "bloqueado" : "escribió").toBe("bloqueado");
    const apagar = await local.owner.db.from("organizations").update({ is_active: false }).eq("id", local.id).select("id");
    expect(apagar.error ?? apagar.data?.length === 0 ? "bloqueado" : "escribió").toBe("bloqueado");
    expect((await contratos(local.id))[0].extra_packs).toBe(0);
    expect((await organizacion(local.id)).is_active).toBe(true);
  });
});

describe("add-ons: activar, cambiar y finalizar", () => {
  it("activa WebAR sobre Pro: cupo base, feature para el Dueño, una auditoría con motivo", async () => {
    const local = await crearLocal("pro");
    expect(await activar(local)).toEqual({ ok: true, data: undefined });

    const [fila] = await contratos(local.id);
    expect(fila).toMatchObject({ addon_code: "webar", extra_packs: 0, ends_at: null });
    const ent = (await entitlements(local.owner, local.id))!;
    expect(ent.features).toContain("webar");
    expect(ent.limits.models_3d).toBe(15);

    const log = await auditoria(local.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "addon.activated", actor_id: admin.id, before: { active: false } });
    expect(log[0].after).toMatchObject({ slug: local.slug, addon: "webar", extra_packs: 0, ends_at: null, model_quota: 15, reason: "Contrató WebAR" });
  });

  it("con packs y fecha de fin: 15 + 2 × 10 platos; cambiar es «addon.changed» y guarda el antes", async () => {
    const local = await crearLocal("premium");
    expect((await activar(local)).ok).toBe(true);
    expect((await activar(local, { extraPacks: "2", endsOn: enDias(60), reason: "Pidió dos packs" })).ok).toBe(true);

    const [fila] = await contratos(local.id);
    expect(fila.extra_packs).toBe(2);
    expect(new Date(fila.ends_at!).getTime()).toBeGreaterThan(Date.now() + 59 * DIA_MS);
    expect((await entitlements(local.owner, local.id))!.limits.models_3d).toBe(35);

    expect(await accionesDe(local.id)).toEqual(["addon.activated", "addon.changed"]);
    const cambio = (await auditoria(local.id))[1];
    expect(cambio.before).toMatchObject({ active: true, extra_packs: 0, ends_at: null });
    expect(cambio.after).toMatchObject({ extra_packs: 2, model_quota: 35, reason: "Pidió dos packs" });
    expect(await contratos(local.id)).toHaveLength(1);
  });

  it("quitar la fecha de fin (campo vacío) también es un cambio", async () => {
    const local = await crearLocal("pro");
    expect((await activar(local, { endsOn: enDias(30) })).ok).toBe(true);
    expect((await activar(local, { endsOn: "" })).ok).toBe(true);
    expect((await contratos(local.id))[0].ends_at).toBeNull();
    expect(await accionesDe(local.id)).toEqual(["addon.activated", "addon.changed"]);
  });

  it("repetir lo mismo se rechaza como «sin cambios» y no deja auditoría", async () => {
    const local = await crearLocal("pro");
    expect((await activar(local, { extraPacks: "1" })).ok).toBe(true);
    expect(await activar(local, { extraPacks: "1" })).toEqual({ ok: false, error: "addon_unchanged" });
    expect(await accionesDe(local.id)).toEqual(["addon.activated"]);
  });

  it("no se activa sobre un plan que no lo admite (Básico) y no deja huella", async () => {
    const local = await crearLocal("basic");
    expect(await activar(local)).toEqual({ ok: false, error: "addon_not_allowed" });
    expect(await contratos(local.id)).toEqual([]);
    expect(await auditoria(local.id)).toEqual([]);
  });

  it("bajar el plan a Básico deja la fila pero sin feature ni cupo (lo concede el plan)", async () => {
    const local = await crearLocal("pro");
    expect((await activar(local)).ok).toBe(true);
    expect((await entitlements(local.owner, local.id))!.features).toContain("webar");
    await setSubscription(service, local.id, { plan: "basic" });
    const ent = (await entitlements(local.owner, local.id))!;
    expect(ent.features).not.toContain("webar");
    expect(ent.limits.models_3d).toBe(0);
    expect(await contratos(local.id)).toHaveLength(1);
    // Con Básico no se puede cambiar, pero sí finalizar.
    expect(await activar(local, { extraPacks: "3" })).toEqual({ ok: false, error: "addon_not_allowed" });
    expect((await finalizar(local)).ok).toBe(true);
  });

  it("rechaza sin huella: addon, packs, fecha y motivo inválidos", async () => {
    const local = await crearLocal("pro");
    const casos: [string, Awaited<ReturnType<typeof activar>>, string][] = [
      ["addon desconocido", await activar(local, { addon: "otro" }), "invalid_addon"],
      ["packs negativos", await activar(local, { extraPacks: "-1" }), "invalid_packs"],
      ["packs de más", await activar(local, { extraPacks: "51" }), "invalid_packs"],
      ["packs con decimales", await activar(local, { extraPacks: "1.5" }), "invalid_packs"],
      ["fecha pasada", await activar(local, { endsOn: "2020-01-01" }), "invalid_ends_at"],
      ["fecha inexistente", await activar(local, { endsOn: "2026-02-31" }), "invalid_ends_at"],
      ["fecha muy lejana", await activar(local, { endsOn: enDias(800) }), "invalid_ends_at"],
      ["motivo vacío", await activar(local, { reason: "  " }), "invalid_reason"],
      ["motivo largo", await activar(local, { reason: "x".repeat(201) }), "invalid_reason"],
    ];
    for (const [nombre, resultado, error] of casos) expect(resultado, nombre).toEqual({ ok: false, error });
    expect(await contratos(local.id)).toEqual([]);
    expect(await auditoria(local.id)).toEqual([]);
  });

  it("la base valida por su cuenta (sin pasar por el módulo): packs, fecha y addon", async () => {
    const local = await crearLocal("pro");
    const llamar = (extra: number, fin: string | null, addon = "webar") =>
      service.rpc("admin_set_addon", { p_actor: admin.id, p_org: local.id, p_addon: addon, p_extra_packs: extra, p_ends_at: fin as string, p_reason: "x" });
    expect((await llamar(-1, null)).error?.message).toBe("invalid_packs");
    expect((await llamar(51, null)).error?.message).toBe("invalid_packs");
    expect((await llamar(1, new Date(Date.now() - 1000).toISOString())).error?.message).toBe("invalid_ends_at");
    expect((await llamar(1, new Date(Date.now() + 800 * DIA_MS).toISOString())).error?.message).toBe("invalid_ends_at");
    expect((await llamar(1, null, "otro")).error?.message).toBe("invalid_addon");
    expect((await service.rpc("admin_set_addon", { p_actor: admin.id, p_org: randomUUID(), p_addon: "webar", p_extra_packs: 0, p_ends_at: null as unknown as string, p_reason: "x" })).error?.message).toBe("subscription_not_found");
    for (const motivo of ["", "   ", "x".repeat(201)]) {
      expect((await service.rpc("admin_set_addon", { p_actor: admin.id, p_org: local.id, p_addon: "webar", p_extra_packs: 1, p_ends_at: null as unknown as string, p_reason: motivo })).error?.message, motivo.length.toString()).toBe("invalid_reason");
      expect((await service.rpc("admin_end_addon", { p_actor: admin.id, p_org: local.id, p_addon: "webar", p_reason: motivo })).error?.message).toBe("invalid_reason");
      expect((await service.rpc("admin_set_organization_active", { p_actor: admin.id, p_org: local.id, p_active: false, p_reason: motivo })).error?.message).toBe("invalid_reason");
    }
    expect((await organizacion(local.id)).is_active).toBe(true);
    expect(await contratos(local.id)).toEqual([]);
    expect(await auditoria(local.id)).toEqual([]);
  });

  it("la tabla no admite dos contratos del mismo add-on, ni por SQL directo", async () => {
    const local = await crearLocal("pro");
    expect((await activar(local)).ok).toBe(true);
    expect(() => sql(`insert into public.subscription_addons (organization_id, addon_code) values ('${local.id}', 'webar')`)).toThrow(/duplicate key|subscription_addons_organization_id_addon_code_key/);
  });

  it("finalizar: deja de dar la feature y el cupo, conserva los packs y audita; no se puede finalizar dos veces", async () => {
    const local = await crearLocal("pro");
    expect((await activar(local, { extraPacks: "3" })).ok).toBe(true);
    expect((await entitlements(local.owner, local.id))!.limits.models_3d).toBe(45);

    expect((await finalizar(local, "Dejó de pagarlo")).ok).toBe(true);
    const [fila] = await contratos(local.id);
    expect(fila.extra_packs).toBe(3);
    expect(new Date(fila.ends_at!).getTime()).toBeLessThanOrEqual(Date.now() + 5_000); // el reloj del Docker local puede ir adelantado
    const ent = (await entitlements(local.owner, local.id))!;
    expect(ent.features).not.toContain("webar");
    expect(ent.limits.models_3d).toBe(0);

    const fin = (await auditoria(local.id)).at(-1)!;
    expect(fin).toMatchObject({ action: "addon.ended", before: { active: true, extra_packs: 3 } });
    expect(fin.after).toMatchObject({ slug: local.slug, addon: "webar", extra_packs: 3, reason: "Dejó de pagarlo" });

    expect(await finalizar(local)).toEqual({ ok: false, error: "addon_not_active" });
    expect(await accionesDe(local.id)).toEqual(["addon.activated", "addon.ended"]);
  });

  it("finalizar sin haberlo contratado, con motivo vacío o con addon inválido se rechaza sin huella", async () => {
    const local = await crearLocal("pro");
    expect(await finalizar(local)).toEqual({ ok: false, error: "addon_not_active" });
    expect(await finalizar(local, "")).toEqual({ ok: false, error: "invalid_reason" });
    expect(await endAddon(ctx(admin), { slug: local.slug, addon: "otro", reason: "x" })).toEqual({ ok: false, error: "invalid_addon" });
    expect(await endAddon(ctx(admin), { slug: "no-existe-nada", addon: "webar", reason: "x" })).toEqual({ ok: false, error: "org_not_found" });
    expect(await auditoria(local.id)).toEqual([]);
  });

  it("volver a activar uno finalizado es «activado», con los datos nuevos", async () => {
    const local = await crearLocal("pro");
    expect((await activar(local, { extraPacks: "2" })).ok).toBe(true);
    expect((await finalizar(local)).ok).toBe(true);
    expect((await activar(local, { extraPacks: "2", reason: "Volvió" })).ok).toBe(true);
    expect(await accionesDe(local.id)).toEqual(["addon.activated", "addon.ended", "addon.activated"]);
    expect((await entitlements(local.owner, local.id))!.limits.models_3d).toBe(35);
    expect((await auditoria(local.id)).at(-1)!.before).toMatchObject({ active: false, extra_packs: 2 });
  });

  it("un add-on con fin ya vencido por el reloj no cuenta como vigente", async () => {
    const local = await crearLocal("pro");
    expect((await activar(local, { endsOn: enDias(10) })).ok).toBe(true);
    sql(`update public.subscription_addons set ends_at = now() - interval '1 minute' where organization_id = '${local.id}'`);
    expect((await entitlements(local.owner, local.id))!.features).not.toContain("webar");
    // No hay nada que finalizar; activarlo de nuevo cuenta como activación.
    expect(await finalizar(local)).toEqual({ ok: false, error: "addon_not_active" });
    expect((await activar(local, { extraPacks: "1" })).ok).toBe(true);
    expect((await accionesDe(local.id)).at(-1)).toBe("addon.activated");
  });

  it("dos activaciones simultáneas iguales dejan un solo contrato: una se aplica y la otra ve «sin cambios»", async () => {
    for (let ronda = 0; ronda < 4; ronda++) {
      const local = await crearLocal("pro");
      const [a, b] = await Promise.all([activar(local, { extraPacks: "2" }), activar(local, { extraPacks: "2" })]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      const rechazada = a.ok ? b : a;
      expect(rechazada).toEqual({ ok: false, error: "addon_unchanged" });
      expect(await contratos(local.id)).toHaveLength(1);
      expect(await accionesDe(local.id)).toEqual(["addon.activated"]);
    }
  });

  it("un pedido con el reloj viejo (esperó mientras otro finalizaba) no finaliza de nuevo ni retrocede la fecha", async () => {
    const local = await crearLocal("pro");
    expect((await activar(local)).ok).toBe(true);
    const lenta = await conRelojViejo(`public.admin_end_addon('${admin.id}', '${local.id}', 'webar', 'lenta')`, 3, async () => {
      expect((await finalizar(local, "primera")).ok).toBe(true);
    });
    expect(lenta.error).toMatch(/addon_not_active/);
    expect(await accionesDe(local.id)).toEqual(["addon.activated", "addon.ended"]);
    expect((await auditoria(local.id)).at(-1)!.after).toMatchObject({ reason: "primera" });
    // La fecha de fin es la de la primera finalización, no la del pedido viejo.
    const [fila] = await contratos(local.id);
    expect(new Date(fila.ends_at!).getTime()).toBe(new Date(((await auditoria(local.id)).at(-1)!.after as { ends_at: string }).ends_at).getTime());
  }, 30_000);

  it("un pedido de activación con el reloj viejo ve el add-on ya finalizado: es una activación, no un cambio", async () => {
    const local = await crearLocal("pro");
    expect((await activar(local, { extraPacks: "1" })).ok).toBe(true);
    const lenta = await conRelojViejo(
      `public.admin_set_addon('${admin.id}', '${local.id}', 'webar', 2, null, 'lenta')`,
      3,
      async () => {
        expect((await finalizar(local, "primera")).ok).toBe(true);
      },
    );
    expect(lenta.error).toBeNull();
    expect(await accionesDe(local.id)).toEqual(["addon.activated", "addon.ended", "addon.activated"]);
    expect((await auditoria(local.id)).at(-1)!.before).toMatchObject({ active: false });
    expect((await entitlements(local.owner, local.id))!.limits.models_3d).toBe(35);
  }, 30_000);

  it("dos finalizaciones simultáneas dejan una sola", async () => {
    const local = await crearLocal("pro");
    expect((await activar(local)).ok).toBe(true);
    const [a, b] = await Promise.all([finalizar(local), finalizar(local)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await accionesDe(local.id)).toEqual(["addon.activated", "addon.ended"]);
  });

  it("activar o cambiar un add-on no toca el plan, las fechas, la suspensión ni los pagos", async () => {
    const local = await crearLocal("pro");
    const antes = await suscripcion(local.id);
    expect((await activar(local, { extraPacks: "4" })).ok).toBe(true);
    expect((await finalizar(local)).ok).toBe(true);
    expect(await suscripcion(local.id)).toEqual(antes);
    expect((await service.from("payments").select("id").eq("organization_id", local.id)).data).toEqual([]);
  });

  it("la ficha lista el catálogo con el estado de cada add-on y si el plan actual lo admite", async () => {
    const local = await crearLocal("pro");
    const leer = async () => {
      const r = await getOrganizationDetail(ctx(admin), local.slug);
      if (!r.ok) throw new Error("no se pudo leer la ficha");
      return r.data.addons.find((a) => a.code === "webar")!;
    };
    expect(await leer()).toMatchObject({ allowedByPlan: true, contract: null, baseQuota: 15, packSize: 10 });
    expect((await activar(local, { extraPacks: "1" })).ok).toBe(true);
    expect(await leer()).toMatchObject({ allowedByPlan: true, contract: { extraPacks: 1, active: true, quota: 25, endsAt: null } });
    await setSubscription(service, local.id, { plan: "basic" });
    expect(await leer()).toMatchObject({ allowedByPlan: false, contract: { active: true } });
    await setSubscription(service, local.id, { plan: "pro" });
    expect((await finalizar(local)).ok).toBe(true);
    // El fin queda en el reloj de la base y la ficha compara con el del servidor: el Docker local puede ir ~100 ms adelantado.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await leer()).toMatchObject({ contract: { active: false, extraPacks: 1 } });
  });
});

describe("lo que ve el Dueño de los add-ons", () => {
  it("su historial muestra el add-on, los packs y el fin, sin motivo, autor ni ids; el Staff y otro Dueño no ven nada", async () => {
    const local = await crearLocal("pro");
    const otro = await crearLocal("pro");
    expect((await activar(local, { extraPacks: "2", endsOn: enDias(45), reason: "Motivo interno secreto" })).ok).toBe(true);
    expect((await finalizar(local, "Otro motivo interno")).ok).toBe(true);

    const filas = (await local.owner.db.rpc("owner_account_history", { p_org: local.id })).data!;
    expect(filas.map((f) => f.action)).toEqual(["addon.ended", "addon.activated"]);
    const activado = filas.find((f) => f.action === "addon.activated")!;
    expect(activado.detail).toMatchObject({ addon: "webar", extra_packs: 2 });
    expect((activado.detail as { ends_at?: string }).ends_at).toBeTruthy();
    const terminado = filas.find((f) => f.action === "addon.ended")!;
    expect(Object.keys(terminado.detail as object).sort()).toEqual(["addon", "ends_at"]);
    const crudo = JSON.stringify(filas);
    for (const secreto of ["Motivo interno secreto", "Otro motivo interno", admin.id, "reason", "actor", "slug", "model_quota"]) {
      expect(crudo, secreto).not.toContain(secreto);
    }

    for (const intruso of [local.staff, otro.owner, comun, admin]) {
      expect((await intruso.db.rpc("owner_account_history", { p_org: local.id })).data).toEqual([]);
    }
  });
});

describe("baja de la organización", () => {
  it("da de baja y reactiva con motivo: una auditoría por cambio, sin tocar suscripción ni pagos", async () => {
    const local = await crearLocal("pro");
    expect((await registerPayment(ctx(admin), { slug: local.slug, amount: "20000", currency: "ARS", method: "transfer", reference: "", paidOn: hoyAr(), coversUntil: enDias(60) })).ok).toBe(true);
    const subAntes = await suscripcion(local.id);
    const pagosAntes = (await service.from("payments").select("*").eq("organization_id", local.id)).data!;

    expect(await baja(local, false, "Cierra el local")).toEqual({ ok: true, data: undefined });
    expect((await organizacion(local.id)).is_active).toBe(false);
    expect(await suscripcion(local.id)).toEqual(subAntes);
    expect((await service.from("payments").select("*").eq("organization_id", local.id)).data).toEqual(pagosAntes);

    expect(await baja(local, true, "Reabrió")).toEqual({ ok: true, data: undefined });
    expect((await organizacion(local.id)).is_active).toBe(true);
    expect(await suscripcion(local.id)).toEqual(subAntes);

    const log = (await auditoria(local.id)).filter((a) => a.action.startsWith("organization."));
    expect(log.map((a) => a.action)).toEqual(["organization.deactivated", "organization.reactivated"]);
    expect(log[0]).toMatchObject({ actor_id: admin.id, before: { active: true } });
    expect(log[0].after).toMatchObject({ slug: local.slug, active: false, reason: "Cierra el local" });
    expect(log[1].after).toMatchObject({ active: true, reason: "Reabrió" });
  });

  it("dada de baja, el Dueño y el Staff no leen ni escriben nada de su local, por la API", async () => {
    const local = await crearLocal("pro");
    const categoria = await createCategory(service, local.id);
    expect((await baja(local, false)).ok).toBe(true);

    for (const [nombre, usuario] of [["Dueño", local.owner], ["Staff", local.staff]] as const) {
      expect((await usuario.db.from("organizations").select("id").eq("id", local.id)).data, nombre).toEqual([]);
      expect((await usuario.db.from("branches").select("id").eq("organization_id", local.id)).data, nombre).toEqual([]);
      expect((await usuario.db.from("categories").select("id").eq("organization_id", local.id)).data, nombre).toEqual([]);
      expect((await usuario.db.rpc("org_entitlements", { p_org: local.id })).data, nombre).toBeNull();

      const crear = await usuario.db.from("categories").insert({ organization_id: local.id, name: "colada" }).select("id");
      expect(crear.error?.code ?? "sin error", nombre).toBe("42501");
      const editar = await usuario.db.from("categories").update({ name: "colada" }).eq("id", categoria).select("id");
      expect(editar.error ?? editar.data?.length === 0 ? "bloqueado" : "escribió", nombre).toBe("bloqueado");
      const nuevoNombre = await usuario.db.from("organizations").update({ name: "colado" }).eq("id", local.id).select("id");
      expect(nuevoNombre.error ?? nuevoNombre.data?.length === 0 ? "bloqueado" : "escribió", nombre).toBe("bloqueado");
    }
    // El Dueño tampoco lee lo que es solo suyo: suscripción, add-ons, pagos, historial y personal.
    expect((await local.owner.db.from("subscriptions").select("id").eq("organization_id", local.id)).data).toEqual([]);
    expect((await local.owner.db.rpc("owner_payments", { p_org: local.id })).data).toEqual([]);
    expect((await local.owner.db.rpc("owner_account_history", { p_org: local.id })).data).toEqual([]);
    expect((await local.owner.db.from("memberships").select("user_id").eq("organization_id", local.id)).data).toHaveLength(1); // solo la propia
    expect((await service.from("categories").select("name").eq("id", categoria).single()).data!.name).toBe("tt-categoria");
    expect((await service.from("categories").select("id").eq("organization_id", local.id)).data).toHaveLength(1);
  });

  it("dada de baja, su estado derivado es «suspendido» y no concede nada (defensa en profundidad, sin pasar por RLS)", async () => {
    const local = await crearLocal("pro");
    expect(sql(`select private.org_state('${local.id}')`)[0][0]).toBe("active");
    expect((await baja(local, false)).ok).toBe(true);
    expect(sql(`select private.org_state('${local.id}')`)[0][0]).toBe("suspended");
    expect(sql(`select private.has_feature('${local.id}', 'menu')`)[0][0]).toBe("f");
    expect(sql(`select private.org_can_write('${local.id}')`)[0][0]).toBe("f");
    expect((await baja(local, true)).ok).toBe(true);
    expect(sql(`select private.org_state('${local.id}')`)[0][0]).toBe("active");
  });

  it("su carta pública responde igual que una que no existe, y vuelve al reactivar", async () => {
    const local = await crearLocal("pro");
    const visible = (await estadoCarta(local)).data;
    expect(visible).toBeTruthy();
    expect((await baja(local, false)).ok).toBe(true);
    const inexistente = (await estadoCarta({ slug: `tt-addon-${sufijo}-no-existe` })).data;
    expect((await estadoCarta(local)).data).toEqual(inexistente);
    expect((await baja(local, true)).ok).toBe(true);
    expect((await estadoCarta(local)).data).toEqual(visible);
  });

  it("registrar un aviso push desde una organización dada de baja no se acepta", async () => {
    const local = await crearLocal("pro");
    const intento = () => local.staff.db.rpc("register_push_subscription", { p_org: local.id, p_endpoint: "x", p_p256dh: "x", p_auth: "x" });
    expect((await intento()).data).toBe("invalid"); // al día: llega a validar el endpoint
    expect((await baja(local, false)).ok).toBe(true);
    expect((await intento()).data).toBe("unavailable");
  });

  it("una persona de dos locales sigue entrando al que está activo", async () => {
    const a = await crearLocal("pro");
    const b = await crearLocal("pro");
    const multi = await createUser(service, "addon-multi");
    users.push(multi);
    await addMembership(service, multi, a.id, "owner");
    await addMembership(service, multi, b.id, "staff");
    expect((await baja(a, false)).ok).toBe(true);
    const orgsVisibles = (await multi.db.from("organizations").select("id").in("id", [a.id, b.id])).data!.map((o) => o.id);
    expect(orgsVisibles).toEqual([b.id]);
    expect((await multi.db.rpc("org_entitlements", { p_org: b.id })).data).not.toBeNull();
  });

  it("al reactivar vuelve todo como estaba: el personal entra, la carta se ve y los datos siguen", async () => {
    const local = await crearLocal("pro");
    const categoria = await createCategory(service, local.id, "tt-cat-baja");
    expect((await baja(local, false)).ok).toBe(true);
    expect((await baja(local, true)).ok).toBe(true);
    for (const usuario of [local.owner, local.staff]) {
      expect((await usuario.db.from("categories").select("id").eq("id", categoria)).data).toHaveLength(1);
      expect((await entitlements(usuario, local.id))!.state).toBe("active");
    }
    expect((await local.owner.db.from("categories").update({ name: "tt-cat-vuelve" }).eq("id", categoria).select("id")).data).toHaveLength(1);
  });

  it("la reactivación respeta la mora: si la cuenta venció mientras estaba de baja, queda vencida", async () => {
    const local = await crearLocal("pro");
    expect((await baja(local, false)).ok).toBe(true);
    await setSubscription(service, local.id, { finEnMs: -20 * DIA_MS });
    expect((await baja(local, true)).ok).toBe(true);
    expect((await entitlements(local.owner, local.id))!.state).toBe("suspended");
  });

  it("rechaza sin huella: ya está de baja / ya está activa, motivo inválido y organización inexistente", async () => {
    const local = await crearLocal("pro");
    expect(await baja(local, true)).toEqual({ ok: false, error: "already_active" });
    expect(await baja(local, false, "")).toEqual({ ok: false, error: "invalid_reason" });
    expect(await baja(local, false, "x".repeat(201))).toEqual({ ok: false, error: "invalid_reason" });
    expect(await baja({ slug: "no-existe-nada" }, false)).toEqual({ ok: false, error: "org_not_found" });
    expect((await service.rpc("admin_set_organization_active", { p_actor: admin.id, p_org: randomUUID(), p_active: false, p_reason: "x" })).error?.message).toBe("organization_not_found");
    expect((await service.rpc("admin_set_organization_active", { p_actor: admin.id, p_org: local.id, p_active: null as unknown as boolean, p_reason: "x" })).error?.code).toBe("22023");
    expect(await auditoria(local.id)).toEqual([]);

    expect((await baja(local, false)).ok).toBe(true);
    expect(await baja(local, false)).toEqual({ ok: false, error: "already_inactive" });
    expect(await accionesDe(local.id)).toEqual(["organization.deactivated"]);
  });

  it("dos bajas simultáneas dejan una sola y dos reactivaciones también", async () => {
    const local = await crearLocal("pro");
    const [a, b] = await Promise.all([baja(local, false), baja(local, false)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const [c, d] = await Promise.all([baja(local, true), baja(local, true)]);
    expect([c.ok, d.ok].filter(Boolean)).toHaveLength(1);
    expect(await accionesDe(local.id)).toEqual(["organization.deactivated", "organization.reactivated"]);
  });

  it("el Dueño ve la reactivación en su historial (sin detalle ni motivo) y nunca la baja", async () => {
    const local = await crearLocal("pro");
    expect((await baja(local, false, "Motivo de baja secreto")).ok).toBe(true);
    expect((await baja(local, true, "Motivo de alta secreto")).ok).toBe(true);
    const filas = (await local.owner.db.rpc("owner_account_history", { p_org: local.id })).data!;
    expect(filas.map((f) => f.action)).toEqual(["organization.reactivated"]);
    expect(filas[0].detail).toEqual({});
    expect(JSON.stringify(filas)).not.toContain("secreto");
  });

  it("dar de baja no borra nada: la organización, sus sucursales y su historial siguen y se pueden borrar como antes", async () => {
    const local = await crearLocal("pro");
    expect((await baja(local, false)).ok).toBe(true);
    expect((await service.from("branches").select("id").eq("organization_id", local.id)).data).toHaveLength(1);
    expect((await service.from("memberships").select("id").eq("organization_id", local.id)).data).toHaveLength(2);
    expect((await service.from("subscriptions").select("id").eq("organization_id", local.id)).data).toHaveLength(1);
  });

  it("la ficha del SuperAdmin muestra la organización como inactiva y la sigue leyendo", async () => {
    const local = await crearLocal("pro");
    expect((await baja(local, false)).ok).toBe(true);
    const r = await getOrganizationDetail(ctx(admin), local.slug);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.isActive).toBe(false);
      expect(r.data.audit.some((a) => a.action === "organization.deactivated")).toBe(true);
    }
  });
});
