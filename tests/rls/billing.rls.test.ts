import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  ORG_CAFE,
  ORG_MOROSA,
  ORG_PARRILLA,
  serviceClient,
  setSubscription,
  sql,
  type Db,
  type PlanCode,
  type TestUser,
} from "./helpers";

/**
 * Planes y entitlements (nivel C): estado de mora derivado, escrituras por estado, carta pública,
 * features por plan y add-on, y permisos de las tablas de suscripción.
 * Ver agile/cambios/planes-y-entitlements.md.
 */

const INSUFFICIENT_PRIVILEGE = "42501";
const HORA_MS = 60 * 60 * 1000;

describe("billing_state: bordes exactos (función pura)", () => {
  const FIN = "2026-01-01 00:00:00+00";
  const estado = (at: string) => sql(`select private.billing_state('${FIN}'::timestamptz, '${at}'::timestamptz)`)[0][0];

  it.each([
    ["una hora antes del vencimiento", "2025-12-31 23:00:00+00", "active"],
    ["justo en el vencimiento (día 0)", "2026-01-01 00:00:00+00", "active"],
    ["un segundo después (día 1)", "2026-01-01 00:00:01+00", "grace"],
    ["fin del día 7 (7 días exactos)", "2026-01-08 00:00:00+00", "grace"],
    ["un segundo después de los 7 días (día 8)", "2026-01-08 00:00:01+00", "read_only"],
    ["fin del día 15 (15 días exactos)", "2026-01-16 00:00:00+00", "read_only"],
    ["un segundo después de los 15 días (día 16)", "2026-01-16 00:00:01+00", "suspended"],
    ["mucho después", "2027-01-01 00:00:00+00", "suspended"],
  ])("%s -> %s", (_label, at, esperado) => {
    expect(estado(at)).toBe(esperado);
  });

  it("sin fecha de fin el estado es suspended (falla cerrado)", () => {
    expect(sql(`select private.billing_state(null, now())`)[0][0]).toBe("suspended");
  });

  it("no depende de la zona horaria de la sesión", () => {
    const enBuenosAires = sql(
      `set time zone 'America/Argentina/Buenos_Aires'; select private.billing_state('${FIN}'::timestamptz, '2026-01-08 00:00:01+00'::timestamptz)`,
    );
    expect(enBuenosAires.flat().at(-1)).toBe("read_only");
  });
});

let service: Db;
let anon: Db;
let orgId: string;
let ownerUser: TestUser;
let staffUser: TestUser;
let otroOwner: TestUser;
let categoriaId: string;
let platoId: string;

beforeAll(async () => {
  service = serviceClient();
  anon = anonClient();
  orgId = await createOrg(service, "tt-mora", "pro");
  [ownerUser, staffUser, otroOwner] = await Promise.all([
    createUser(service, "mora-owner"),
    createUser(service, "mora-staff"),
    createUser(service, "mora-otro"),
  ]);
  await addMembership(service, ownerUser, orgId, "owner");
  await addMembership(service, staffUser, orgId, "staff");
  await addMembership(service, otroOwner, ORG_PARRILLA, "owner");

  await service.from("branches").insert({ organization_id: orgId, slug: "tt-mora-sucursal", name: "Sucursal de prueba" });
  categoriaId = await createCategory(service, orgId);
  await insertProducts(service, orgId, categoriaId, 1, true, "tt-mora-plato");
  const plato = await service.from("products").select("id").eq("organization_id", orgId).single();
  platoId = plato.data?.id as string;
});

afterAll(async () => {
  await deleteOrg(service, orgId);
  await Promise.all([ownerUser, staffUser, otroOwner].map((u) => deleteUser(service, u)));
});

// Fin del período relativo a ahora, con márgenes de horas para no depender del reloj de la prueba.
// "Día N" = techo((ahora - fin) / 24 h).
const casos: [string, number, string, boolean, boolean][] = [
  // etiqueta, finEnMs, estado, ¿escribe?, ¿carta pública visible?
  ["al día (vence en una hora, día 0)", HORA_MS, "active", true, true],
  ["día 1 (venció hace una hora)", -HORA_MS, "grace", true, true],
  ["día 7 (venció hace 6 días y 23 h)", -(7 * DIA_MS - HORA_MS), "grace", true, true],
  ["día 8 (venció hace 7 días y 1 h)", -(7 * DIA_MS + HORA_MS), "read_only", false, true],
  ["día 15 (venció hace 14 días y 23 h)", -(15 * DIA_MS - HORA_MS), "read_only", false, true],
  ["día 16 (venció hace 15 días y 1 h)", -(15 * DIA_MS + HORA_MS), "suspended", false, false],
  ["día 40", -40 * DIA_MS, "suspended", false, false],
];

describe.each(casos)("cuenta %s", (_label, finEnMs, estadoEsperado, escribe, cartaVisible) => {
  beforeAll(async () => {
    await setSubscription(service, orgId, { plan: "pro", finEnMs });
  });

  it(`el estado es ${estadoEsperado}`, async () => {
    const owner = await ownerUser.db.rpc("org_entitlements", { p_org: orgId });
    const staff = await staffUser.db.rpc("org_entitlements", { p_org: orgId });

    expect(owner.error).toBeNull();
    expect(owner.data).toMatchObject({ state: estadoEsperado, can_write: escribe });
    expect(staff.data).toMatchObject({ state: estadoEsperado, can_write: escribe });
  });

  it(escribe ? "el owner y el staff pueden escribir la carta" : "ninguno puede escribir la carta", async () => {
    const crear = await ownerUser.db.from("categories").insert({ organization_id: orgId, name: "tt-mora-nueva" }).select("id");
    const editar = await staffUser.db.from("products").update({ price_cents: 2000 }).eq("id", platoId).select("id");
    const desactivar = await staffUser.db.from("products").update({ is_active: false }).eq("id", platoId).select("id");
    const renombrarSucursal = await ownerUser.db.from("branches").update({ name: "Renombrada" }).eq("organization_id", orgId).select("id");
    const renombrarOrg = await ownerUser.db.from("organizations").update({ name: "tt-mora-renombrada" }).eq("id", orgId).select("id");
    const borrar = await ownerUser.db.from("categories").delete().eq("name", "tt-mora-nueva").select("id");

    if (escribe) {
      expect(crear.error).toBeNull();
      expect(editar.data).toHaveLength(1);
      expect(desactivar.data).toHaveLength(1);
      expect(renombrarSucursal.data).toHaveLength(1);
      expect(renombrarOrg.data).toHaveLength(1);
      expect(borrar.data).toHaveLength(1);
      await service.from("products").update({ is_active: true, price_cents: 1000 }).eq("id", platoId);
      await service.from("branches").update({ name: "Sucursal de prueba" }).eq("organization_id", orgId);
      await service.from("organizations").update({ name: "tt-mora" }).eq("id", orgId);
    } else {
      expect(crear.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
      for (const r of [editar, desactivar, renombrarSucursal, renombrarOrg, borrar]) {
        expect(r.error).toBeNull();
        expect(r.data).toEqual([]); // 0 filas: RLS las oculta para escribir
      }
      const intacto = await service.from("products").select("price_cents, is_active").eq("id", platoId).single();
      expect(intacto.data).toEqual({ price_cents: 1000, is_active: true });
    }
  });

  it("el personal siempre puede leer lo propio (el panel sigue accesible)", async () => {
    const owner = await ownerUser.db.from("products").select("id").eq("id", platoId);
    const staff = await staffUser.db.from("categories").select("id").eq("id", categoriaId);

    expect(owner.data).toHaveLength(1);
    expect(staff.data).toHaveLength(1);
  });

  it(cartaVisible ? "la carta pública se publica" : "la carta pública no se publica y los datos siguen", async () => {
    const categorias = await anon.from("categories").select("id").eq("organization_id", orgId);
    const platos = await anon.from("products").select("id").eq("organization_id", orgId);
    const sucursales = await anon.from("branches").select("id").eq("organization_id", orgId);
    const estado = await anon.rpc("public_menu_status", { p_org_slug: "tt-mora", p_branch_slug: "tt-mora-sucursal" });

    expect(estado.data).toBe(cartaVisible ? "available" : "suspended");
    expect(categorias.data).toHaveLength(cartaVisible ? 1 : 0);
    expect(platos.data).toHaveLength(cartaVisible ? 1 : 0);
    expect(sucursales.data).toHaveLength(cartaVisible ? 1 : 0);

    const enBase = await service.from("products").select("id").eq("organization_id", orgId);
    expect(enBase.data).toHaveLength(1);
  });
});

describe("registrar un pago restablece todo", () => {
  it("de suspendida a al día en el siguiente pedido, sin procesos intermedios", async () => {
    await setSubscription(service, orgId, { plan: "pro", finEnMs: -40 * DIA_MS });
    const suspendida = await ownerUser.db.rpc("org_entitlements", { p_org: orgId });
    expect(suspendida.data).toMatchObject({ state: "suspended", features: [] });

    await setSubscription(service, orgId, { finEnMs: 30 * DIA_MS });

    const alDia = await ownerUser.db.rpc("org_entitlements", { p_org: orgId });
    expect(alDia.data).toMatchObject({ state: "active", can_write: true });
    const crear = await ownerUser.db.from("categories").insert({ organization_id: orgId, name: "tt-mora-pago" }).select("id");
    expect(crear.error).toBeNull();
    await service.from("categories").delete().eq("name", "tt-mora-pago");
    const publica = await anon.from("products").select("id").eq("organization_id", orgId);
    expect(publica.data).toHaveLength(1);
  });

  it("si tiene prueba y período pagado, manda la fecha más lejana", async () => {
    const { error } = await service
      .from("subscriptions")
      .update({
        trial_ends_at: new Date(Date.now() - 30 * DIA_MS).toISOString(),
        current_period_end: new Date(Date.now() + 5 * DIA_MS).toISOString(),
      })
      .eq("organization_id", orgId);
    expect(error).toBeNull();

    const owner = await ownerUser.db.rpc("org_entitlements", { p_org: orgId });
    expect(owner.data).toMatchObject({ state: "active" });
  });

  it("una suscripción sin ninguna fecha no se puede guardar", async () => {
    const { error } = await service
      .from("subscriptions")
      .update({ trial_ends_at: null, current_period_end: null })
      .eq("organization_id", orgId);

    expect(error?.code).toBe("23514"); // check_violation
  });
});

describe("alta de organizaciones", () => {
  it("una organización nueva recibe 14 días de prueba del plan Básico", async () => {
    const nueva = await service.from("organizations").insert({ slug: "tt-alta", name: "tt-alta" }).select("id, created_at").single();
    expect(nueva.error).toBeNull();
    try {
      const sub = await service
        .from("subscriptions")
        .select("plan_code, trial_ends_at, current_period_end, billing_cycle")
        .eq("organization_id", nueva.data?.id as string)
        .single();
      const esperado = new Date(nueva.data?.created_at as string).getTime() + 14 * DIA_MS;

      expect(sub.data?.plan_code).toBe("basic");
      expect(sub.data?.current_period_end).toBeNull();
      expect(new Date(sub.data?.trial_ends_at as string).getTime()).toBe(esperado);
      expect(sql(`select private.org_state('${nueva.data?.id}')`)[0][0]).toBe("active");
    } finally {
      await deleteOrg(service, nueva.data?.id);
    }
  });

  it("las organizaciones del seed arrancan activas, salvo la morosa", () => {
    const filas = sql(`select o.slug, private.org_state(o.id) from public.organizations o order by 1`);
    const porSlug = Object.fromEntries(filas.map(([slug, estado]) => [slug, estado]));

    expect(porSlug["cafe-ejemplo"]).toBe("active");
    expect(porSlug["parrilla-demo"]).toBe("active");
    expect(porSlug["resto-moroso"]).toBe("suspended");
  });

  it("una organización sin suscripción queda suspendida (falla cerrado)", async () => {
    const nueva = await service.from("organizations").insert({ slug: "tt-sin-sub", name: "tt-sin-sub" }).select("id").single();
    try {
      await service.from("subscriptions").delete().eq("organization_id", nueva.data?.id as string);
      expect(sql(`select private.org_state('${nueva.data?.id}')`)[0][0]).toBe("suspended");
      expect(sql(`select private.org_limit('${nueva.data?.id}', 'active_products')`)[0][0]).toBe("0");
    } finally {
      await deleteOrg(service, nueva.data?.id);
    }
  });
});

describe("features por plan, add-on y estado", () => {
  type Caso = {
    etiqueta: string;
    plan: PlanCode;
    finEnMs: number;
    addon?: { extraPacks: number; terminaEnMs?: number };
    features: string[];
    models3d: number;
  };

  const casosFeatures: Caso[] = [
    { etiqueta: "Básico al día", plan: "basic", finEnMs: 3 * DIA_MS, features: ["menu"], models3d: 0 },
    { etiqueta: "Pro al día", plan: "pro", finEnMs: 3 * DIA_MS, features: ["analytics", "menu", "waiter_call"], models3d: 0 },
    {
      etiqueta: "Premium al día",
      plan: "premium",
      finEnMs: 3 * DIA_MS,
      features: ["analytics", "loyalty", "menu", "waiter_call"],
      models3d: 0,
    },
    { etiqueta: "Básico con add-on (no permitido en Básico)", plan: "basic", finEnMs: 3 * DIA_MS, addon: { extraPacks: 0 }, features: ["menu"], models3d: 0 },
    {
      etiqueta: "Pro con add-on WebAR",
      plan: "pro",
      finEnMs: 3 * DIA_MS,
      addon: { extraPacks: 0 },
      features: ["analytics", "menu", "waiter_call", "webar"],
      models3d: 15,
    },
    {
      etiqueta: "Premium con add-on y 2 packs extra",
      plan: "premium",
      finEnMs: 3 * DIA_MS,
      addon: { extraPacks: 2 },
      features: ["analytics", "loyalty", "menu", "waiter_call", "webar"],
      models3d: 35,
    },
    {
      etiqueta: "Pro con add-on vencido",
      plan: "pro",
      finEnMs: 3 * DIA_MS,
      addon: { extraPacks: 1, terminaEnMs: -HORA_MS },
      features: ["analytics", "menu", "waiter_call"],
      models3d: 0,
    },
    {
      etiqueta: "Pro en gracia con add-on: todo sigue",
      plan: "pro",
      finEnMs: -2 * DIA_MS,
      addon: { extraPacks: 0 },
      features: ["analytics", "menu", "waiter_call", "webar"],
      models3d: 15,
    },
    {
      etiqueta: "Premium en solo lectura con add-on: se apagan las interactivas",
      plan: "premium",
      finEnMs: -(9 * DIA_MS),
      addon: { extraPacks: 0 },
      features: ["analytics", "menu"],
      models3d: 15,
    },
    {
      etiqueta: "Premium suspendida: nada",
      plan: "premium",
      finEnMs: -(30 * DIA_MS),
      addon: { extraPacks: 0 },
      features: [],
      models3d: 15,
    },
  ];

  it.each(casosFeatures)("$etiqueta", async ({ plan, finEnMs, addon, features, models3d }) => {
    await service.from("subscription_addons").delete().eq("organization_id", orgId);
    await setSubscription(service, orgId, { plan, finEnMs });
    if (addon) {
      const { error } = await service.from("subscription_addons").insert({
        organization_id: orgId,
        addon_code: "webar",
        extra_packs: addon.extraPacks,
        ends_at: addon.terminaEnMs === undefined ? null : new Date(Date.now() + addon.terminaEnMs).toISOString(),
      });
      expect(error).toBeNull();
    }

    const owner = await ownerUser.db.rpc("org_entitlements", { p_org: orgId });
    const staff = await staffUser.db.rpc("org_entitlements", { p_org: orgId });

    expect(owner.data).toMatchObject({ features, limits: { models_3d: models3d } });
    expect(staff.data).toMatchObject({ features });
  });

  it("los límites del plan salen de la tabla plans", async () => {
    await service.from("subscription_addons").delete().eq("organization_id", orgId);
    const esperado = {
      basic: { branches: 1, tables_per_branch: 20, active_products: 80 },
      pro: { branches: 2, tables_per_branch: 50, active_products: 200 },
      premium: { branches: null, tables_per_branch: null, active_products: null },
    } as const;

    for (const plan of ["basic", "pro", "premium"] as const) {
      await setSubscription(service, orgId, { plan, finEnMs: 3 * DIA_MS });
      const owner = await ownerUser.db.rpc("org_entitlements", { p_org: orgId });
      expect(owner.data).toMatchObject({ limits: esperado[plan], plan });
    }
  });
});

describe("entitlements: quién ve qué", () => {
  beforeAll(async () => {
    await service.from("subscription_addons").delete().eq("organization_id", orgId);
    await setSubscription(service, orgId, { plan: "pro", finEnMs: -2.5 * DIA_MS }); // día 3
  });

  it("el owner recibe plan, fechas y días de mora", async () => {
    const { data } = await ownerUser.db.rpc("org_entitlements", { p_org: orgId });

    expect(data).toMatchObject({ plan: "pro", billing_cycle: "monthly", state: "grace", days_late: 3 });
    expect(data).toHaveProperty("period_end");
  });

  it("el staff recibe estado y capacidades, pero no plan, fechas ni días de mora", async () => {
    const { data } = await staffUser.db.rpc("org_entitlements", { p_org: orgId });

    expect(data).toMatchObject({ state: "grace", can_write: true });
    for (const clave of ["plan", "billing_cycle", "period_end", "days_late"]) expect(data).not.toHaveProperty(clave);
  });

  it("quien no es miembro, o es anon, no recibe nada", async () => {
    const otro = await otroOwner.db.rpc("org_entitlements", { p_org: orgId });
    const sinSesion = await anon.rpc("org_entitlements", { p_org: orgId });

    expect(otro.error).toBeNull();
    expect(otro.data).toBeNull();
    expect(sinSesion.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("el uso refleja lo real de la organización", async () => {
    const { data } = await ownerUser.db.rpc("org_entitlements", { p_org: orgId });

    expect(data).toMatchObject({ usage: { branches: 1, active_products: 1 } });
  });

  it("public_menu_status: existe, suspendida y no encontrada", async () => {
    const estado = (org: string, sucursal: string) => anon.rpc("public_menu_status", { p_org_slug: org, p_branch_slug: sucursal });
    const cafe = await estado("cafe-ejemplo", "centro");
    const moroso = await estado("resto-moroso", "unica");
    const inactivo = await estado("bar-inactivo", "unica");
    const inexistente = await estado("no-existe", "centro");

    expect(cafe.data).toBe("available");
    expect(moroso.data).toBe("suspended");
    expect(inactivo.data).toBeNull();
    expect(inexistente.data).toBeNull();
  });

  it("public_menu_status: una sucursal inexistente es «no existe» también en una organización suspendida", async () => {
    const estado = (org: string, sucursal: string) => anon.rpc("public_menu_status", { p_org_slug: org, p_branch_slug: sucursal });

    expect((await estado("resto-moroso", "no-existe")).data).toBeNull();
    expect((await estado("cafe-ejemplo", "no-existe")).data).toBeNull();
    expect((await estado("cafe-ejemplo", "sur")).data).toBeNull(); // sucursal de otra organización
    expect((await estado("resto-moroso", "centro")).data).toBeNull(); // sucursal de otra organización
  });
});

describe("tablas de planes y suscripciones", () => {
  it("el owner lee su suscripción; el staff y los de otra organización, no", async () => {
    const owner = await ownerUser.db.from("subscriptions").select("plan_code").eq("organization_id", orgId);
    const staff = await staffUser.db.from("subscriptions").select("plan_code").eq("organization_id", orgId);
    const ajeno = await otroOwner.db.from("subscriptions").select("plan_code").eq("organization_id", orgId);
    const propiaAjena = await otroOwner.db.from("subscriptions").select("organization_id");

    expect(owner.data).toEqual([{ plan_code: "pro" }]);
    expect(staff.data).toEqual([]);
    expect(ajeno.data).toEqual([]);
    expect(propiaAjena.data).toEqual([{ organization_id: ORG_PARRILLA }]);
  });

  it("los add-ons contratados los ve solo el owner", async () => {
    await service.from("subscription_addons").insert({ organization_id: orgId, addon_code: "webar" });

    const owner = await ownerUser.db.from("subscription_addons").select("addon_code").eq("organization_id", orgId);
    const staff = await staffUser.db.from("subscription_addons").select("addon_code").eq("organization_id", orgId);

    expect(owner.data).toEqual([{ addon_code: "webar" }]);
    expect(staff.data).toEqual([]);
    await service.from("subscription_addons").delete().eq("organization_id", orgId);
  });

  it("anon no lee ninguna de las cuatro tablas", async () => {
    for (const tabla of ["plans", "addons", "subscriptions", "subscription_addons"] as const) {
      const { error } = await anon.from(tabla).select("*");
      expect(error?.code, tabla).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it("cualquier usuario con sesión lee el catálogo de planes y add-ons", async () => {
    const planes = await staffUser.db.from("plans").select("code").order("code");
    const addons = await staffUser.db.from("addons").select("code, base_model_quota, pack_size");

    expect(planes.data?.map((p) => p.code)).toEqual(["basic", "premium", "pro"]);
    expect(addons.data).toEqual([{ code: "webar", base_model_quota: 15, pack_size: 10 }]);
  });

  it("nadie escribe planes, add-ons ni suscripciones por la API", async () => {
    for (const usuario of [ownerUser, staffUser, otroOwner]) {
      const db = usuario.db;
      const resultados = [
        await db.from("plans").update({ max_active_products: 9999 }).eq("code", "basic"),
        await db.from("plans").insert({ code: "pro", name: "x", monthly_price_usd_cents: 1, yearly_price_usd_cents: 1 }),
        await db.from("plans").delete().eq("code", "basic"),
        await db.from("addons").update({ base_model_quota: 9999 }).eq("code", "webar"),
        await db.from("subscriptions").update({ plan_code: "premium" }).eq("organization_id", orgId),
        await db.from("subscriptions").update({ current_period_end: "2099-01-01" }).eq("organization_id", orgId),
        await db.from("subscriptions").insert({ organization_id: ORG_CAFE, plan_code: "premium", trial_ends_at: "2099-01-01" }),
        await db.from("subscriptions").delete().eq("organization_id", orgId),
        await db.from("subscription_addons").insert({ organization_id: orgId, addon_code: "webar", extra_packs: 99 }),
        await db.from("subscription_addons").delete().eq("organization_id", orgId),
      ];
      for (const r of resultados) expect(r.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    }
    const intacto = await service.from("plans").select("max_active_products").eq("code", "basic").single();
    expect(intacto.data?.max_active_products).toBe(80);
  });

  it("la organización morosa del seed sigue suspendida y con sus datos", async () => {
    const platos = await service.from("products").select("id").eq("organization_id", ORG_MOROSA);
    const estado = await anon.rpc("public_menu_status", { p_org_slug: "resto-moroso", p_branch_slug: "unica" });

    expect(platos.data).toHaveLength(1);
    expect(estado.data).toBe("suspended");
  });
});
