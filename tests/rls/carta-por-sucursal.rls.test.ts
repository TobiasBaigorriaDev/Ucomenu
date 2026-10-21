import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadBranchSettings,
  loadProductAvailability,
  loadSettingsSummary,
  setProductAvailability,
  setProductBranchPrice,
  setProductVisibility,
} from "@/lib/carta/availability";
import { createProduct } from "@/lib/carta/catalog";
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
  serviceClient,
  setSubscription,
  sql,
  type Db,
  type PlanCode,
  type TestUser,
} from "./helpers";

/**
 * Carta central con precio, disponibilidad y visibilidad por sucursal (nivel C; ficha carta-por-sucursal, ADR 0035) contra el
 * Supabase local. Un ajuste es una fila OPCIONAL de `product_availability`; sin fila el plato es visible, disponible y con el precio
 * base. Los ajustes de una sucursal no tocan a las demás; los límites del plan no cambian; las escrituras siguen los permisos y la
 * mora de siempre; cada cambio efectivo de precio queda en el historial con su sucursal.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let service: Db;
let owner: TestUser;
let staff: TestUser;
let ajeno: TestUser;
const orgs: string[] = [];
let contador = 0;

type Local = { id: string; category: string; product: string; centro: string; norte: string };

/** Un local con dos sucursales (Centro y Norte) y un plato de $ 20,00 en la categoría única. */
async function nuevoLocal(plan: PlanCode = "pro", estado: "active" | "grace" | "read_only" | "suspended" = "active"): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-cps-${sufijo}-${contador}`, plan);
  orgs.push(id);
  const finEnMs = { active: 5 * DIA_MS, grace: -3 * DIA_MS, read_only: -10 * DIA_MS, suspended: -20 * DIA_MS }[estado];
  await setSubscription(service, id, { finEnMs });
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  const ramas = await service
    .from("branches")
    .insert([
      { organization_id: id, slug: "centro", name: "Centro", is_active: true },
      { organization_id: id, slug: "norte", name: "Norte", is_active: true },
    ])
    .select("id, slug");
  if (ramas.error) throw new Error(ramas.error.message);
  const category = await createCategory(service, id);
  const plato = await service.from("products").insert({ organization_id: id, category_id: category, name: "Milanesa", price_cents: 2000 }).select("id").single();
  if (plato.error) throw new Error(plato.error.message);
  return {
    id,
    category,
    product: plato.data.id,
    centro: ramas.data.find((r) => r.slug === "centro")!.id,
    norte: ramas.data.find((r) => r.slug === "norte")!.id,
  };
}

const fila = async (l: Local, branch: string, product = l.product) =>
  (await service.from("product_availability").select("is_available, is_visible, price_cents").eq("branch_id", branch).eq("product_id", product).maybeSingle()).data;
const historial = async (l: Local, product = l.product) =>
  (
    await service
      .from("price_history")
      .select("branch_id, old_price_cents, new_price_cents, changed_by")
      .eq("organization_id", l.id)
      .eq("product_id", product)
      .order("changed_at")
  ).data ?? [];
/** Platos activos de la organización: lo que cuenta el límite del plan. */
const activos = async (l: Local) =>
  (await service.from("products").select("id", { count: "exact", head: true }).eq("organization_id", l.id).eq("is_active", true)).count;

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, ajeno] = await Promise.all([createUser(service, "cps-owner"), createUser(service, "cps-staff"), createUser(service, "cps-ajeno")]);
});

afterAll(async () => {
  for (const id of orgs) {
    await deleteOrg(service, id);
  }
  await Promise.all([owner, staff, ajeno].map((u) => deleteUser(service, u)));
});

describe("ajustes por sucursal: valores por defecto y aislamiento", () => {
  it("sin fila el plato es visible, disponible y con el precio base en todas las sucursales", async () => {
    const l = await nuevoLocal();
    expect(await fila(l, l.centro)).toBeNull();
    const ramas = await loadProductAvailability(owner.db, l.id, l.product);
    expect(ramas.map((r) => [r.name, r.is_visible, r.is_available, r.price_cents])).toEqual([["Centro", true, true, null], ["Norte", true, true, null]]);
    expect(await loadBranchSettings(anonClient(), l.id, l.centro)).toEqual(new Map());
  });

  it("precio, visibilidad y agotado de una sucursal no tocan a la otra; cada uno escribe solo su columna", async () => {
    const l = await nuevoLocal();

    expect(await setProductBranchPrice(owner.db, l.id, l.product, l.centro, 2500)).toMatchObject({ ok: true });
    expect(await fila(l, l.centro)).toEqual({ is_available: true, is_visible: true, price_cents: 2500 });
    expect(await setProductVisibility(staff.db, l.id, l.product, l.centro, false)).toMatchObject({ ok: true });
    expect(await fila(l, l.centro)).toEqual({ is_available: true, is_visible: false, price_cents: 2500 });
    expect(await setProductAvailability(owner.db, l.id, l.product, l.centro, false)).toMatchObject({ ok: true });
    expect(await fila(l, l.centro)).toEqual({ is_available: false, is_visible: false, price_cents: 2500 });

    expect(await fila(l, l.norte)).toBeNull(); // la otra sucursal ni existe como ajuste
    expect((await service.from("products").select("price_cents, is_active").eq("id", l.product).single()).data).toEqual({ price_cents: 2000, is_active: true });
    expect(await loadBranchSettings(anonClient(), l.id, l.norte)).toEqual(new Map());
    expect(await loadBranchSettings(anonClient(), l.id, l.centro)).toEqual(
      new Map([[l.product, { isAvailable: false, isVisible: false, priceCents: 2500 }]]),
    );
  });

  it("un precio propio de cero es un precio; «usar precio general» (null) lo quita", async () => {
    const l = await nuevoLocal();
    expect(await setProductBranchPrice(owner.db, l.id, l.product, l.norte, 0)).toMatchObject({ ok: true });
    expect((await fila(l, l.norte))?.price_cents).toBe(0);
    expect((await loadBranchSettings(anonClient(), l.id, l.norte)).get(l.product)?.priceCents).toBe(0);

    expect(await setProductBranchPrice(owner.db, l.id, l.product, l.norte, null)).toMatchObject({ ok: true });
    expect((await fila(l, l.norte))?.price_cents).toBeNull();
    expect((await loadBranchSettings(anonClient(), l.id, l.norte)).size).toBe(0);
  });

  it("cambiar el precio base solo afecta a las sucursales que heredan", async () => {
    const l = await nuevoLocal();
    await setProductBranchPrice(owner.db, l.id, l.product, l.centro, 3000);

    await owner.db.from("products").update({ price_cents: 2200 }).eq("id", l.product);

    expect((await loadBranchSettings(anonClient(), l.id, l.centro)).get(l.product)?.priceCents).toBe(3000); // propio: no cambia
    expect((await loadBranchSettings(anonClient(), l.id, l.norte)).get(l.product)).toBeUndefined(); // hereda: el catálogo trae 2200
    expect((await service.from("products").select("price_cents").eq("id", l.product).single()).data?.price_cents).toBe(2200);
  });

  it("un ajuste de otra sucursal u organización se rechaza: las claves son inmutables y la sucursal tiene que ser del local", async () => {
    const l = await nuevoLocal();
    const otro = await nuevoLocal();
    await setProductBranchPrice(owner.db, l.id, l.product, l.centro, 2500);

    // Sucursal de OTRO local: la clave foránea compuesta (sucursal, organización) la rechaza.
    const cruzada = await service.from("product_availability").insert({ organization_id: l.id, branch_id: otro.centro, product_id: l.product, price_cents: 1 });
    expect(cruzada.error?.code).toBe("23503");
    // Las claves no se actualizan por la API.
    const mover = await owner.db.from("product_availability").update({ branch_id: l.norte }).eq("branch_id", l.centro).eq("product_id", l.product);
    expect(mover.error?.code).toBe("42501");
    // Precio negativo.
    const negativo = await owner.db.from("product_availability").update({ price_cents: -1 }).eq("branch_id", l.centro).eq("product_id", l.product);
    expect(negativo.error?.code).toBe("23514");
    expect((await fila(l, l.centro))?.price_cents).toBe(2500);
  });

  it("quien no es miembro, el anónimo y otro local no escriben ni leen ajustes ajenos por la API de escritura", async () => {
    const l = await nuevoLocal();
    const otro = await nuevoLocal();
    await setProductBranchPrice(owner.db, l.id, l.product, l.centro, 2500);

    for (const [nombre, db] of [["anon", anonClient()], ["ajeno", ajeno.db]] as const) {
      const r = await setProductBranchPrice(db, l.id, l.product, l.centro, 1);
      expect(r.ok, nombre).toBe(false);
      expect((await db.from("product_availability").insert({ organization_id: l.id, branch_id: l.norte, product_id: l.product, price_cents: 1 })).error, nombre).not.toBeNull();
    }
    // Un Dueño de otro local tampoco.
    const dueno2 = await createUser(service, "cps-otro");
    await addMembership(service, dueno2, otro.id, "owner");
    expect((await setProductVisibility(dueno2.db, l.id, l.product, l.norte, false)).ok).toBe(false);
    await deleteUser(service, dueno2);

    expect(await fila(l, l.centro)).toMatchObject({ price_cents: 2500 });
    expect(await fila(l, l.norte)).toBeNull();
  });

  it("los ajustes se conservan al desactivar la sucursal; un plato inactivo o borrado no publica ni deja ajustes", async () => {
    const l = await nuevoLocal();
    await setProductBranchPrice(owner.db, l.id, l.product, l.centro, 2500);
    await setProductVisibility(owner.db, l.id, l.product, l.norte, false);

    await service.from("branches").update({ is_active: false }).eq("id", l.centro);
    expect(await fila(l, l.centro)).toMatchObject({ price_cents: 2500 });
    await service.from("branches").update({ is_active: true }).eq("id", l.centro);
    expect((await loadBranchSettings(anonClient(), l.id, l.centro)).get(l.product)?.priceCents).toBe(2500);

    // Producto inactivo: la lectura pública no devuelve sus ajustes (la política exige que el plato esté publicado).
    await service.from("products").update({ is_active: false }).eq("id", l.product);
    expect((await loadBranchSettings(anonClient(), l.id, l.centro)).size).toBe(0);
    expect(await fila(l, l.centro)).toMatchObject({ price_cents: 2500 }); // pero la configuración sigue ahí para cuando se reactive
    await service.from("products").update({ is_active: true }).eq("id", l.product);
    expect((await loadBranchSettings(anonClient(), l.id, l.centro)).size).toBe(1);

    // Borrar el plato borra sus ajustes.
    await service.from("products").delete().eq("id", l.product);
    expect(await fila(l, l.centro)).toBeNull();
  });

  it("el resumen del listado cuenta lo que tiene cada plato en las sucursales ACTIVAS", async () => {
    const l = await nuevoLocal();
    await setProductBranchPrice(owner.db, l.id, l.product, l.centro, 2500);
    await setProductVisibility(owner.db, l.id, l.product, l.norte, false);
    await setProductAvailability(owner.db, l.id, l.product, l.norte, false);

    expect((await loadSettingsSummary(owner.db, l.id)).get(l.product)).toEqual({ hidden: 1, priced: 1, soldOut: 1 });
    await service.from("branches").update({ is_active: false }).eq("id", l.norte);
    expect((await loadSettingsSummary(owner.db, l.id)).get(l.product)).toEqual({ hidden: 0, priced: 1, soldOut: 0 });
  });
});

describe("límites del plan y mora", () => {
  it("ocultar, cambiar el precio o agotar no consume ni libera cupo; un plato activo oculto en todas sigue contando", async () => {
    const l = await nuevoLocal();
    expect(await activos(l)).toBe(1);

    await setProductBranchPrice(owner.db, l.id, l.product, l.centro, 100);
    await setProductAvailability(owner.db, l.id, l.product, l.norte, false);
    await setProductVisibility(owner.db, l.id, l.product, l.centro, false);
    await setProductVisibility(owner.db, l.id, l.product, l.norte, false);

    expect(await activos(l)).toBe(1);
  });

  it("al llegar al tope del plan, crear un plato con sucursales falla entero: ni plato ni ocultamientos", async () => {
    const l = await nuevoLocal("pro"); // tope: 200 platos activos
    expect((await insertProducts(service, l.id, l.category, 199)).error).toBeNull(); // 1 + 199 = 200
    expect(await activos(l)).toBe(200);

    const r = await createProduct(owner.db, l.id, { categoryId: l.category, name: "Plato 201", description: "", price: "10", active: true, hiddenBranches: [l.norte] });

    expect(r).toEqual({ ok: false, error: "limit" });
    expect((await service.from("products").select("id").eq("organization_id", l.id).eq("name", "Plato 201")).data).toEqual([]);
    expect((await service.from("product_availability").select("product_id").eq("organization_id", l.id)).data).toEqual([]);
    expect(await activos(l)).toBe(200);
  });

  it.each(["read_only", "suspended"] as const)("con la cuenta %s no se escribe nada (ni ajustes ni alta con sucursales)", async (estado) => {
    const l = await nuevoLocal("pro", estado);

    for (const [nombre, escribir] of [
      ["precio", () => setProductBranchPrice(owner.db, l.id, l.product, l.centro, 1)],
      ["visibilidad", () => setProductVisibility(owner.db, l.id, l.product, l.centro, false)],
      ["agotado", () => setProductAvailability(staff.db, l.id, l.product, l.centro, false)],
    ] as const) {
      const r = await escribir();
      expect(r.ok, nombre).toBe(false);
    }
    expect(await fila(l, l.centro)).toBeNull();

    // Forzando la API (sin la comprobación previa del módulo): la base lo rechaza.
    const forzado = await owner.db.from("product_availability").insert({ organization_id: l.id, branch_id: l.centro, product_id: l.product, price_cents: 1 });
    expect(forzado.error?.code).toBe("42501");
    const rpc = await createProduct(owner.db, l.id, { categoryId: l.category, name: "Nuevo", description: "", price: "10", active: true, hiddenBranches: [l.norte] });
    expect(rpc.ok).toBe(false);
    expect((await service.from("products").select("id").eq("organization_id", l.id)).data).toHaveLength(1);
  });

  it("en gracia se edita con normalidad", async () => {
    const l = await nuevoLocal("pro", "grace");
    expect(await setProductBranchPrice(owner.db, l.id, l.product, l.centro, 2500)).toMatchObject({ ok: true });
  });
});

describe("alta de un plato decidiendo en qué sucursales se muestra", () => {
  it("crea el plato y lo oculta solo en las sucursales pedidas; el resto sigue sin ajustes", async () => {
    const l = await nuevoLocal();

    const r = await createProduct(staff.db, l.id, { categoryId: l.category, name: "Flan", description: "Casero", price: "1.500", active: true, hiddenBranches: [l.norte, l.norte] });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await service.from("products").select("name, price_cents, is_active").eq("id", r.data.id).single()).data).toEqual({ name: "Flan", price_cents: 150000, is_active: true });
    expect(await fila(l, l.norte, r.data.id)).toEqual({ is_available: true, is_visible: false, price_cents: null });
    expect(await fila(l, l.centro, r.data.id)).toBeNull();
    expect(await activos(l)).toBe(2); // cuenta una sola vez
    expect(await historial(l, r.data.id)).toEqual([]); // sin precio propio, sin historial
  });

  it("una sucursal de otro local o una persona sin permiso no crea nada", async () => {
    const l = await nuevoLocal();
    const otro = await nuevoLocal();

    const cruzada = await createProduct(owner.db, l.id, { categoryId: l.category, name: "Cruzado", description: "", price: "10", active: true, hiddenBranches: [otro.centro] });
    expect(cruzada.ok).toBe(false);
    const sinPermiso = await createProduct(ajeno.db, l.id, { categoryId: l.category, name: "Ajeno", description: "", price: "10", active: true, hiddenBranches: [l.norte] });
    expect(sinPermiso.ok).toBe(false);
    expect((await service.from("products").select("name").eq("organization_id", l.id)).data).toEqual([{ name: "Milanesa" }]);
    expect((await service.from("product_availability").select("product_id").eq("organization_id", l.id)).data).toEqual([]);

    // La RPC no se puede llamar sin sesión.
    const anon = await anonClient().rpc("create_product_in_branches", {
      p_org: l.id, p_category: l.category, p_name: "x", p_description: "", p_price_cents: 1, p_sort_order: 0, p_is_active: true, p_dietary_tags: [], p_hidden_branches: [],
    });
    expect(anon.error?.code).toBe("42501");
  });

  it("sin sucursales ocultas es el alta de siempre", async () => {
    const l = await nuevoLocal();
    const r = await createProduct(owner.db, l.id, { categoryId: l.category, name: "Sopa", description: "", price: "900", active: true });
    expect(r.ok).toBe(true);
    expect((await service.from("product_availability").select("product_id").eq("organization_id", l.id)).data).toEqual([]);
  });
});

describe("historial de precios por sucursal", () => {
  it("registra cada cambio EFECTIVO del precio de una sucursal con su sucursal y quién lo hizo", async () => {
    const l = await nuevoLocal();

    await setProductBranchPrice(owner.db, l.id, l.product, l.centro, 2500); // 20,00 -> 25,00
    await setProductBranchPrice(staff.db, l.id, l.product, l.centro, 3000); // 25,00 -> 30,00
    await setProductBranchPrice(owner.db, l.id, l.product, l.centro, null); // 30,00 -> 20,00 (vuelve al general)

    expect(await historial(l)).toEqual([
      { branch_id: l.centro, old_price_cents: 2000, new_price_cents: 2500, changed_by: owner.id },
      { branch_id: l.centro, old_price_cents: 2500, new_price_cents: 3000, changed_by: staff.id },
      { branch_id: l.centro, old_price_cents: 3000, new_price_cents: 2000, changed_by: owner.id },
    ]);
  });

  it("no registra lo que no cambia el precio efectivo: igual al base, repetir el mismo precio, quitar un precio igual al base", async () => {
    const l = await nuevoLocal();

    await setProductBranchPrice(owner.db, l.id, l.product, l.norte, 2000); // igual al base
    await setProductBranchPrice(owner.db, l.id, l.product, l.norte, 2000); // repetido
    await setProductBranchPrice(owner.db, l.id, l.product, l.norte, null); // quitar uno igual al base
    await setProductVisibility(owner.db, l.id, l.product, l.norte, false); // ocultar no es un precio
    await setProductAvailability(owner.db, l.id, l.product, l.norte, false);

    expect(await historial(l)).toEqual([]);
  });

  it("el precio de partida de una sucursal sin precio propio es el base vigente; cambiar el base es una sola fila general", async () => {
    const l = await nuevoLocal();
    await owner.db.from("products").update({ price_cents: 2200 }).eq("id", l.product);
    await setProductBranchPrice(owner.db, l.id, l.product, l.centro, 2400);
    await owner.db.from("products").update({ price_cents: 2300 }).eq("id", l.product);

    expect(await historial(l)).toEqual([
      { branch_id: null, old_price_cents: 2000, new_price_cents: 2200, changed_by: owner.id },
      { branch_id: l.centro, old_price_cents: 2200, new_price_cents: 2400, changed_by: owner.id },
      { branch_id: null, old_price_cents: 2200, new_price_cents: 2300, changed_by: owner.id },
    ]);
  });

  it("un precio propio de cero se registra como cambio de precio; el historial sigue siendo solo de lectura para los miembros", async () => {
    const l = await nuevoLocal();
    await setProductBranchPrice(owner.db, l.id, l.product, l.centro, 0);
    expect(await historial(l)).toEqual([{ branch_id: l.centro, old_price_cents: 2000, new_price_cents: 0, changed_by: owner.id }]);

    for (const db of [owner.db, staff.db]) expect((await db.from("price_history").select("branch_id").eq("organization_id", l.id)).data).toHaveLength(1);
    expect((await ajeno.db.from("price_history").select("branch_id").eq("organization_id", l.id)).data).toEqual([]);
    expect((await owner.db.from("price_history").update({ branch_id: null }).eq("organization_id", l.id)).error?.code).toBe("42501");
    expect((await owner.db.from("price_history").delete().eq("organization_id", l.id)).error?.code).toBe("42501");
    // El trigger que lo escribe no se puede llamar por la API.
    expect(sql(`select count(*) from information_schema.routine_privileges where routine_name = 'record_branch_price_change' and grantee in ('anon', 'authenticated')`)[0][0]).toBe("0");
  });

  it("un id de plato al azar no deja historial ni ajustes", async () => {
    const l = await nuevoLocal();
    const r = await setProductBranchPrice(owner.db, l.id, randomUUID(), l.centro, 100);
    expect(r).toEqual({ ok: false, error: "not_found" });
    expect(await historial(l, l.product)).toEqual([]);
  });
});
