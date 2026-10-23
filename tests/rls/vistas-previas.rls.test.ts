import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminContext } from "@/lib/admin/organizations";
import { endFeaturePreview, getOrganizationDetail, setFeaturePreview } from "@/lib/admin/subscriptions";
import { PREVIEW_FEATURES, todayInArgentina } from "@/lib/admin/validation";
import { parseEntitlements } from "@/lib/entitlements";
import { describeHistory, parseHistory } from "@/lib/cuenta/lectura";
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
  type PlanCode,
  type TestUser,
} from "./helpers";

/**
 * Vistas previas de funciones por organización (nivel C, ficha vistas-previas-de-funciones, ADR 0039) contra el Supabase local,
 * con los mismos clientes que usa el servidor. Foco: que solo el SuperAdmin las escriba (y siempre auditadas), que `plan_grants`
 * sea plan ∪ vistas previas VIGENTES, que la mora siga mandando, que cada rechazo no deje huella y que el Dueño no las vea.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const FEATURE = "orders";

let service: Db;
let admin: TestUser;
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

const ctx = (user: TestUser): AdminContext => ({ session: user.db, admin: service, actorId: user.id });

type Local = { id: string; slug: string; owner: TestUser; staff: TestUser };

/** Un local al día con un Dueño y un Staff. */
async function crearLocal(plan: PlanCode = "pro"): Promise<Local> {
  contador += 1;
  const slug = `tt-vp-${sufijo}-${contador}`;
  const id = await createOrg(service, slug, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const owner = await createUser(service, `vp-d${contador}`);
  const staff = await createUser(service, `vp-s${contador}`);
  users.push(owner, staff);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, slug, owner, staff };
}

/** `AAAA-MM-DD` de dentro de `dias` días (Argentina). */
const enDias = (dias: number) => todayInArgentina(new Date(Date.now() + dias * DIA_MS));

const tiene = (orgId: string, feature = FEATURE) => sql(`select private.has_feature('${orgId}', '${feature}')`)[0][0] === "t";
const concede = (orgId: string, feature = FEATURE) => sql(`select private.plan_grants('${orgId}', '${feature}')`)[0][0] === "t";
const filas = async (orgId: string) => (await service.from("organization_feature_previews").select("*").eq("organization_id", orgId)).data!;
const auditoria = async (orgId: string) =>
  (await service.from("audit_log").select("*").eq("organization_id", orgId).order("created_at", { ascending: true })).data!;
const acciones = async (orgId: string) => (await auditoria(orgId)).map((a) => a.action);
const vencer = (orgId: string, feature = FEATURE) =>
  sql(`update public.organization_feature_previews set ends_at = clock_timestamp() - interval '1 minute' where organization_id = '${orgId}' and feature = '${feature}'`);

const habilitar = (local: Pick<Local, "slug">, endsOn: unknown = enDias(30), reason: unknown = "Piloto con el local", feature: unknown = FEATURE, quien: TestUser = admin) =>
  setFeaturePreview(ctx(quien), { slug: local.slug, feature, endsOn, reason });
const terminar = (local: Pick<Local, "slug">, reason: unknown = "Terminó el piloto", feature: unknown = FEATURE, quien: TestUser = admin) =>
  endFeaturePreview(ctx(quien), { slug: local.slug, feature, reason });

const funcionesDe = async (local: Local, quien: TestUser = local.owner) =>
  parseEntitlements((await quien.db.rpc("org_entitlements", { p_org: local.id })).data)!.features;

beforeAll(async () => {
  service = serviceClient();
  admin = await createUser(service, "vp-admin");
  users.push(admin);
  sql(`insert into public.platform_admins (user_id) values ('${admin.id}')`);
});

afterAll(async () => {
  purgeAuditLogWhere(`after->>'slug' like 'tt-vp-%'`);
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("habilitar una función", () => {
  it("sin vista previa no concede nada; con ella, el plan ∪ la vista previa la concede y el Dueño y el Staff la ven", async () => {
    const local = await crearLocal();
    expect(tiene(local.id)).toBe(false);
    expect(await funcionesDe(local)).not.toContain(FEATURE);

    expect(await habilitar(local)).toEqual({ ok: true, data: undefined });
    expect(concede(local.id)).toBe(true);
    expect(tiene(local.id)).toBe(true);
    expect(await funcionesDe(local)).toContain(FEATURE);
    expect(await funcionesDe(local, local.staff)).toContain(FEATURE);
    // Solo esa función: las demás de la lista siguen apagadas, y las del plan no cambian.
    for (const otra of PREVIEW_FEATURES.filter((f) => f !== FEATURE)) expect(tiene(local.id, otra), otra).toBe(false);
    expect(tiene(local.id, "menu")).toBe(true);
    expect(await acciones(local.id)).toEqual(["feature_preview.started"]);
  });

  it("vale solo para esa organización", async () => {
    const local = await crearLocal();
    const otra = await crearLocal();
    expect((await habilitar(local)).ok).toBe(true);
    expect(tiene(otra.id)).toBe(false);
    expect(await funcionesDe(otra)).not.toContain(FEATURE);
  });

  it("cambiar el fin de una vigente es «changed»; terminarla la apaga en el acto y queda «ended»", async () => {
    const local = await crearLocal();
    expect((await habilitar(local, enDias(10))).ok).toBe(true);
    expect((await habilitar(local, enDias(40), "Se extiende el piloto")).ok).toBe(true);
    expect(await filas(local.id)).toHaveLength(1);
    expect((await filas(local.id))[0]).toMatchObject({ feature: FEATURE, reason: "Se extiende el piloto" });

    expect(await terminar(local)).toEqual({ ok: true, data: undefined });
    expect(tiene(local.id)).toBe(false);
    expect(concede(local.id)).toBe(false);
    expect(await funcionesDe(local)).not.toContain(FEATURE);
    expect(await acciones(local.id)).toEqual(["feature_preview.started", "feature_preview.changed", "feature_preview.ended"]);
    const fin = (await auditoria(local.id)).at(-1)!;
    expect(fin).toMatchObject({ actor_id: admin.id, before: { active: true }, after: { feature: FEATURE, reason: "Terminó el piloto" } });
  });

  it("una vista previa terminada o vencida se puede volver a habilitar (queda «started» otra vez)", async () => {
    const local = await crearLocal();
    expect((await habilitar(local)).ok).toBe(true);
    vencer(local.id);
    expect(tiene(local.id)).toBe(false);
    expect((await habilitar(local)).ok).toBe(true);
    expect(tiene(local.id)).toBe(true);
    expect(await acciones(local.id)).toEqual(["feature_preview.started", "feature_preview.started"]);
  });

  it("al vencer sola deja de conceder, sin que nadie la toque", async () => {
    const local = await crearLocal();
    expect((await habilitar(local)).ok).toBe(true);
    expect(tiene(local.id)).toBe(true);
    vencer(local.id);
    expect(concede(local.id)).toBe(false);
    expect(tiene(local.id)).toBe(false);
    expect(await funcionesDe(local)).not.toContain(FEATURE);
  });

  it("cada una de las cuatro claves se puede habilitar y ninguna otra", async () => {
    const local = await crearLocal();
    for (const feature of PREVIEW_FEATURES) {
      expect((await habilitar(local, enDias(5), "Piloto", feature)).ok, feature).toBe(true);
      expect(tiene(local.id, feature), feature).toBe(true);
    }
    for (const mala of ["menu", "video_feed", "loyalty", "analytics", "waiter_call", "webar", "", "ORDERS"]) {
      const r = await service.rpc("admin_set_feature_preview", {
        p_actor: admin.id,
        p_org: local.id,
        p_feature: mala,
        p_ends_at: new Date(Date.now() + 5 * DIA_MS).toISOString(),
        p_reason: "x",
      });
      expect(r.error?.message, mala).toBe("invalid_feature");
    }
    // Ni siquiera con un INSERT directo del dueño de la tabla.
    expect(() =>
      sql(`insert into public.organization_feature_previews (organization_id, feature, ends_at, reason) values ('${local.id}', 'menu', now() + interval '1 day', 'x')`),
    ).toThrow(/check/i);
  });

  it("si el plan ya incluye la función, la vista previa se rechaza (feature_in_plan)", async () => {
    const local = await crearLocal();
    // Ninguna clave del catálogo está todavía en un plan: se simula en una transacción que se revierte, sin que nadie más la vea.
    const script = `
      begin;
      alter table public.plans drop constraint plans_features_check;
      update public.plans set features = features || array['${FEATURE}'] where code = 'pro';
      select private.plan_grants('${local.id}', '${FEATURE}');
      select public.admin_set_feature_preview('${admin.id}', '${local.id}', '${FEATURE}', now() + interval '5 days', 'x');
      rollback;`;
    expect(() => sql(script)).toThrow(/feature_in_plan/);
    expect(await filas(local.id)).toEqual([]);
    expect(await auditoria(local.id)).toEqual([]);
  });
});

describe("la mora sigue mandando", () => {
  it("en gracia concede; en solo lectura y suspendida, no", async () => {
    const local = await crearLocal();
    expect((await habilitar(local)).ok).toBe(true);
    expect(tiene(local.id)).toBe(true);

    await setSubscription(service, local.id, { finEnMs: -2.5 * DIA_MS }); // gracia
    expect(tiene(local.id)).toBe(true);
    await setSubscription(service, local.id, { finEnMs: -10 * DIA_MS }); // solo lectura
    expect(tiene(local.id)).toBe(false);
    expect(await funcionesDe(local)).not.toContain(FEATURE);
    await setSubscription(service, local.id, { finEnMs: -20 * DIA_MS }); // suspendida
    expect(tiene(local.id)).toBe(false);
    expect(concede(local.id)).toBe(true); // el plan ∪ vista previa sigue ahí; es has_feature quien aplica la mora

    await setSubscription(service, local.id, { finEnMs: 30 * DIA_MS });
    expect(tiene(local.id)).toBe(true);
  });

  it("una suspensión a mano también la apaga", async () => {
    const local = await crearLocal();
    expect((await habilitar(local)).ok).toBe(true);
    await service.from("subscriptions").update({ suspended_at: new Date().toISOString() }).eq("organization_id", local.id);
    expect(tiene(local.id)).toBe(false);
  });
});

describe("lo inválido no deja huella", () => {
  it("fin ausente, pasado, de más de 90 días o mal formado; motivo vacío o largo; función desconocida", async () => {
    const local = await crearLocal();
    const llamar = (p_feature: string, p_ends_at: string | null, p_reason: string) =>
      service.rpc("admin_set_feature_preview", { p_actor: admin.id, p_org: local.id, p_feature, p_ends_at: p_ends_at as string, p_reason });
    const dentro = new Date(Date.now() + 5 * DIA_MS).toISOString();

    expect((await llamar(FEATURE, null, "x")).error?.message).toBe("invalid_preview_end");
    expect((await llamar(FEATURE, new Date(Date.now() - 1000).toISOString(), "x")).error?.message).toBe("invalid_preview_end");
    expect((await llamar(FEATURE, new Date(Date.now() + 92 * DIA_MS).toISOString(), "x")).error?.message).toBe("invalid_preview_end");
    expect((await llamar(FEATURE, dentro, "   ")).error?.message).toBe("invalid_reason");
    expect((await llamar(FEATURE, dentro, "a".repeat(201))).error?.message).toBe("invalid_reason");
    expect((await llamar("nada", dentro, "x")).error?.message).toBe("invalid_feature");
    // Por la capa de la aplicación, antes de llegar a la base.
    expect(await habilitar(local, "", "x")).toEqual({ ok: false, error: "invalid_preview_end" });
    expect(await habilitar(local, enDias(120), "x")).toEqual({ ok: false, error: "invalid_preview_end" });
    expect(await habilitar(local, enDias(5), "x", "menu")).toEqual({ ok: false, error: "invalid_preview_feature" });

    expect(await filas(local.id)).toEqual([]);
    expect(await auditoria(local.id)).toEqual([]);
    expect(tiene(local.id)).toBe(false);
  });

  it("mismo fin de una vigente: preview_unchanged; terminar una que no está vigente: preview_not_active", async () => {
    const local = await crearLocal();
    expect(await terminar(local)).toEqual({ ok: false, error: "preview_not_active" });
    expect((await habilitar(local, enDias(20))).ok).toBe(true);
    expect(await habilitar(local, enDias(20), "Otro motivo")).toEqual({ ok: false, error: "preview_unchanged" });
    expect((await terminar(local)).ok).toBe(true);
    expect(await terminar(local)).toEqual({ ok: false, error: "preview_not_active" });
    vencer(local.id);
    expect(await terminar(local)).toEqual({ ok: false, error: "preview_not_active" });
    expect(await acciones(local.id)).toEqual(["feature_preview.started", "feature_preview.ended"]);
  });

  it("una organización sin suscripción o inexistente: subscription_not_found", async () => {
    const r = await service.rpc("admin_set_feature_preview", {
      p_actor: admin.id,
      p_org: "00000000-0000-4000-8000-000000000000",
      p_feature: FEATURE,
      p_ends_at: new Date(Date.now() + 5 * DIA_MS).toISOString(),
      p_reason: "x",
    });
    expect(r.error?.message).toBe("subscription_not_found");
  });
});

describe("quién puede", () => {
  it("quien no es SuperAdmin (ni el Dueño de ese local ni un Staff ni un anónimo) no habilita ni termina nada", async () => {
    const local = await crearLocal();
    expect((await habilitar(local, enDias(10), "x", FEATURE, local.owner))).toEqual({ ok: false, error: "forbidden" });
    expect((await habilitar(local, enDias(10), "x", FEATURE, local.staff))).toEqual({ ok: false, error: "forbidden" });
    expect((await habilitar(local)).ok).toBe(true);
    expect((await terminar(local, "x", FEATURE, local.owner))).toEqual({ ok: false, error: "forbidden" });
    expect(tiene(local.id)).toBe(true);

    // La función de base, con un actor que no es SuperAdmin, tampoco (aunque se llame con la clave de servicio).
    const impostor = await service.rpc("admin_end_feature_preview", { p_actor: local.owner.id, p_org: local.id, p_feature: FEATURE, p_reason: "x" });
    expect(impostor.error?.code).toBe("42501");
    expect(tiene(local.id)).toBe(true);
    expect(await acciones(local.id)).toEqual(["feature_preview.started"]);
  });

  it("la API no ejecuta las funciones ni lee ni escribe la tabla (Dueño, Staff, anon ni service_role directo)", async () => {
    const local = await crearLocal();
    expect((await habilitar(local)).ok).toBe(true);
    const fin = new Date(Date.now() + 5 * DIA_MS).toISOString();
    for (const [nombre, db] of [
      ["Dueño", local.owner.db],
      ["Staff", local.staff.db],
      ["anon", anonClient()],
    ] as const) {
      const poner = await db.rpc("admin_set_feature_preview", { p_actor: admin.id, p_org: local.id, p_feature: FEATURE, p_ends_at: fin, p_reason: "x" });
      expect(poner.error?.code, `${nombre}: set`).toBe("42501");
      const quitar = await db.rpc("admin_end_feature_preview", { p_actor: admin.id, p_org: local.id, p_feature: FEATURE, p_reason: "x" });
      expect(quitar.error?.code, `${nombre}: end`).toBe("42501");
      const leer = await db.from("organization_feature_previews").select("*");
      expect(leer.error?.code, `${nombre}: select`).toBe("42501");
      const insertar = await db.from("organization_feature_previews").insert({ organization_id: local.id, feature: "customers", ends_at: fin, reason: "x" });
      expect(insertar.error, `${nombre}: insert`).not.toBeNull();
    }
    // service_role solo lee: lo escribe únicamente la función auditada.
    expect((await service.from("organization_feature_previews").select("feature").eq("organization_id", local.id)).data).toEqual([{ feature: FEATURE }]);
    const escrituras = [
      await service.from("organization_feature_previews").insert({ organization_id: local.id, feature: "customers", ends_at: fin, reason: "x" }),
      await service.from("organization_feature_previews").update({ ends_at: fin }).eq("organization_id", local.id),
      await service.from("organization_feature_previews").delete().eq("organization_id", local.id),
    ];
    for (const r of escrituras) expect(r.error?.code).toBe("42501");
    expect(await acciones(local.id)).toEqual(["feature_preview.started"]);
    expect(tiene(local.id)).toBe(true);
  });
});

describe("lo que ve cada uno", () => {
  it("el Dueño no ve la vista previa en su historial ni el motivo; el SuperAdmin la ve en los movimientos de la ficha", async () => {
    const local = await crearLocal();
    expect((await habilitar(local, enDias(10), "motivo interno del piloto")).ok).toBe(true);
    expect((await terminar(local, "otro motivo interno")).ok).toBe(true);

    const { data, error } = await local.owner.db.rpc("owner_account_history", { p_org: local.id });
    expect(error).toBeNull();
    const texto = JSON.stringify(data);
    expect(texto).not.toContain("motivo interno");
    expect(texto).not.toContain("feature_preview");
    expect(texto).not.toContain(FEATURE);
    for (const fila of parseHistory(data) ?? []) expect(describeHistory(fila).title).not.toMatch(/vista previa/i);
    expect((await local.owner.db.from("audit_log").select("id").eq("organization_id", local.id)).data ?? []).toEqual([]);

    const detalle = await getOrganizationDetail(ctx(admin), local.slug);
    if (!detalle.ok) throw new Error(detalle.error);
    expect(detalle.data.audit.map((a) => a.action)).toEqual(expect.arrayContaining(["feature_preview.started", "feature_preview.ended"]));
  });

  it("la ficha del SuperAdmin lista las cuatro funciones con su estado", async () => {
    const local = await crearLocal();
    expect((await habilitar(local, enDias(10), "Piloto")).ok).toBe(true);
    expect((await habilitar(local, enDias(10), "Prueba breve", "customers")).ok).toBe(true);
    vencer(local.id, "customers");

    const detalle = await getOrganizationDetail(ctx(admin), local.slug);
    if (!detalle.ok) throw new Error(detalle.error);
    const porClave = Object.fromEntries(detalle.data.featurePreviews.map((f) => [f.feature, f]));
    expect(detalle.data.featurePreviews.map((f) => f.feature)).toEqual([...PREVIEW_FEATURES]);
    expect(porClave.orders).toMatchObject({ inPlan: false, preview: { reason: "Piloto", active: true } });
    expect(porClave.customers).toMatchObject({ inPlan: false, preview: { reason: "Prueba breve", active: false } });
    expect(porClave.promotions).toMatchObject({ inPlan: false, preview: null });
  });
});

describe("concurrencia", () => {
  it("dos habilitaciones a la vez de la misma función quedan en una sola fila: una «started» y una «changed»", async () => {
    for (let i = 0; i < 3; i++) {
      const local = await crearLocal();
      const [a, b] = await Promise.all([habilitar(local, enDias(10), "Primera"), habilitar(local, enDias(20), "Segunda")]);
      expect([a.ok, b.ok], `iteración ${i}`).toEqual([true, true]);
      expect(await filas(local.id), `iteración ${i}`).toHaveLength(1);
      expect((await acciones(local.id)).sort(), `iteración ${i}`).toEqual(["feature_preview.changed", "feature_preview.started"]);
    }
  });

  it("habilitar y terminar a la vez: el resultado es uno de los dos órdenes posibles, nunca a medias", async () => {
    for (let i = 0; i < 3; i++) {
      const local = await crearLocal();
      expect((await habilitar(local, enDias(10))).ok).toBe(true);
      const [cambio, fin] = await Promise.all([habilitar(local, enDias(30), "Se extiende"), terminar(local)]);
      expect(cambio.ok || fin.ok, `iteración ${i}`).toBe(true);
      const log = await acciones(local.id);
      // Si terminó primero, el cambio la vuelve a iniciar; si cambió primero, terminó después: la última acción dice cómo quedó.
      expect(tiene(local.id), `iteración ${i}: ${log.join(",")}`).toBe(log.at(-1) !== "feature_preview.ended");
    }
  });

  it("cambiar de plan mientras se habilita no pierde ni duplica nada", async () => {
    const local = await crearLocal();
    const [vp] = await Promise.all([
      habilitar(local),
      service.rpc("admin_change_plan", { p_actor: admin.id, p_org: local.id, p_plan: "premium", p_billing_cycle: "monthly", p_reason: "Sube" }),
    ]);
    expect(vp.ok).toBe(true);
    expect(await filas(local.id)).toHaveLength(1);
    expect(tiene(local.id)).toBe(true);
  });
});

describe("borrado de la organización", () => {
  it("las vistas previas se van con la organización (cascada)", async () => {
    const local = await crearLocal();
    expect((await habilitar(local)).ok).toBe(true);
    expect(sql(`select count(*) from public.organization_feature_previews where organization_id = '${local.id}'`)[0][0]).toBe("1");
    orgs.splice(orgs.indexOf(local.id), 1);
    await deleteOrg(service, local.id);
    expect(sql(`select count(*) from public.organization_feature_previews where organization_id = '${local.id}'`)[0][0]).toBe("0");
  });
});
