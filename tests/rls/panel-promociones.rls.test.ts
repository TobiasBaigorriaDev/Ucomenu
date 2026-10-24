import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEntitlements, type Entitlements } from "@/lib/entitlements";
import { applyPromotions, loadBranchPromotions } from "@/lib/promociones/carta";
import { PAGE_SIZE, describeEntry, loadNameLookups, loadPromotionHistory, loadPromotionNames, parseCursor } from "@/lib/promociones/historial";
import {
  deletePromotion,
  duplicatePromotion,
  loadCatalog,
  loadPromotions,
  loadPromotionsScreen,
  previewPrices,
  savePromotion,
  setPromotionActive,
} from "@/lib/promociones/promociones";
import { PROMOTION_NAME_MAX, maskOf, type PromotionInput } from "@/lib/promociones/reglas";
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
  type Db,
  type PlanCode,
  type TestUser,
} from "./helpers";

/**
 * Panel de promociones (ficha panel-de-promociones) contra el Supabase local: guardar una promoción con sus platos y sucursales en
 * UNA transacción (`save_promotion`, SECURITY INVOKER: manda la RLS), pausar, duplicar, borrar, superposiciones, vista previa y la
 * lectura del historial. La carta y la paridad del precio están en `promociones.rls.test.ts`.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
const orgs: string[] = [];
let contador = 0;
const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

type Local = { id: string; slug: string; branch: string; category: string; products: string[] };

async function nuevoLocal(plan: PlanCode = "pro", opciones: { miembros?: boolean } = {}): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-panel-promo-${sufijo}-${contador}`, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const b = await service.from("branches").insert({ organization_id: id, slug: "principal", name: "Principal" }).select("id").single();
  if (b.error) throw new Error(b.error.message);
  const category = await createCategory(service, id, "Bebidas");
  const products: string[] = [];
  for (const [name, price] of [["Cerveza", 1000], ["Vino", 2000], ["Gaseosa", 500]] as const) {
    const p = await service.from("products").insert({ organization_id: id, category_id: category, name, price_cents: price }).select("id").single();
    if (p.error) throw new Error(p.error.message);
    products.push(p.data.id);
  }
  if (opciones.miembros !== false) {
    await addMembership(service, owner, id, "owner");
    await addMembership(service, staff, id, "staff");
  }
  return { id, slug: `tt-panel-promo-${sufijo}-${contador}`, branch: b.data.id, category, products };
}

const entOf = async (user: TestUser, orgId: string): Promise<Entitlements | null> => parseEntitlements((await user.db.rpc("org_entitlements", { p_org: orgId })).data);

const input = (local: Local, over: Partial<PromotionInput> = {}): PromotionInput => ({
  name: "Happy hour",
  discountType: "percent",
  discountValue: 25,
  weekdaysMask: maskOf([1, 2, 3, 4, 5]),
  startMinute: 1080,
  endMinute: 1200,
  startsOn: null,
  endsOn: null,
  allBranches: true,
  branchIds: [],
  productIds: [local.products[0]],
  categoryIds: [],
  isActive: true,
  ...over,
});

const guardar = async (local: Local, over: Partial<PromotionInput> = {}, id: string | null = null, who: TestUser = owner) =>
  savePromotion(who.db, local.id, id, input(local, over), await entOf(who, local.id));

async function crear(local: Local, over: Partial<PromotionInput> = {}): Promise<string> {
  const r = await guardar(local, over);
  if (!r.ok) throw new Error(`no se pudo crear la promoción: ${r.error}`);
  return r.data.id;
}

const cuentaPromos = async (orgId: string) => ((await service.from("promotions").select("id").eq("organization_id", orgId)).data ?? []).length;
const objetivos = async (promo: string) =>
  ((await service.from("promotion_targets").select("product_id, category_id").eq("promotion_id", promo)).data ?? []).map((t) => t.product_id ?? `cat:${t.category_id}`).sort();
const sucursales = async (promo: string) => ((await service.from("promotion_branches").select("branch_id").eq("promotion_id", promo)).data ?? []).map((b) => b.branch_id).sort();

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([
    createUser(service, "panelpromo-owner"),
    createUser(service, "panelpromo-staff"),
    createUser(service, "panelpromo-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, stranger].map((u) => deleteUser(service, u)));
});

describe("guardar una promoción (save_promotion): una transacción", () => {
  it("crea la promoción con sus platos, categorías y sucursales", async () => {
    const local = await nuevoLocal();
    const otraSucursal = await service.from("branches").insert({ organization_id: local.id, slug: "norte", name: "Norte" }).select("id").single();
    const id = await crear(local, { productIds: [local.products[0], local.products[1]], categoryIds: [local.category], allBranches: false, branchIds: [otraSucursal.data!.id] });
    expect(await objetivos(id)).toEqual([local.products[0], local.products[1], `cat:${local.category}`].sort());
    expect(await sucursales(id)).toEqual([otraSucursal.data!.id]);
    const fila = (await service.from("promotions").select("*").eq("id", id).single()).data!;
    expect(fila).toMatchObject({ name: "Happy hour", discount_type: "percent", discount_value: 25, weekdays_mask: 31, start_minute: 1080, end_minute: 1200, all_branches: false, is_active: true });
  });

  it("editar deja los platos y las sucursales exactamente como se piden: quita, suma y conserva sin ruido en el historial", async () => {
    const local = await nuevoLocal();
    const norte = (await service.from("branches").insert({ organization_id: local.id, slug: "norte", name: "Norte" }).select("id").single()).data!.id;
    const id = await crear(local, { productIds: [local.products[0], local.products[1]], allBranches: false, branchIds: [local.branch] });
    const antes = ((await service.from("promotion_history").select("id").eq("promotion_id", id)).data ?? []).length;

    const r = await guardar(local, { productIds: [local.products[1], local.products[2]], allBranches: false, branchIds: [local.branch, norte], discountValue: 30 }, id);
    expect(r).toEqual({ ok: true, data: { id } });
    expect(await objetivos(id)).toEqual([local.products[1], local.products[2]].sort());
    expect(await sucursales(id)).toEqual([local.branch, norte].sort());
    const eventos = ((await service.from("promotion_history").select("event").eq("promotion_id", id).order("changed_at")).data ?? []).map((h) => h.event).slice(antes);
    // Un cambio de la promoción, un plato que sale, uno que entra y una sucursal que entra; el plato que se conserva no deja constancia.
    expect(eventos.sort()).toEqual(["branch_added", "target_added", "target_removed", "updated"]);

    // Pasar a «todas las sucursales» borra las filas de sucursales.
    await guardar(local, { productIds: [local.products[1]], allBranches: true }, id);
    expect(await sucursales(id)).toEqual([]);
  });

  it("si algo falla, no queda nada a medias: un alta rechazada no crea la promoción, una edición rechazada no cambia nada", async () => {
    const local = await nuevoLocal();
    const otra = await nuevoLocal("pro", { miembros: false });

    const antes = await cuentaPromos(local.id);
    expect(await guardar(local, { productIds: [local.products[0], otra.products[0]] })).toEqual({ ok: false, error: "foreign_object" });
    expect(await cuentaPromos(local.id)).toBe(antes);

    const id = await crear(local, { productIds: [local.products[0], local.products[1]] });
    const historial = ((await service.from("promotion_history").select("id").eq("promotion_id", id)).data ?? []).length;
    expect(await guardar(local, { name: "Nuevo nombre", productIds: [local.products[2], otra.products[0]] }, id)).toEqual({ ok: false, error: "foreign_object" });
    expect((await service.from("promotions").select("name").eq("id", id).single()).data?.name).toBe("Happy hour");
    expect(await objetivos(id)).toEqual([local.products[0], local.products[1]].sort());
    expect(((await service.from("promotion_history").select("id").eq("promotion_id", id)).data ?? []).length).toBe(historial);

    // Una sucursal ajena también.
    expect(await guardar(local, { allBranches: false, branchIds: [otra.branch] })).toEqual({ ok: false, error: "foreign_object" });
    // Un valor que la base no acepta (la validación local lo habría frenado antes: acá se salta).
    expect(await guardar(local, { discountValue: 500 })).toEqual({ ok: false, error: "values_rejected" });
    expect(await guardar(local, { startMinute: 600, endMinute: 600 })).toEqual({ ok: false, error: "values_rejected" });
    expect(await cuentaPromos(local.id)).toBe(antes + 1);
  });

  it("editar una promoción que no existe, o de otra organización, es «no encontrada» y no toca nada", async () => {
    const local = await nuevoLocal();
    const otra = await nuevoLocal("pro", { miembros: false });
    const ajena = (await service.from("promotions").insert({ organization_id: otra.id, name: "Ajena", discount_type: "percent", discount_value: 10, weekdays_mask: 127, start_minute: 0, end_minute: 1440 }).select("id").single()).data!.id;
    expect(await guardar(local, {}, crypto.randomUUID())).toEqual({ ok: false, error: "not_found" });
    // La promoción es de otra organización: con el organization_id de la propia no se la encuentra.
    expect(await guardar(local, { name: "Robada" }, ajena)).toEqual({ ok: false, error: "not_found" });
    expect((await service.from("promotions").select("name").eq("id", ajena).single()).data?.name).toBe("Ajena");
  });
});

describe("quién puede guardar", () => {
  it("el Staff, otra organización y anon no; Básico no; solo lectura y suspendida tampoco", async () => {
    const local = await nuevoLocal();
    expect(await guardar(local, {}, null, staff)).toEqual({ ok: false, error: "forbidden" });
    expect((await guardar(local, {}, null, stranger)).ok).toBe(false);
    expect(await cuentaPromos(local.id)).toBe(0);

    // Llamada directa a la función: el Staff y anon no pasan la RLS / el permiso de ejecución.
    const directa = (db: Db) =>
      db.rpc("save_promotion", {
        p_org: local.id, p_id: null as unknown as string, p_name: "x", p_discount_type: "percent", p_discount_value: 10, p_weekdays_mask: 127,
        p_start_minute: 0, p_end_minute: 1440, p_starts_on: null as unknown as string, p_ends_on: null as unknown as string, p_all_branches: true,
        p_is_active: true, p_products: [local.products[0]], p_categories: [], p_branches: [],
      });
    expect((await directa(staff.db)).error?.code).toBe("42501");
    expect((await directa(anonClient())).error?.code).toBe("42501");
    expect(await cuentaPromos(local.id)).toBe(0);

    const basico = await nuevoLocal("basic");
    expect(await guardar(basico)).toEqual({ ok: false, error: "plan_missing" });
    // Aunque se salte el chequeo local, la base lo rechaza.
    const sinChequeo = await savePromotion(owner.db, basico.id, null, input(basico), { state: "active", canWrite: true, features: ["promotions"], limits: {}, usage: {} } as Entitlements);
    expect(sinChequeo.ok).toBe(false);
    expect(await cuentaPromos(basico.id)).toBe(0);

    for (const [finEnMs, error] of [[-10 * DIA_MS, "blocked_read_only"], [-20 * DIA_MS, "blocked_suspended"]] as const) {
      const l = await nuevoLocal();
      await setSubscription(service, l.id, { finEnMs });
      expect(await guardar(l)).toEqual({ ok: false, error });
      expect(await cuentaPromos(l.id)).toBe(0);
    }
  });
});

describe("pausar, duplicar y borrar", () => {
  it("pausar y reanudar con el estado deseado explícito; el Staff no", async () => {
    const local = await nuevoLocal();
    const id = await crear(local);
    const ent = await entOf(owner, local.id);
    expect(await setPromotionActive(owner.db, local.id, id, false, ent)).toEqual({ ok: true, data: undefined });
    expect((await service.from("promotions").select("is_active").eq("id", id).single()).data?.is_active).toBe(false);
    expect(await setPromotionActive(owner.db, local.id, id, true, ent)).toEqual({ ok: true, data: undefined });
    expect((await service.from("promotions").select("is_active").eq("id", id).single()).data?.is_active).toBe(true);

    expect(await setPromotionActive(staff.db, local.id, id, false, await entOf(staff, local.id))).toEqual({ ok: false, error: "forbidden" });
    expect(await setPromotionActive(owner.db, local.id, crypto.randomUUID(), false, ent)).toEqual({ ok: false, error: "not_found" });
    expect((await service.from("promotions").select("is_active").eq("id", id).single()).data?.is_active).toBe(true);
  });

  it("duplicar crea una copia pausada con los mismos platos, sucursales y horario, y un nombre que sigue entrando en 80", async () => {
    const local = await nuevoLocal();
    const largo = "x".repeat(PROMOTION_NAME_MAX);
    const id = await crear(local, { name: largo, productIds: [local.products[0]], categoryIds: [local.category], discountType: "amount", discountValue: 5000 });
    const r = await duplicatePromotion(owner.db, local.id, id, await entOf(owner, local.id));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const copia = (await service.from("promotions").select("*").eq("id", r.data.id).single()).data!;
    expect(copia).toMatchObject({ is_active: false, discount_type: "amount", discount_value: 5000, weekdays_mask: 31, start_minute: 1080, end_minute: 1200 });
    expect(copia.name.endsWith(" (copia)")).toBe(true);
    expect([...copia.name].length).toBeLessThanOrEqual(PROMOTION_NAME_MAX);
    expect(await objetivos(r.data.id)).toEqual(await objetivos(id));
    // La original no se tocó.
    expect((await service.from("promotions").select("is_active, name").eq("id", id).single()).data).toEqual({ is_active: true, name: largo });
    expect(await duplicatePromotion(owner.db, local.id, crypto.randomUUID(), await entOf(owner, local.id))).toEqual({ ok: false, error: "not_found" });
    expect((await duplicatePromotion(staff.db, local.id, id, await entOf(staff, local.id))).ok).toBe(false);
  });

  it("borrar quita la promoción y sus platos, deja la constancia, y el Staff no puede", async () => {
    const local = await nuevoLocal();
    const id = await crear(local);
    expect(await deletePromotion(staff.db, local.id, id, await entOf(staff, local.id))).toEqual({ ok: false, error: "forbidden" });
    expect(await cuentaPromos(local.id)).toBe(1);
    expect(await deletePromotion(owner.db, local.id, id, await entOf(owner, local.id))).toEqual({ ok: true, data: undefined });
    expect(await cuentaPromos(local.id)).toBe(0);
    expect(await objetivos(id)).toEqual([]);
    const eventos = ((await service.from("promotion_history").select("event").eq("promotion_id", id)).data ?? []).map((h) => h.event);
    expect(eventos).toContain("deleted");
    expect(await deletePromotion(owner.db, local.id, id, await entOf(owner, local.id))).toEqual({ ok: false, error: "not_found" });
  });

  it("con la cuenta en solo lectura no se pausa, no se duplica ni se borra", async () => {
    const local = await nuevoLocal();
    const id = await crear(local);
    await setSubscription(service, local.id, { finEnMs: -10 * DIA_MS });
    const ent = await entOf(owner, local.id);
    expect(await setPromotionActive(owner.db, local.id, id, false, ent)).toEqual({ ok: false, error: "blocked_read_only" });
    expect(await deletePromotion(owner.db, local.id, id, ent)).toEqual({ ok: false, error: "blocked_read_only" });
    expect((await duplicatePromotion(owner.db, local.id, id, ent)).ok).toBe(false);
    expect(await cuentaPromos(local.id)).toBe(1);
  });
});

describe("la pantalla: lectura, superposiciones y vista previa", () => {
  it("el Dueño y el Staff leen las promociones con sus listas; se avisan las superposiciones entre las activas", async () => {
    const local = await nuevoLocal();
    const a = await crear(local, { name: "Happy hour", productIds: [local.products[0]] });
    const b = await crear(local, { name: "Cerveza al paso", productIds: [], categoryIds: [local.category], startMinute: 1140, endMinute: 1260 }); // se pisan 19:00–20:00 en la cerveza
    const c = await crear(local, { name: "Almuerzo", productIds: [local.products[0]], startMinute: 720, endMinute: 900 }); // otra franja
    const pausada = await crear(local, { name: "Pausada", productIds: [local.products[0]], isActive: false });

    for (const quien of [owner, staff]) {
      const screen = await loadPromotionsScreen(quien.db, local.id);
      expect(screen.promotions.map((p) => p.name)).toEqual(["Almuerzo", "Cerveza al paso", "Happy hour", "Pausada"]);
      expect(screen.overlaps.get(a)).toEqual(["Cerveza al paso"]);
      expect(screen.overlaps.get(b)).toEqual(["Happy hour"]);
      expect(screen.overlaps.has(c)).toBe(false);
      expect(screen.overlaps.has(pausada)).toBe(false);
      expect(screen.catalog.products.map((p) => p.name)).toEqual(["Cerveza", "Gaseosa", "Vino"]);
      expect(screen.catalog.branches.map((br) => br.slug)).toEqual(["principal"]);
      expect(screen.catalog.branches[0].timeZone).toBe("America/Argentina/Buenos_Aires");
    }
    const lista = (await loadPromotions(owner.db, local.id)).find((p) => p.id === b)!;
    expect(lista).toMatchObject({ categoryIds: [local.category], productIds: [], allBranches: true, branchIds: [] });
    // Otra organización no ve nada.
    expect(await loadPromotions(stranger.db, local.id)).toEqual([]);
  });

  it("la vista previa por día y hora usa el mismo cálculo que la carta, en la hora de la sucursal", async () => {
    const local = await nuevoLocal();
    await crear(local, { name: "Happy hour", productIds: [local.products[0]] });
    const branch = (await loadCatalog(owner.db, local.id)).branches[0];
    const row = async (iso: string) => previewPrices(owner.db, local.id, branch.id, new Date(iso));
    // Viernes 2026-12-18 18:00 en Buenos Aires = 21:00 UTC.
    expect(await row("2026-12-18T21:00:00Z")).toEqual([
      expect.objectContaining({ productName: "Cerveza", basePriceCents: 1000, priceCents: 750, promotionName: "Happy hour", endsLocal: "2026-12-18T20:00:00" }),
    ]);
    expect(await row("2026-12-18T20:59:00Z")).toEqual([]);
    expect(await row("2026-12-19T22:00:00Z")).toEqual([]); // sábado
    // El Staff también puede ver la vista previa.
    expect((await previewPrices(staff.db, local.id, branch.id, new Date("2026-12-18T21:00:00Z"))).length).toBe(1);
  });
});

describe("la carta lee las promociones en vivo (loadBranchPromotions)", () => {
  it("devuelve la promoción de cada plato, con su fin en el reloj de la sucursal; anon la ve y un plato sin promoción no figura", async () => {
    const local = await nuevoLocal();
    await crear(local, { name: "Todo el día", weekdaysMask: 127, startMinute: 0, endMinute: 1440, productIds: [local.products[1]], discountType: "fixed_price", discountValue: 1500 });
    const map = await loadBranchPromotions(anonClient(), local.branch, "America/Argentina/Buenos_Aires");
    expect([...map.keys()]).toEqual([local.products[1]]);
    expect(map.get(local.products[1])).toMatchObject({ priceCents: 1500, name: "Todo el día", until: { time: "00:00", day: "tomorrow" } });

    const productos = [{ id: local.products[0], price_cents: 1000 }, { id: local.products[1], price_cents: 2000 }];
    const aplicado = applyPromotions(productos, map);
    expect(aplicado[0]).toEqual({ id: local.products[0], price_cents: 1000 });
    expect(aplicado[1]).toMatchObject({ id: local.products[1], price_cents: 2000, promotion: { priceCents: 1500 } });
  });

  it("sin promociones, o con la sucursal desactivada o la cuenta suspendida, no hay nada que mostrar; una pausada no figura", async () => {
    const local = await nuevoLocal();
    const id = await crear(local, { weekdaysMask: 127, startMinute: 0, endMinute: 1440 });
    const zona = "America/Argentina/Buenos_Aires";
    expect((await loadBranchPromotions(anonClient(), local.branch, zona)).size).toBe(1);
    await setPromotionActive(owner.db, local.id, id, false, await entOf(owner, local.id));
    expect((await loadBranchPromotions(anonClient(), local.branch, zona)).size).toBe(0);
    await setPromotionActive(owner.db, local.id, id, true, await entOf(owner, local.id));
    await setSubscription(service, local.id, { finEnMs: -20 * DIA_MS });
    expect((await loadBranchPromotions(anonClient(), local.branch, zona)).size).toBe(0);
  });
});

describe("el historial se lee con la RLS", () => {
  it("el Dueño y el Staff leen las constancias de su local, con nombres; otra organización, nada; pagina de a 50", async () => {
    const local = await nuevoLocal();
    const id = await crear(local, { name: "Con historia", productIds: [local.products[0]] });
    // 54 cambios más: en total 56 constancias (alta + plato + 54 cambios), más de una página.
    for (let i = 0; i < 54; i++) await service.from("promotions").update({ discount_value: 10 + (i % 2) }).eq("id", id).throwOnError();

    const primera = await loadPromotionHistory(owner.db, local.id, null);
    expect(primera?.entries).toHaveLength(PAGE_SIZE);
    expect(primera?.next).not.toBeNull();
    const segunda = await loadPromotionHistory(staff.db, local.id, parseCursor(primera!.next));
    expect(segunda?.entries.length).toBe(56 - PAGE_SIZE);
    expect(segunda?.next).toBeNull();
    const todas = [...primera!.entries, ...segunda!.entries];
    expect(new Set(todas.map((e) => e.id)).size).toBe(56); // sin repetidas ni salteadas
    expect(todas.at(-1)?.event).toBe("created");
    expect(todas[0].changedBy).toBeNull(); // los cambios del servicio técnico no tienen persona

    const nombres = await loadPromotionNames(owner.db, local.id, [id]);
    expect(nombres?.get(id)).toBe("Con historia");
    const lookups = await loadNameLookups(owner.db, local.id, todas);
    expect(lookups?.products.get(local.products[0])).toBe("Cerveza");
    const objetivo = todas.find((e) => e.event === "target_added")!;
    expect(describeEntry(objetivo, lookups!)).toBe("Plato: Cerveza");

    expect((await loadPromotionHistory(stranger.db, local.id, null))?.entries).toEqual([]);
    expect(await loadPromotionHistory(anonClient(), local.id, null)).toBeNull(); // anon no tiene acceso: error, no «sin cambios»
  });

  it("una promoción renombrada figura con su nombre actual en todas sus constancias", async () => {
    const local = await nuevoLocal();
    const id = await crear(local, { name: "Nombre viejo" });
    await guardar(local, { name: "Nombre nuevo" }, id);
    expect((await loadPromotionNames(owner.db, local.id, [id]))?.get(id)).toBe("Nombre nuevo");
    expect((await loadPromotionNames(staff.db, local.id, [id, crypto.randomUUID()]))?.get(id)).toBe("Nombre nuevo");
  });

  it("una promoción borrada conserva su nombre en el historial", async () => {
    const local = await nuevoLocal();
    const id = await crear(local, { name: "Efímera" });
    await deletePromotion(owner.db, local.id, id, await entOf(owner, local.id));
    expect((await loadPromotionNames(owner.db, local.id, [id]))?.get(id)).toBe("Efímera");
  });
});
