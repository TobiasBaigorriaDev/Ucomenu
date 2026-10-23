import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CASE_BRANCHES,
  PRICE_SCENARIOS,
  createdAtOf,
  maskOf,
  minutesOf,
  type CaseBranch,
} from "@/lib/promociones/casos-precio";
import { effectivePrice, type PromotionRule } from "@/lib/promociones/precio";
import {
  addMembership,
  anonClient,
  createCategory,
  createOrg,
  createUser,
  DIA_MS,
  deleteOrg,
  deleteUser,
  serviceClient,
  setSubscription,
  sql,
  type Db,
  type PlanCode,
  type TestUser,
} from "./helpers";

/**
 * Promociones programadas y precio efectivo (nivel C, ficha promociones-y-precio-efectivo, ADR 0040) contra el Supabase local:
 * la paridad de `effective_prices` con la réplica en TypeScript sobre la misma tabla de casos (medianoche, fechas, horario de
 * verano), quién escribe y quién lee, el historial de solo-agregado, y que el precio no se filtre ni cambie con la cuenta.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
const orgs: string[] = [];
let contador = 0;
const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

type Local = { id: string; slug: string; branch: string; category: string; product: string };

async function nuevoLocal(plan: PlanCode = "pro", opciones: { dias?: number; miembros?: boolean } = {}): Promise<Local> {
  contador += 1;
  const slug = `tt-promo-${sufijo}-${contador}`;
  const id = await createOrg(service, slug, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: (opciones.dias ?? 30) * DIA_MS });
  const b = await service.from("branches").insert({ organization_id: id, slug: "principal", name: "Principal" }).select("id").single();
  if (b.error) throw new Error(`sucursal inicial: ${b.error.message}`);
  const category = await createCategory(service, id, "Bebidas");
  const p = await service.from("products").insert({ organization_id: id, category_id: category, name: "Cerveza", price_cents: 1000 }).select("id").single();
  if (p.error) throw new Error(`plato: ${p.error.message}`);
  if (opciones.miembros !== false) {
    await addMembership(service, owner, id, "owner");
    await addMembership(service, staff, id, "staff");
  }
  return { id, slug, branch: b.data.id, category, product: p.data.id };
}

/** Una promoción de todos los días y todo el día (siempre en curso), por la API del Dueño. */
const PROMO = {
  name: "Mitad de precio",
  discount_type: "percent",
  discount_value: 50,
  weekdays_mask: 127,
  start_minute: 0,
  end_minute: 1440,
} as const;

async function promoDelDueno(local: Local, extra: Record<string, unknown> = {}) {
  const r = await owner.db.from("promotions").insert({ organization_id: local.id, ...PROMO, ...extra }).select("id").single();
  if (r.error) throw new Error(`promoción: ${r.error.message}`);
  return r.data.id;
}

const apuntar = (local: Local, promo: string, extra: { product?: string; category?: string } = { product: local.product }) =>
  owner.db.from("promotion_targets").insert({ organization_id: local.id, promotion_id: promo, product_id: extra.product, category_id: extra.category });

const historial = async (promo: string) =>
  (await service.from("promotion_history").select("event, changed_by, snapshot, changed_at").eq("promotion_id", promo).order("changed_at")).data ?? [];

const eventos = async (promo: string) => (await historial(promo)).map((h) => h.event);

const precios = (db: Db, branch: string, product?: string, at?: string) =>
  db.rpc("effective_prices", { p_branch: branch, p_product: product, p_at: at });

const fechaEnDias = (dias: number) => new Date(Date.now() + dias * DIA_MS).toISOString().slice(0, 10);

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([
    createUser(service, "promo-owner"),
    createUser(service, "promo-staff"),
    createUser(service, "promo-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, stranger].map((u) => deleteUser(service, u)));
});

describe("el catálogo", () => {
  it("promotions está en Pro y Premium y no en Básico", async () => {
    const planes = await service.from("plans").select("code, features").order("code");
    const porCodigo = Object.fromEntries((planes.data ?? []).map((p) => [p.code, p.features]));
    expect(porCodigo.basic).not.toContain("promotions");
    expect(porCodigo.pro).toContain("promotions");
    expect(porCodigo.premium).toContain("promotions");
  });
});

describe("paridad de effective_prices con la réplica en TypeScript (tabla de casos compartida)", () => {
  type Sembrado = {
    products: Map<string, string>; // clave del plato → id
    promoIds: Map<string, string>; // clave de la promoción → id
    promoKeys: Map<string, string>; // id → clave
  };
  const sembrados = new Map<string, Sembrado>();
  const branches = {} as Record<CaseBranch, string>;
  let parOrg: Local;

  beforeAll(async () => {
    parOrg = await nuevoLocal("premium");
    for (const [clave, zona] of Object.entries(CASE_BRANCHES) as [CaseBranch, string][]) {
      if (clave === "ba") {
        branches[clave] = parOrg.branch;
        await service.from("branches").update({ timezone: zona }).eq("id", parOrg.branch).throwOnError();
      } else {
        const b = await service
          .from("branches")
          .insert({ organization_id: parOrg.id, slug: clave, name: clave, timezone: zona })
          .select("id")
          .single();
        if (b.error) throw new Error(b.error.message);
        branches[clave] = b.data.id;
      }
    }

    for (const scenario of PRICE_SCENARIOS) {
      const category = await createCategory(service, parOrg.id, scenario.key);
      const products = new Map<string, string>();
      for (const spec of scenario.products) {
        const p = await service
          .from("products")
          .insert({ organization_id: parOrg.id, category_id: category, name: `${scenario.key}/${spec.key}`, price_cents: spec.base })
          .select("id")
          .single();
        if (p.error) throw new Error(p.error.message);
        products.set(spec.key, p.data.id);
        for (const [clave, precio] of Object.entries(spec.branchPrices ?? {}) as [CaseBranch, number][]) {
          await service
            .from("product_availability")
            .insert({ organization_id: parOrg.id, branch_id: branches[clave], product_id: p.data.id, price_cents: precio })
            .throwOnError();
        }
      }
      const promoIds = new Map<string, string>();
      const promoKeys = new Map<string, string>();
      for (const [index, spec] of scenario.promos.entries()) {
        const fila = await service
          .from("promotions")
          .insert({
            organization_id: parOrg.id,
            name: spec.key,
            discount_type: spec.type,
            discount_value: spec.value,
            weekdays_mask: maskOf(spec.days),
            start_minute: minutesOf(spec.from),
            end_minute: minutesOf(spec.to),
            starts_on: spec.startsOn ?? null,
            ends_on: spec.endsOn ?? null,
            all_branches: spec.branches === undefined,
            is_active: !spec.paused,
            created_at: createdAtOf(index),
          })
          .select("id")
          .single();
        if (fila.error) throw new Error(`${scenario.key}/${spec.key}: ${fila.error.message}`);
        promoIds.set(spec.key, fila.data.id);
        promoKeys.set(fila.data.id, spec.key);
        const objetivos =
          scenario.target === "category"
            ? [{ category_id: category }]
            : [{ product_id: products.get(scenario.products[0].key) }];
        await service
          .from("promotion_targets")
          .insert(objetivos.map((o) => ({ organization_id: parOrg.id, promotion_id: fila.data.id, ...o })))
          .throwOnError();
        if (spec.branches) {
          await service
            .from("promotion_branches")
            .insert(spec.branches.map((b) => ({ organization_id: parOrg.id, promotion_id: fila.data.id, branch_id: branches[b] })))
            .throwOnError();
        }
      }
      sembrados.set(scenario.key, { products, promoIds, promoKeys });
    }
  }, 120_000);

  /** Las promociones de la base tal como las ve el cálculo en TypeScript: filas reales, no la tabla de casos. */
  async function reglasDeLaBase(scenarioKey: string, branch: CaseBranch, productKey: string): Promise<PromotionRule[]> {
    const sembrado = sembrados.get(scenarioKey)!;
    const productId = sembrado.products.get(productKey)!;
    const producto = (await service.from("products").select("category_id").eq("id", productId).single()).data;
    const promos = (await service.from("promotions").select("*").eq("is_active", true).in("id", [...sembrado.promoKeys.keys()])).data ?? [];
    const objetivos = (await service.from("promotion_targets").select("promotion_id, product_id, category_id").in("promotion_id", promos.map((p) => p.id))).data ?? [];
    const sucursales = (await service.from("promotion_branches").select("promotion_id, branch_id").in("promotion_id", promos.map((p) => p.id))).data ?? [];
    return promos
      .filter((p) => p.all_branches || sucursales.some((s) => s.promotion_id === p.id && s.branch_id === branches[branch]))
      .filter((p) => objetivos.some((o) => o.promotion_id === p.id && (o.product_id === productId || o.category_id === producto?.category_id)))
      .map((p) => ({
        id: p.id,
        name: p.name,
        discountType: p.discount_type as PromotionRule["discountType"],
        discountValue: p.discount_value,
        weekdaysMask: p.weekdays_mask,
        startMinute: p.start_minute,
        endMinute: p.end_minute,
        startsOn: p.starts_on,
        endsOn: p.ends_on,
        createdAt: p.created_at,
      }));
  }

  for (const scenario of PRICE_SCENARIOS) {
    it(scenario.key, async () => {
      const sembrado = sembrados.get(scenario.key)!;
      for (const probe of scenario.probes) {
        const productKey = probe.product ?? scenario.products[0].key;
        const etiqueta = `${scenario.key} · ${probe.branch} · ${probe.at}`;
        const r = await precios(owner.db, branches[probe.branch], sembrado.products.get(productKey), probe.at);
        expect(r.error, etiqueta).toBeNull();
        expect(r.data, etiqueta).toHaveLength(1);
        const fila = r.data![0];
        expect(fila.price_cents, etiqueta).toBe(probe.price);
        expect(fila.promotion_id === null ? null : sembrado.promoKeys.get(fila.promotion_id), etiqueta).toBe(probe.promo);
        if (probe.endsLocal) expect(fila.ends_local, etiqueta).toBe(probe.endsLocal);
        else expect(fila.ends_local, etiqueta).toBeNull();

        // La réplica en TypeScript, alimentada con las filas que quedaron en la base, tiene que dar lo mismo.
        const reglas = await reglasDeLaBase(scenario.key, probe.branch, productKey);
        const ts = effectivePrice({
          basePriceCents: fila.base_price_cents,
          promotions: reglas,
          timeZone: CASE_BRANCHES[probe.branch],
          at: new Date(probe.at),
        });
        expect(ts.priceCents, `TS ${etiqueta}`).toBe(fila.price_cents);
        expect(ts.promotion?.id ?? null, `TS ${etiqueta}`).toBe(fila.promotion_id);
        expect(ts.promotion?.endsLocal ?? null, `TS ${etiqueta}`).toBe(fila.ends_local);
      }
    }, 60_000);
  }

  it("sin p_product devuelve solo los platos con una promoción en curso, cada uno con su precio", async () => {
    const sembrado = sembrados.get("happy-hour")!;
    const r = await precios(owner.db, branches.ba, undefined, "2026-12-18T21:00:00Z"); // vie 18:00 en Buenos Aires
    expect(r.error).toBeNull();
    const filas = r.data ?? [];
    expect(filas.length).toBeGreaterThan(0);
    for (const fila of filas) {
      expect(fila.promotion_id).not.toBeNull();
      expect(fila.price_cents).toBeLessThan(fila.base_price_cents);
    }
    expect(filas.find((f) => f.product_id === sembrado.products.get("p"))).toMatchObject({ price_cents: 7500, base_price_cents: 10000 });
    // A las 17:59 la de happy hour no está (otras de todo el día sí).
    const antes = (await precios(owner.db, branches.ba, undefined, "2026-12-18T20:59:00Z")).data ?? [];
    expect(antes.find((f) => f.product_id === sembrado.products.get("p"))).toBeUndefined();
  });
});

describe("quién escribe", () => {
  it("el Dueño crea una promoción con su plato y su sucursal, la cambia, la pausa y la borra", async () => {
    const local = await nuevoLocal();
    const promo = await promoDelDueno(local, { all_branches: false });
    expect((await apuntar(local, promo)).error).toBeNull();
    const rama = await owner.db.from("promotion_branches").insert({ organization_id: local.id, promotion_id: promo, branch_id: local.branch });
    expect(rama.error).toBeNull();

    const cambio = await owner.db.from("promotions").update({ name: "Dos por uno", discount_value: 30, is_active: false }).eq("id", promo).select("name, discount_value, is_active");
    expect(cambio.data).toEqual([{ name: "Dos por uno", discount_value: 30, is_active: false }]);
    const borrada = await owner.db.from("promotions").delete().eq("id", promo).select("id");
    expect(borrada.data).toEqual([{ id: promo }]);
    expect(((await service.from("promotion_targets").select("id").eq("promotion_id", promo)).data ?? []).length).toBe(0);
  });

  it("el Staff, el Dueño de otra organización y anon no escriben", async () => {
    const local = await nuevoLocal();
    const promo = await promoDelDueno(local);
    const fila = { organization_id: local.id, ...PROMO };

    const delStaff = await staff.db.from("promotions").insert(fila);
    expect(delStaff.error?.code).toBe("42501");
    const delAjeno = await stranger.db.from("promotions").insert(fila);
    expect(delAjeno.error?.code).toBe("42501");
    const delAnon = await anonClient().from("promotions").insert(fila);
    expect(delAnon.error?.code).toBe("42501");

    // Actualizar y borrar: la política no deja ver la fila, así que no afecta ninguna.
    for (const quien of [staff, stranger]) {
      const u = await quien.db.from("promotions").update({ is_active: false }).eq("id", promo).select("id");
      expect(u.data ?? [], "update").toEqual([]);
      const d = await quien.db.from("promotions").delete().eq("id", promo).select("id");
      expect(d.data ?? [], "delete").toEqual([]);
    }
    const t = await staff.db.from("promotion_targets").insert({ organization_id: local.id, promotion_id: promo, product_id: local.product });
    expect(t.error?.code).toBe("42501");
    const b = await staff.db.from("promotion_branches").insert({ organization_id: local.id, promotion_id: promo, branch_id: local.branch });
    expect(b.error?.code).toBe("42501");
    expect((await service.from("promotions").select("is_active").eq("id", promo).single()).data?.is_active).toBe(true);
  });

  it("sin la función en el plan (Básico) el Dueño no escribe; con una vista previa vigente sí, y al terminar deja de poder", async () => {
    const local = await nuevoLocal("basic");
    expect((await owner.db.from("promotions").insert({ organization_id: local.id, ...PROMO })).error?.code).toBe("42501");

    sql(`insert into public.organization_feature_previews (organization_id, feature, ends_at, reason) values ('${local.id}', 'promotions', now() + interval '10 days', 'prueba')`);
    const promo = await promoDelDueno(local);
    expect(promo).toBeTruthy();

    sql(`update public.organization_feature_previews set ends_at = now() - interval '1 minute' where organization_id = '${local.id}'`);
    expect((await owner.db.from("promotions").insert({ organization_id: local.id, ...PROMO })).error?.code).toBe("42501");
    const u = await owner.db.from("promotions").update({ is_active: false }).eq("id", promo).select("id");
    expect(u.data ?? []).toEqual([]);
  });

  it("con la cuenta en solo lectura o suspendida, ni el Dueño escribe; en gracia sí", async () => {
    for (const [finEnMs, escribe] of [
      [-2 * DIA_MS, true], // gracia
      [-10 * DIA_MS, false], // solo lectura
      [-20 * DIA_MS, false], // suspendida
    ] as const) {
      const local = await nuevoLocal("pro", { dias: 30 });
      await setSubscription(service, local.id, { finEnMs });
      const r = await owner.db.from("promotions").insert({ organization_id: local.id, ...PROMO });
      expect(r.error === null, `finEnMs ${finEnMs}`).toBe(escribe);
      if (!escribe) expect(r.error?.code).toBe("42501");
    }
  });

  it("los valores fuera de regla se rechazan con 23514", async () => {
    const local = await nuevoLocal();
    const malos: Record<string, unknown>[] = [
      { discount_value: 101 }, // porcentaje > 100
      { discount_value: 0 }, // porcentaje 0
      { discount_type: "amount", discount_value: 0 },
      { discount_type: "fixed_price", discount_value: -1 },
      { discount_type: "rebaja" },
      { weekdays_mask: 0 },
      { weekdays_mask: 128 },
      { start_minute: -1 },
      { start_minute: 1440 },
      { end_minute: 0 },
      { end_minute: 1441 },
      { start_minute: 600, end_minute: 600 }, // una franja vacía
      { starts_on: "2026-12-20", ends_on: "2026-12-19" },
      { name: "" },
      { name: " con espacios " },
      { name: "x".repeat(81) },
    ];
    for (const mal of malos) {
      const r = await owner.db.from("promotions").insert({ organization_id: local.id, ...PROMO, ...mal });
      expect(r.error?.code, JSON.stringify(mal)).toBe("23514");
    }
    // Lo límite que sí vale.
    for (const bien of [
      { discount_value: 100 },
      { discount_type: "fixed_price", discount_value: 0 },
      { start_minute: 1439, end_minute: 1 },
      { start_minute: 0, end_minute: 1440 },
      { starts_on: "2026-12-19", ends_on: "2026-12-19" },
      { name: "x".repeat(80) },
    ]) {
      const r = await owner.db.from("promotions").insert({ organization_id: local.id, ...PROMO, ...bien });
      expect(r.error, JSON.stringify(bien)).toBeNull();
    }
  });

  it("no cruza organizaciones: ni un plato, ni una categoría, ni una sucursal ajenos, ni escribir en otra organización", async () => {
    const local = await nuevoLocal();
    const otra = await nuevoLocal("pro", { miembros: false });
    const promo = await promoDelDueno(local);

    expect((await apuntar(local, promo, { product: otra.product })).error?.code).toBe("23503");
    expect((await apuntar(local, promo, { category: otra.category })).error?.code).toBe("23503");
    const rama = await owner.db.from("promotion_branches").insert({ organization_id: local.id, promotion_id: promo, branch_id: otra.branch });
    expect(rama.error?.code).toBe("23503");
    // Escribir en la otra organización (de la que no es miembro) lo frena la política.
    expect((await owner.db.from("promotions").insert({ organization_id: otra.id, ...PROMO })).error?.code).toBe("42501");
    // Un objetivo con plato Y categoría, o con ninguno, no existe.
    const dos = await owner.db.from("promotion_targets").insert({ organization_id: local.id, promotion_id: promo, product_id: local.product, category_id: local.category });
    expect(dos.error?.code).toBe("23514");
    const ninguno = await owner.db.from("promotion_targets").insert({ organization_id: local.id, promotion_id: promo });
    expect(ninguno.error?.code).toBe("23514");
    // El mismo plato dos veces en la misma promoción tampoco.
    expect((await apuntar(local, promo)).error).toBeNull();
    expect((await apuntar(local, promo)).error?.code).toBe("23505");
  });

  it("las claves y el alta no se pueden cambiar por la API", async () => {
    const local = await nuevoLocal();
    const otra = await nuevoLocal("pro", { miembros: false });
    const promo = await promoDelDueno(local);
    const mover = await owner.db.from("promotions").update({ organization_id: otra.id }).eq("id", promo);
    expect(mover.error?.code).toBe("42501");
    const fecha = await owner.db.from("promotions").update({ created_at: "2020-01-01T00:00:00Z" }).eq("id", promo);
    expect(fecha.error?.code).toBe("42501");
    const id = await owner.db.from("promotions").update({ id: crypto.randomUUID() }).eq("id", promo);
    expect(id.error?.code).toBe("42501");
  });
});

describe("quién lee", () => {
  it("el Dueño y el Staff leen las promociones, sus platos y su historial; otra organización y anon, nada", async () => {
    const local = await nuevoLocal();
    const promo = await promoDelDueno(local);
    await apuntar(local, promo);

    for (const quien of [owner, staff]) {
      expect(((await quien.db.from("promotions").select("id").eq("id", promo)).data ?? []).length).toBe(1);
      expect(((await quien.db.from("promotion_targets").select("id").eq("promotion_id", promo)).data ?? []).length).toBe(1);
      expect(((await quien.db.from("promotion_history").select("id").eq("promotion_id", promo)).data ?? []).length).toBe(2);
    }
    expect((await stranger.db.from("promotions").select("id").eq("id", promo)).data ?? []).toEqual([]);
    expect((await stranger.db.from("promotion_history").select("id").eq("promotion_id", promo)).data ?? []).toEqual([]);
    for (const tabla of ["promotions", "promotion_targets", "promotion_branches", "promotion_history"] as const) {
      expect((await anonClient().from(tabla).select("*")).error?.code, tabla).toBe("42501");
    }
  });

  it("con la cuenta en solo lectura o suspendida se siguen leyendo", async () => {
    const local = await nuevoLocal();
    const promo = await promoDelDueno(local);
    for (const finEnMs of [-10 * DIA_MS, -20 * DIA_MS]) {
      await setSubscription(service, local.id, { finEnMs });
      expect(((await owner.db.from("promotions").select("id").eq("id", promo)).data ?? []).length, `finEnMs ${finEnMs}`).toBe(1);
    }
  });
});

describe("el historial de solo-agregado", () => {
  it("registra el alta, los cambios, los platos y sucursales que se suman o se quitan, y la baja, con quién lo hizo", async () => {
    const local = await nuevoLocal();
    const promo = await promoDelDueno(local, { all_branches: false });
    await apuntar(local, promo);
    await owner.db.from("promotion_branches").insert({ organization_id: local.id, promotion_id: promo, branch_id: local.branch });
    await owner.db.from("promotions").update({ discount_value: 20 }).eq("id", promo);
    await owner.db.from("promotion_branches").delete().eq("promotion_id", promo);
    await owner.db.from("promotion_targets").delete().eq("promotion_id", promo);
    await owner.db.from("promotions").delete().eq("id", promo);

    expect(await eventos(promo)).toEqual(["created", "target_added", "branch_added", "updated", "branch_removed", "target_removed", "deleted"]);
    const filas = await historial(promo);
    for (const fila of filas) expect(fila.changed_by).toBe(owner.id);
    expect(filas[0].snapshot).toMatchObject({ name: "Mitad de precio", discount_value: 50, organization_id: local.id });
    expect(filas[3].snapshot).toMatchObject({ discount_value: 20 });
    expect(filas[1].snapshot).toMatchObject({ product_id: local.product });
    expect(filas[2].snapshot).toMatchObject({ branch_id: local.branch });
  });

  it("un cambio que no cambia nada no deja constancia", async () => {
    const local = await nuevoLocal();
    const promo = await promoDelDueno(local);
    await owner.db.from("promotions").update({ discount_value: 50, name: "Mitad de precio" }).eq("id", promo);
    expect(await eventos(promo)).toEqual(["created"]);
  });

  it("la baja de la promoción deja UNA constancia con sus platos y sucursales, no una por cada uno; la historia sobrevive", async () => {
    const local = await nuevoLocal();
    const promo = await promoDelDueno(local, { all_branches: false });
    await apuntar(local, promo);
    await apuntar(local, promo, { category: local.category });
    await owner.db.from("promotion_branches").insert({ organization_id: local.id, promotion_id: promo, branch_id: local.branch });
    await owner.db.from("promotions").delete().eq("id", promo);

    expect(await eventos(promo)).toEqual(["created", "target_added", "target_added", "branch_added", "deleted"]);
    const baja = (await historial(promo)).at(-1)!;
    const snapshot = baja.snapshot as { targets: { product_id: string | null; category_id: string | null }[]; branches: { branch_id: string }[] };
    expect(snapshot.targets).toHaveLength(2);
    expect(snapshot.targets.map((t) => t.product_id ?? t.category_id).sort()).toEqual([local.product, local.category].sort());
    expect(snapshot.branches).toEqual([expect.objectContaining({ branch_id: local.branch })]);
    // La promoción ya no existe y su historia sí.
    expect(((await service.from("promotions").select("id").eq("id", promo)).data ?? []).length).toBe(0);
  });

  it("borrar un plato retira su objetivo y queda constancia; borrar la categoría, también", async () => {
    const local = await nuevoLocal();
    const otroPlato = await service.from("products").insert({ organization_id: local.id, category_id: local.category, name: "Otro", price_cents: 500 }).select("id").single();
    const categoria = await createCategory(service, local.id, "Postres");
    const promo = await promoDelDueno(local);
    await apuntar(local, promo, { product: otroPlato.data!.id });
    await apuntar(local, promo, { category: categoria });
    await service.from("products").delete().eq("id", otroPlato.data!.id).throwOnError();
    await service.from("categories").delete().eq("id", categoria).throwOnError();
    expect(await eventos(promo)).toEqual(["created", "target_added", "target_added", "target_removed", "target_removed"]);
    expect(((await service.from("promotion_targets").select("id").eq("promotion_id", promo)).data ?? []).length).toBe(0);
  });

  it("nadie de la API la escribe, ni la cambia ni la borra (tampoco el servicio técnico)", async () => {
    const local = await nuevoLocal();
    const promo = await promoDelDueno(local);
    const fila = { organization_id: local.id, promotion_id: promo, event: "created", snapshot: {} };
    for (const [quien, db] of [["Dueño", owner.db], ["Staff", staff.db], ["servicio", service], ["anon", anonClient()]] as const) {
      expect((await db.from("promotion_history").insert(fila)).error?.code, `${quien} inserta`).toBe("42501");
      expect((await db.from("promotion_history").update({ event: "deleted" }).eq("promotion_id", promo)).error?.code, `${quien} actualiza`).toBe("42501");
      expect((await db.from("promotion_history").delete().eq("promotion_id", promo)).error?.code, `${quien} borra`).toBe("42501");
    }
    expect(await eventos(promo)).toEqual(["created"]);
  });

  it("aun con privilegios de dueño de la tabla, UPDATE, DELETE y TRUNCATE fallan", async () => {
    const local = await nuevoLocal();
    const promo = await promoDelDueno(local);
    expect(() => sql(`update public.promotion_history set event = 'deleted' where promotion_id = '${promo}'`)).toThrow(/solo agregado/);
    expect(() => sql(`delete from public.promotion_history where promotion_id = '${promo}'`)).toThrow(/solo agregado/);
    expect(() => sql(`truncate public.promotion_history`)).toThrow(/solo agregado/);
    expect(await eventos(promo)).toEqual(["created"]);
  });

  it("el servicio técnico no deja constancia de una persona: changed_by queda nulo", async () => {
    const local = await nuevoLocal();
    const fila = await service
      .from("promotions")
      .insert({ organization_id: local.id, ...PROMO })
      .select("id")
      .single();
    expect((await historial(fila.data!.id))[0].changed_by).toBeNull();
  });
});

describe("effective_prices: quién lo ve y cuándo se aplica", () => {
  it("anon ve la promoción en curso con su precio, y no ve una futura aunque pida otra hora", async () => {
    const local = await nuevoLocal();
    const vigente = await promoDelDueno(local, { name: "Vigente" });
    await apuntar(local, vigente);
    const anon = anonClient();

    const ahora = await precios(anon, local.branch, local.product);
    expect(ahora.data).toEqual([expect.objectContaining({ base_price_cents: 1000, price_cents: 500, promotion_name: "Vigente", discount_type: "percent" })]);
    expect((await precios(anon, local.branch)).data).toHaveLength(1);

    // Una promoción que empieza en dos días: no se ve hoy, y pedir una hora futura no la destapa para anon.
    await owner.db.from("promotions").update({ is_active: false }).eq("id", vigente);
    const futura = await promoDelDueno(local, { name: "Futura", starts_on: fechaEnDias(2), discount_value: 80 });
    await apuntar(local, futura);
    const dentroDeCinco = new Date(Date.now() + 5 * DIA_MS).toISOString();
    expect((await precios(anon, local.branch, local.product)).data).toEqual([expect.objectContaining({ price_cents: 1000, promotion_id: null })]);
    expect((await precios(anon, local.branch, local.product, dentroDeCinco)).data).toEqual([expect.objectContaining({ price_cents: 1000, promotion_id: null })]);
    // El Dueño y el Staff sí pueden ver cómo quedará (vista previa por día y hora).
    for (const quien of [owner, staff]) {
      expect((await precios(quien.db, local.branch, local.product, dentroDeCinco)).data).toEqual([expect.objectContaining({ price_cents: 200, promotion_name: "Futura" })]);
    }
    // Una persona de otra organización no.
    expect((await precios(stranger.db, local.branch, local.product, dentroDeCinco)).data).toEqual([expect.objectContaining({ price_cents: 1000, promotion_id: null })]);
  });

  it("un plato o una categoría desactivados no se exponen aunque tengan promoción (lo mismo que la carta pública)", async () => {
    const local = await nuevoLocal();
    const categoria = await createCategory(service, local.id, "Postres");
    const postre = await service.from("products").insert({ organization_id: local.id, category_id: categoria, name: "Flan", price_cents: 800 }).select("id").single();
    const promo = await promoDelDueno(local);
    await apuntar(local, promo);
    await apuntar(local, promo, { product: postre.data!.id });
    const anon = anonClient();
    const ids = async () => ((await precios(anon, local.branch)).data ?? []).map((f) => f.product_id).sort();
    expect(await ids()).toEqual([local.product, postre.data!.id].sort());

    await service.from("products").update({ is_active: false }).eq("id", local.product).throwOnError();
    expect(await ids()).toEqual([postre.data!.id]);
    expect((await precios(anon, local.branch, local.product)).data).toEqual([]);
    // También para quien es miembro: lo que no se publica no tiene precio efectivo.
    expect((await precios(owner.db, local.branch, local.product)).data).toEqual([]);

    await service.from("categories").update({ is_active: false }).eq("id", categoria).throwOnError();
    expect(await ids()).toEqual([]);
    expect((await precios(anon, local.branch, postre.data!.id)).data).toEqual([]);

    await service.from("products").update({ is_active: true }).eq("id", local.product).throwOnError();
    await service.from("categories").update({ is_active: true }).eq("id", categoria).throwOnError();
    expect(await ids()).toEqual([local.product, postre.data!.id].sort());
  });

  it("el desempate llega a los microsegundos: gana la alta más antigua aunque su id sea mayor, y la réplica coincide", async () => {
    const local = await nuevoLocal();
    const idPrimera = "ffffffff-0000-4000-8000-000000000000";
    const idSegunda = "00000000-0000-4000-8000-000000000001";
    const base = { organization_id: local.id, name: "Fija", discount_type: "fixed_price", discount_value: 700, weekdays_mask: 127, start_minute: 0, end_minute: 1440 };
    await service.from("promotions").insert({ ...base, id: idSegunda, created_at: "2026-01-01T00:00:00.000900Z" }).throwOnError();
    await service.from("promotions").insert({ ...base, id: idPrimera, created_at: "2026-01-01T00:00:00.000100Z" }).throwOnError();
    for (const id of [idPrimera, idSegunda]) await apuntar(local, id);
    const fila = (await precios(anonClient(), local.branch, local.product)).data?.[0];
    expect(fila?.promotion_id).toBe(idPrimera);

    const promos = (await service.from("promotions").select("*").eq("organization_id", local.id)).data ?? [];
    const reglas: PromotionRule[] = promos.map((p) => ({
      id: p.id,
      name: p.name,
      discountType: p.discount_type as PromotionRule["discountType"],
      discountValue: p.discount_value,
      weekdaysMask: p.weekdays_mask,
      startMinute: p.start_minute,
      endMinute: p.end_minute,
      startsOn: p.starts_on,
      endsOn: p.ends_on,
      createdAt: p.created_at,
    }));
    const ts = effectivePrice({ basePriceCents: 1000, promotions: reglas, timeZone: "America/Argentina/Buenos_Aires", at: new Date() });
    expect(ts.promotion?.id).toBe(idPrimera);
  });

  it("una promoción pausada no se aplica; reanudarla la aplica", async () => {
    const local = await nuevoLocal();
    const promo = await promoDelDueno(local, { is_active: false });
    await apuntar(local, promo);
    expect((await precios(anonClient(), local.branch, local.product)).data).toEqual([expect.objectContaining({ price_cents: 1000, promotion_id: null })]);
    await owner.db.from("promotions").update({ is_active: true }).eq("id", promo);
    expect((await precios(anonClient(), local.branch, local.product)).data).toEqual([expect.objectContaining({ price_cents: 500 })]);
  });

  it("sin la función en el plan no se aplica (Básico), y con una vista previa vigente sí", async () => {
    const local = await nuevoLocal("pro");
    const promo = await promoDelDueno(local);
    await apuntar(local, promo);
    expect((await precios(anonClient(), local.branch, local.product)).data).toEqual([expect.objectContaining({ price_cents: 500 })]);

    await service.from("subscriptions").update({ plan_code: "basic" }).eq("organization_id", local.id).throwOnError();
    expect((await precios(anonClient(), local.branch, local.product)).data).toEqual([expect.objectContaining({ price_cents: 1000, promotion_id: null })]);
    expect((await precios(anonClient(), local.branch)).data).toEqual([]);

    sql(`insert into public.organization_feature_previews (organization_id, feature, ends_at, reason) values ('${local.id}', 'promotions', now() + interval '10 days', 'prueba')`);
    expect((await precios(anonClient(), local.branch, local.product)).data).toEqual([expect.objectContaining({ price_cents: 500 })]);
    sql(`update public.organization_feature_previews set ends_at = now() - interval '1 minute' where organization_id = '${local.id}'`);
    expect((await precios(anonClient(), local.branch, local.product)).data).toEqual([expect.objectContaining({ price_cents: 1000, promotion_id: null })]);
  });

  it("la mora: en solo lectura la promoción sigue aplicándose (la carta no cambia de precio); suspendida, no hay carta", async () => {
    const local = await nuevoLocal();
    const promo = await promoDelDueno(local);
    await apuntar(local, promo);
    await setSubscription(service, local.id, { finEnMs: -2 * DIA_MS }); // gracia
    expect((await precios(anonClient(), local.branch, local.product)).data).toEqual([expect.objectContaining({ price_cents: 500 })]);
    await setSubscription(service, local.id, { finEnMs: -10 * DIA_MS }); // solo lectura
    expect((await precios(anonClient(), local.branch, local.product)).data).toEqual([expect.objectContaining({ price_cents: 500 })]);
    await setSubscription(service, local.id, { finEnMs: -20 * DIA_MS }); // suspendida
    expect((await precios(anonClient(), local.branch, local.product)).data).toEqual([]);
  });

  it("sucursal desactivada, organización dada de baja, sucursal o plato inexistentes o ajenos: ninguna fila", async () => {
    const local = await nuevoLocal();
    const otra = await nuevoLocal("pro", { miembros: false });
    const promo = await promoDelDueno(local);
    await apuntar(local, promo);
    expect((await precios(anonClient(), local.branch, otra.product)).data).toEqual([]); // plato de otra organización
    expect((await precios(anonClient(), crypto.randomUUID(), local.product)).data).toEqual([]);
    expect((await precios(anonClient(), local.branch, crypto.randomUUID())).data).toEqual([]);

    await service.from("branches").update({ is_active: false }).eq("id", local.branch).throwOnError();
    expect((await precios(anonClient(), local.branch, local.product)).data).toEqual([]);
    await service.from("branches").update({ is_active: true }).eq("id", local.branch).throwOnError();
    await service.from("organizations").update({ is_active: false }).eq("id", local.id).throwOnError();
    expect((await precios(anonClient(), local.branch, local.product)).data).toEqual([]);
  });

  it("una promoción de otra organización no se aplica a mis platos", async () => {
    const local = await nuevoLocal();
    const otra = await nuevoLocal("pro", { miembros: false });
    const promo = await service
      .from("promotions")
      .insert({ organization_id: otra.id, ...PROMO })
      .select("id")
      .single();
    await service.from("promotion_targets").insert({ organization_id: otra.id, promotion_id: promo.data!.id, product_id: otra.product }).throwOnError();
    expect((await precios(anonClient(), local.branch, local.product)).data).toEqual([expect.objectContaining({ price_cents: 1000, promotion_id: null })]);
    expect((await precios(anonClient(), otra.branch, otra.product)).data).toEqual([expect.objectContaining({ price_cents: 500 })]);
  });

  it("la zona de la sucursal manda: la misma promoción de un solo día cae en días distintos según la zona", async () => {
    const local = await nuevoLocal();
    const promo = await promoDelDueno(local, { weekdays_mask: maskOf([6]), start_minute: 0, end_minute: 1440 }); // solo sábados
    await apuntar(local, promo);
    const instante = "2026-12-19T02:30:00Z"; // viernes 23:30 en Buenos Aires, sábado 03:30 en Madrid
    const consulta = async () => (await precios(owner.db, local.branch, local.product, instante)).data?.[0]?.price_cents;
    expect(await consulta()).toBe(1000);
    await owner.db.from("branches").update({ timezone: "Europe/Madrid" }).eq("id", local.branch).throwOnError();
    expect(await consulta()).toBe(500);
  });
});

describe("el borrado de una organización", () => {
  it("con promociones, sus platos e historial se borra sin que la cascada escriba en el historial", async () => {
    const local = await nuevoLocal("pro", { miembros: false });
    const promo = await service.from("promotions").insert({ organization_id: local.id, ...PROMO }).select("id").single();
    await service.from("promotion_targets").insert({ organization_id: local.id, promotion_id: promo.data!.id, product_id: local.product }).throwOnError();
    await service.from("promotion_branches").insert({ organization_id: local.id, promotion_id: promo.data!.id, branch_id: local.branch }).throwOnError();
    await service.from("promotions").update({ discount_value: 10 }).eq("id", promo.data!.id).throwOnError();
    expect((await eventos(promo.data!.id)).length).toBeGreaterThan(1);

    await deleteOrg(service, local.id); // purga el historial y borra la organización (la cascada se lleva las promociones)
    orgs.splice(orgs.indexOf(local.id), 1);
    expect(((await service.from("organizations").select("id").eq("id", local.id)).data ?? []).length).toBe(0);
    for (const tabla of ["promotions", "promotion_targets", "promotion_branches", "promotion_history"] as const) {
      expect(((await service.from(tabla).select("organization_id").eq("organization_id", local.id)).data ?? []).length, tabla).toBe(0);
    }
  });

  it("una organización con historial de promociones no se puede borrar sin purgarlo (RESTRICT)", async () => {
    const local = await nuevoLocal("pro", { miembros: false });
    await service.from("promotions").insert({ organization_id: local.id, ...PROMO }).throwOnError();
    const r = await service.from("organizations").delete().eq("id", local.id);
    expect(r.error?.code).toBe("23503");
  });
});
