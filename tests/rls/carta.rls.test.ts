import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createCategory as seedCategory,
  addMembership,
  createOrg,
  createUser,
  DIA_MS,
  deleteOrg,
  deleteUser,
  insertProducts,
  serviceClient,
  setSubscription,
  type Db,
  type TestUser,
} from "./helpers";
import {
  createCategory,
  createProduct,
  loadCarta,
  loadProduct,
  moveCategory,
  moveProduct,
  removeProductImage,
  renameCategory,
  setCategoryActive,
  setProductActive,
  setProductImage,
  updateProduct,
} from "@/lib/carta/catalog";
import { IMAGE_BUCKET } from "@/lib/carta/images";

/**
 * Módulo de gestión de la carta contra el Supabase local (ficha gestion-de-carta): escrituras con el cliente
 * de la persona, tope de platos activos, cuenta bloqueada sin falsos éxitos, aislamiento entre organizaciones y fotos.
 */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);
const png = (name = "foto.png") => new File([PNG], name, { type: "image/png" });

let service: Db;
let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
const orgs: string[] = [];
const objects: string[] = [];

async function nuevaOrg(slug: string, plan: "basic" | "pro" = "basic") {
  const id = await createOrg(service, slug, plan);
  orgs.push(id);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return id;
}

async function filas(table: "categories" | "products", orgId: string) {
  // El cast solo ayuda al tipado: las dos tablas tienen organization_id y created_at.
  const { data } = await service.from(table as "products").select("*").eq("organization_id", orgId).order("created_at");
  return data ?? [];
}

async function existeObjeto(path: string): Promise<boolean> {
  const [org, product, file] = path.split("/");
  const { data } = await service.storage.from(IMAGE_BUCKET).list(`${org}/${product}`);
  return (data ?? []).some((f) => f.name === file);
}

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([
    createUser(service, "carta-owner"),
    createUser(service, "carta-staff"),
    createUser(service, "carta-ajeno"),
  ]);
});

afterAll(async () => {
  if (objects.length > 0) await service.storage.from(IMAGE_BUCKET).remove(objects);
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, stranger].map((u) => deleteUser(service, u)));
});

describe("categorías", () => {
  it("se crean al final, se renombran, se activan y se reordenan (Dueño y Staff)", async () => {
    const org = await nuevaOrg("tt-carta-cat");
    const a = await createCategory(owner.db, org, { name: "  Entradas " });
    const b = await createCategory(staff.db, org, { name: "Postres" });
    const c = await createCategory(owner.db, org, { name: "Bebidas" });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;

    expect((await loadCarta(owner.db, org)).map((x) => [x.name, x.sort_order])).toEqual([
      ["Entradas", 0],
      ["Postres", 1],
      ["Bebidas", 2],
    ]);

    expect((await moveCategory(staff.db, org, c.data.id, "up")).ok).toBe(true);
    expect((await loadCarta(owner.db, org)).map((x) => x.name)).toEqual(["Entradas", "Bebidas", "Postres"]);

    // En el borde no hace nada y no falla.
    expect((await moveCategory(owner.db, org, a.data.id, "up")).ok).toBe(true);
    expect((await loadCarta(owner.db, org)).map((x) => x.name)).toEqual(["Entradas", "Bebidas", "Postres"]);

    expect((await renameCategory(staff.db, org, b.data.id, { name: "Dulces" })).ok).toBe(true);
    expect((await setCategoryActive(owner.db, org, b.data.id, false)).ok).toBe(true);
    const carta = await loadCarta(owner.db, org);
    expect(carta.find((x) => x.id === b.data.id)).toMatchObject({ name: "Dulces", is_active: false });
  });

  it("renumera aunque haya órdenes repetidos", async () => {
    const org = await nuevaOrg("tt-carta-cat-rep");
    await service.from("categories").insert([
      { organization_id: org, name: "Zeta", sort_order: 0 },
      { organization_id: org, name: "Alfa", sort_order: 0 },
      { organization_id: org, name: "Mora", sort_order: 0 },
    ]);
    const carta = await loadCarta(owner.db, org);
    expect(carta.map((x) => x.name)).toEqual(["Alfa", "Mora", "Zeta"]);
    const zeta = carta.find((x) => x.name === "Zeta")!;
    expect((await moveCategory(owner.db, org, zeta.id, "up")).ok).toBe(true);
    expect((await loadCarta(owner.db, org)).map((x) => [x.name, x.sort_order])).toEqual([
      ["Alfa", 0],
      ["Zeta", 1],
      ["Mora", 2],
    ]);
  });

  it("valida el nombre y no guarda nada si es inválido", async () => {
    const org = await nuevaOrg("tt-carta-cat-val");
    expect(await createCategory(owner.db, org, { name: "   " })).toEqual({ ok: false, error: "name_blank" });
    expect(await createCategory(owner.db, org, { name: "x".repeat(81) })).toEqual({ ok: false, error: "name_too_long" });
    expect(await filas("categories", org)).toHaveLength(0);
  });
});

describe("platos", () => {
  let org: string;
  let cat1: string;
  let cat2: string;

  beforeAll(async () => {
    org = await nuevaOrg("tt-carta-plato");
    const [a, b] = await Promise.all([createCategory(owner.db, org, { name: "Principales" }), createCategory(owner.db, org, { name: "Postres" })]);
    if (!a.ok || !b.ok) throw new Error("no se pudieron crear las categorías");
    cat1 = a.data.id;
    cat2 = b.data.id;
  });

  it("crea un plato activo al final con el precio en centavos y la descripción vacía como null", async () => {
    const r1 = await createProduct(owner.db, org, { categoryId: cat1, name: " Milanesa ", description: "", price: "2.800,50", active: true });
    const r2 = await createProduct(staff.db, org, { categoryId: cat1, name: "Ravioles", description: "Con salsa", price: "3200", active: true });
    expect(r1.ok && r2.ok).toBe(true);

    const carta = await loadCarta(owner.db, org);
    const productos = carta.find((c) => c.id === cat1)!.products;
    expect(productos.map((p) => [p.name, p.description, p.price_cents, p.sort_order, p.is_active])).toEqual([
      ["Milanesa", null, 280050, 0, true],
      ["Ravioles", "Con salsa", 320000, 1, true],
    ]);
  });

  it("rechaza datos inválidos sin guardar nada", async () => {
    const before = (await filas("products", org)).length;
    const base = { categoryId: cat1, name: "Prueba", description: "", price: "100", active: true };
    expect(await createProduct(owner.db, org, { ...base, name: "" })).toEqual({ ok: false, error: "name_blank" });
    expect(await createProduct(owner.db, org, { ...base, description: "d".repeat(301) })).toEqual({ ok: false, error: "description_too_long" });
    expect(await createProduct(owner.db, org, { ...base, price: "" })).toEqual({ ok: false, error: "price_blank" });
    expect(await createProduct(owner.db, org, { ...base, price: "-5" })).toEqual({ ok: false, error: "price_invalid" });
    expect(await createProduct(owner.db, org, { ...base, price: "1,234" })).toEqual({ ok: false, error: "price_decimals" });
    expect(await createProduct(owner.db, org, { ...base, price: "99999999" })).toEqual({ ok: false, error: "price_big" });
    expect(await createProduct(owner.db, org, { ...base, categoryId: "00000000-0000-4000-8000-000000000000" })).toEqual({
      ok: false,
      error: "category_invalid",
    });
    expect(await filas("products", org)).toHaveLength(before);
  });

  it("edita, mueve de categoría (al final de la nueva), activa/desactiva y reordena", async () => {
    const created = await createProduct(owner.db, org, { categoryId: cat2, name: "Flan", description: "", price: "1500", active: true });
    if (!created.ok) throw new Error("no se creó el flan");
    const id = created.data.id;

    expect((await updateProduct(staff.db, org, id, { categoryId: cat1, name: "Flan casero", description: "Con dulce de leche", price: "1.800,5" })).ok).toBe(true);
    const carta = await loadCarta(owner.db, org);
    const principales = carta.find((c) => c.id === cat1)!.products;
    expect(principales.map((p) => p.name)).toEqual(["Milanesa", "Ravioles", "Flan casero"]);
    expect(principales[2]).toMatchObject({ price_cents: 180050, sort_order: 2, description: "Con dulce de leche" });
    expect(carta.find((c) => c.id === cat2)!.products).toHaveLength(0);

    expect((await moveProduct(owner.db, org, id, "up")).ok).toBe(true);
    expect((await loadCarta(owner.db, org)).find((c) => c.id === cat1)!.products.map((p) => p.name)).toEqual([
      "Milanesa",
      "Flan casero",
      "Ravioles",
    ]);

    expect((await setProductActive(staff.db, org, id, false)).ok).toBe(true);
    expect((await loadProductActivo(id))).toBe(false);
    expect((await setProductActive(owner.db, org, id, true)).ok).toBe(true);
    expect((await loadProductActivo(id))).toBe(true);
  });

  const loadProductActivo = async (id: string) => (await service.from("products").select("is_active").eq("id", id).single()).data?.is_active;

  it("un id o una categoría de otra organización no se toca", async () => {
    // Una organización de la que ni el Dueño ni el Staff son miembros.
    const otraOrg = await createOrg(service, "tt-carta-plato-otra", "basic");
    orgs.push(otraOrg);
    const otraCat = await seedCategory(service, otraOrg, "Ajena");
    const otro = await service
      .from("products")
      .insert({ organization_id: otraOrg, category_id: otraCat, name: "Ajeno", price_cents: 100 })
      .select("id")
      .single();
    const ajeno = otro.data!.id;

    // Mi organización + un plato ajeno: no existe para mí.
    expect(await updateProduct(owner.db, org, ajeno, { categoryId: cat1, name: "Robado", description: "", price: "1" })).toEqual({ ok: false, error: "not_found" });
    expect(await setProductActive(owner.db, org, ajeno, false)).toEqual({ ok: false, error: "not_found" });
    expect(await moveProduct(owner.db, org, ajeno, "up")).toEqual({ ok: false, error: "not_found" });
    expect(await setProductImage(owner.db, org, ajeno, png())).toEqual({ ok: false, error: "not_found" });

    // Mi plato + una categoría ajena.
    const mio = (await loadCarta(owner.db, org)).find((c) => c.id === cat1)!.products[0];
    expect(await updateProduct(owner.db, org, mio.id, { categoryId: otraCat, name: "X", description: "", price: "1" })).toEqual({
      ok: false,
      error: "category_invalid",
    });
    expect(await createProduct(owner.db, org, { categoryId: otraCat, name: "X", description: "", price: "1", active: true })).toEqual({
      ok: false,
      error: "category_invalid",
    });

    // Usar la organización ajena como propia (id manipulado): la base no deja y el plato ajeno queda igual.
    const manipulado = await updateProduct(owner.db, otraOrg, ajeno, { categoryId: otraCat, name: "Robado", description: "", price: "1" });
    expect(manipulado.ok).toBe(false);
    expect((await service.from("products").select("name").eq("id", ajeno).single()).data?.name).toBe("Ajeno");

    // Un usuario sin membresía no escribe en ninguna.
    const ajenoUser = await createProduct(stranger.db, org, { categoryId: cat1, name: "Intruso", description: "", price: "1", active: true });
    expect(ajenoUser.ok).toBe(false);
    expect((await filas("products", org)).some((p) => p.name === "Intruso")).toBe(false);
  });
});

describe("una persona con dos locales", () => {
  it("lo que se pide para un local nunca toca los datos del otro, aunque sea miembro de los dos", async () => {
    // `owner` y `staff` son miembros de ambos locales: acá la base NO frena por sí sola, la acota la consulta.
    const a = await nuevaOrg("tt-carta-doble-a");
    const x = await nuevaOrg("tt-carta-doble-x");
    const catA = await seedCategory(service, a, "De A");
    const catX = await seedCategory(service, x, "De X");
    const prodA = await service.from("products").insert({ organization_id: a, category_id: catA, name: "Plato de A", price_cents: 100 }).select("id").single();
    const prodX = await service.from("products").insert({ organization_id: x, category_id: catX, name: "Plato de X", price_cents: 100 }).select("id").single();
    const idA = prodA.data!.id;
    const idX = prodX.data!.id;
    const antes = JSON.stringify([await filas("categories", x), await filas("products", x)]);

    // Lectura: la carta de A no trae nada de X.
    expect((await loadCarta(owner.db, a)).map((c) => c.name)).toEqual(["De A"]);
    expect(await loadProduct(owner.db, a, idX)).toBeNull();

    // Escritura: con el slug de A, los ids de X no existen.
    const nuevo = { categoryId: catA, name: "Robado", description: "", price: "1" };
    expect(await updateProduct(owner.db, a, idX, nuevo)).toEqual({ ok: false, error: "not_found" });
    expect(await setProductActive(owner.db, a, idX, false)).toEqual({ ok: false, error: "not_found" });
    expect(await moveProduct(owner.db, a, idX, "up")).toEqual({ ok: false, error: "not_found" });
    expect(await setProductImage(owner.db, a, idX, png())).toEqual({ ok: false, error: "not_found" });
    expect(await removeProductImage(owner.db, a, idX)).toEqual({ ok: false, error: "not_found" });
    expect(await renameCategory(owner.db, a, catX, { name: "Robada" })).toEqual({ ok: false, error: "not_found" });
    expect(await setCategoryActive(owner.db, a, catX, false)).toEqual({ ok: false, error: "not_found" });
    expect(await moveCategory(owner.db, a, catX, "down")).toEqual({ ok: false, error: "not_found" });

    // Una categoría de X no sirve para un plato de A (ni al crear ni al mover).
    expect(await createProduct(owner.db, a, { ...nuevo, categoryId: catX, active: true })).toEqual({ ok: false, error: "category_invalid" });
    expect(await updateProduct(owner.db, a, idA, { ...nuevo, categoryId: catX })).toEqual({ ok: false, error: "category_invalid" });

    expect(JSON.stringify([await filas("categories", x), await filas("products", x)])).toBe(antes);
    const propio = await service.from("products").select("name, category_id").eq("id", idA).single();
    expect(propio.data).toEqual({ name: "Plato de A", category_id: catA });
  });
});

describe("tope de platos activos (53400)", () => {
  it("bloquea crear activo y activar al llegar al tope; desactivar y editar siguen; el inactivo no cuenta", async () => {
    const org = await nuevaOrg("tt-carta-tope");
    const catId = await seedCategory(service, org, "Todo");
    expect((await insertProducts(service, org, catId, 80)).error).toBeNull();
    const inactivo = await service
      .from("products")
      .insert({ organization_id: org, category_id: catId, name: "tt-inactivo", price_cents: 1, is_active: false })
      .select("id")
      .single();

    const nuevo = { categoryId: catId, name: "Plato 81", description: "", price: "100" };
    expect(await createProduct(owner.db, org, { ...nuevo, active: true })).toEqual({ ok: false, error: "limit" });
    expect(await setProductActive(staff.db, org, inactivo.data!.id, true)).toEqual({ ok: false, error: "limit" });
    expect((await filas("products", org)).filter((p) => p.is_active)).toHaveLength(80);

    // Crear inactivo sí; editar uno activo no consume cupo; desactivar siempre se puede.
    expect((await createProduct(owner.db, org, { ...nuevo, name: "Plato 81 inactivo", active: false })).ok).toBe(true);
    const activo = (await loadCarta(owner.db, org))[0].products.find((p) => p.is_active)!;
    expect((await updateProduct(owner.db, org, activo.id, { categoryId: catId, name: "Editado", description: "", price: "250" })).ok).toBe(true);
    expect((await setProductActive(owner.db, org, activo.id, false)).ok).toBe(true);

    // Con el cupo liberado, ahora sí.
    expect((await setProductActive(owner.db, org, inactivo.data!.id, true)).ok).toBe(true);
  });
});

describe("cuenta que no puede escribir", () => {
  type Bloqueo = "blocked_read_only" | "blocked_suspended";
  const casos: [string, number, Bloqueo][] = [
    ["solo lectura", 10, "blocked_read_only"],
    ["suspendida", 20, "blocked_suspended"],
  ];

  async function conCarta(slug: string) {
    const org = await nuevaOrg(slug);
    const cat = await createCategory(owner.db, org, { name: "Carta" });
    if (!cat.ok) throw new Error("categoría");
    const plato = await createProduct(owner.db, org, { categoryId: cat.data.id, name: "Original", description: "", price: "1000", active: true });
    const plato2 = await createProduct(owner.db, org, { categoryId: cat.data.id, name: "Otro", description: "", price: "2000", active: true });
    if (!plato.ok || !plato2.ok) throw new Error("plato");
    return { org, cat: cat.data.id, plato: plato.data.id, plato2: plato2.data.id };
  }

  it.each(casos)("en %s ninguna acción escribe y todas dicen por qué", async (_nombre, dias, bloqueo) => {
    const c = await conCarta(`tt-carta-mora-${bloqueo.slice(8, 12)}`);
    const antes = JSON.stringify([await filas("categories", c.org), await filas("products", c.org)]);
    await setSubscription(service, c.org, { finEnMs: -dias * DIA_MS });

    for (const db of [owner.db, staff.db]) {
      const intentos = [
        createCategory(db, c.org, { name: "Nueva" }),
        renameCategory(db, c.org, c.cat, { name: "Renombrada" }),
        setCategoryActive(db, c.org, c.cat, false),
        moveCategory(db, c.org, c.cat, "up"),
        createProduct(db, c.org, { categoryId: c.cat, name: "Nuevo", description: "", price: "1", active: true }),
        updateProduct(db, c.org, c.plato, { categoryId: c.cat, name: "Cambiado", description: "", price: "9999" }),
        setProductActive(db, c.org, c.plato, false),
        moveProduct(db, c.org, c.plato2, "up"),
        setProductImage(db, c.org, c.plato, png()),
        removeProductImage(db, c.org, c.plato),
      ];
      for (const result of await Promise.all(intentos)) {
        expect(result).toEqual({ ok: false, error: bloqueo });
      }
    }
    expect(JSON.stringify([await filas("categories", c.org), await filas("products", c.org)])).toBe(antes);

    // La carta se sigue pudiendo leer.
    expect((await loadCarta(owner.db, c.org))[0].products).toHaveLength(2);
  });

  it.each(casos)(
    "si el estado cambia justo después de comprobarlo (%s), la base descarta la escritura y NO se informa un éxito",
    async (_nombre, dias, bloqueo) => {
      const c = await conCarta(`tt-carta-carrera-${bloqueo.slice(8, 12)}`);
      await setSubscription(service, c.org, { finEnMs: -dias * DIA_MS });

      // Simula una comprobación desactualizada: la PRIMERA lectura de org_entitlements dice que se puede escribir.
      const rezagado = (db: Db): Db => {
        let primera = true;
        return new Proxy(db, {
          get(target, prop, receiver) {
            if (prop === "rpc") {
              return async (fn: string, args: { p_org: string }) => {
                const real = await target.rpc("org_entitlements", args);
                if (fn === "org_entitlements" && primera) {
                  primera = false;
                  return { ...real, data: { ...(real.data as object), can_write: true, state: "active" } };
                }
                return real;
              };
            }
            return Reflect.get(target, prop, receiver);
          },
        });
      };

      const antes = JSON.stringify([await filas("categories", c.org), await filas("products", c.org)]);
      const results = [
        await renameCategory(rezagado(owner.db), c.org, c.cat, { name: "Renombrada" }),
        await setCategoryActive(rezagado(owner.db), c.org, c.cat, false),
        await setProductActive(rezagado(owner.db), c.org, c.plato, false),
        await updateProduct(rezagado(staff.db), c.org, c.plato, { categoryId: c.cat, name: "Cambiado", description: "", price: "9999" }),
        await moveProduct(rezagado(owner.db), c.org, c.plato2, "up"),
        await moveCategory(rezagado(owner.db), c.org, c.cat, "down"),
        await createCategory(rezagado(owner.db), c.org, { name: "Nueva" }),
        await createProduct(rezagado(owner.db), c.org, { categoryId: c.cat, name: "Nuevo", description: "", price: "1", active: true }),
      ];
      // moveCategory con una sola categoría no tiene nada que mover: es un éxito vacío y no escribe.
      for (const [index, result] of results.entries()) {
        if (index === 5) expect(result.ok).toBe(true);
        else expect(result, `intento ${index}`).toEqual({ ok: false, error: bloqueo });
      }
      expect(JSON.stringify([await filas("categories", c.org), await filas("products", c.org)])).toBe(antes);
    },
  );

  it("en gracia se edita con normalidad", async () => {
    const c = await conCarta("tt-carta-gracia");
    await setSubscription(service, c.org, { finEnMs: -3 * DIA_MS });
    expect((await updateProduct(staff.db, c.org, c.plato, { categoryId: c.cat, name: "En gracia", description: "", price: "1500" })).ok).toBe(true);
    expect((await createCategory(owner.db, c.org, { name: "Gracia" })).ok).toBe(true);
  });
});

describe("fotos", () => {
  it("sube, reemplaza (borra la anterior), quita y rechaza lo que no es imagen", async () => {
    const org = await nuevaOrg("tt-carta-foto");
    const cat = await createCategory(owner.db, org, { name: "Carta" });
    if (!cat.ok) throw new Error("categoría");
    const plato = await createProduct(owner.db, org, { categoryId: cat.data.id, name: "Con foto", description: "", price: "1000", active: true });
    if (!plato.ok) throw new Error("plato");
    const id = plato.data.id;
    const imagenActual = async () => (await service.from("products").select("image_path").eq("id", id).single()).data?.image_path ?? null;

    expect((await setProductImage(staff.db, org, id, png())).ok).toBe(true);
    const primera = await imagenActual();
    expect(primera).toMatch(new RegExp(`^${org}/${id}/[0-9a-f-]{36}\\.png$`));
    objects.push(primera!);
    expect(await existeObjeto(primera!)).toBe(true);

    expect((await setProductImage(owner.db, org, id, png())).ok).toBe(true);
    const segunda = await imagenActual();
    objects.push(segunda!);
    expect(segunda).not.toBe(primera);
    expect(await existeObjeto(segunda!)).toBe(true);
    expect(await existeObjeto(primera!)).toBe(false);

    // No es una imagen aunque diga serlo; archivo vacío; demasiado grande: nada cambia.
    const falsa = new File([Buffer.from("<script>alert(1)</script>")], "foto.jpg", { type: "image/jpeg" });
    expect(await setProductImage(owner.db, org, id, falsa)).toEqual({ ok: false, error: "image_type" });
    expect(await setProductImage(owner.db, org, id, new File([], "vacia.png", { type: "image/png" }))).toEqual({ ok: false, error: "image_missing" });
    expect(await setProductImage(owner.db, org, id, null)).toEqual({ ok: false, error: "image_missing" });
    const grande = new File([Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])], "grande.png", { type: "image/png" });
    expect(await setProductImage(owner.db, org, id, grande)).toEqual({ ok: false, error: "image_big" });
    expect(await imagenActual()).toBe(segunda);

    expect((await removeProductImage(staff.db, org, id)).ok).toBe(true);
    expect(await imagenActual()).toBeNull();
    expect(await existeObjeto(segunda!)).toBe(false);
    // Quitar una foto que no hay no es un error.
    expect((await removeProductImage(owner.db, org, id)).ok).toBe(true);
  });

  it("si Storage no borra ningún objeto (cero filas, sin error), la foto huérfana se registra en el log", async () => {
    const org = await nuevaOrg("tt-carta-foto-cero");
    const cat = await createCategory(owner.db, org, { name: "Carta" });
    if (!cat.ok) throw new Error("categoría");
    const plato = await createProduct(owner.db, org, { categoryId: cat.data.id, name: "Plato", description: "", price: "1", active: true });
    if (!plato.ok) throw new Error("plato");
    const id = plato.data.id;

    const primera = await setProductImage(owner.db, org, id, png());
    expect(primera.ok).toBe(true);
    const anterior = (await service.from("products").select("image_path").eq("id", id).single()).data!.image_path!;
    objects.push(anterior);

    // Storage "borra" cero objetos y no da error: lo que pasa cuando RLS descarta el borrado.
    const sinBorrar: Db = new Proxy(owner.db, {
      get(target, prop, receiver) {
        if (prop === "storage") {
          const storage = target.storage;
          return {
            ...storage,
            from: (bucket: string) => {
              const real = storage.from(bucket);
              return { upload: real.upload.bind(real), remove: async () => ({ data: [], error: null }) };
            },
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Reemplazar: el plato queda con la foto nueva (ok) y la anterior no se pudo borrar.
      expect((await setProductImage(sinBorrar, org, id, png())).ok).toBe(true);
      expect(log).toHaveBeenCalledWith(expect.stringContaining(anterior));
      expect(log).toHaveBeenCalledWith(expect.stringContaining("no borró ningún objeto"));
      log.mockClear();

      // Quitar: lo mismo con la foto vigente.
      const vigente = (await service.from("products").select("image_path").eq("id", id).single()).data!.image_path!;
      objects.push(vigente);
      expect((await removeProductImage(sinBorrar, org, id)).ok).toBe(true);
      expect(log).toHaveBeenCalledWith(expect.stringContaining(vigente));
    } finally {
      log.mockRestore();
    }
  });

  it("si no se puede apuntar el plato a la foto nueva, se borra la recién subida", async () => {
    const org = await nuevaOrg("tt-carta-foto-huerfana");
    const cat = await createCategory(owner.db, org, { name: "Carta" });
    if (!cat.ok) throw new Error("categoría");
    const plato = await createProduct(owner.db, org, { categoryId: cat.data.id, name: "Plato", description: "", price: "1", active: true });
    if (!plato.ok) throw new Error("plato");

    // Hace fallar el UPDATE del plato (la subida ya ocurrió): se espera que la foto nueva no quede.
    const subidas: string[] = [];
    const db: Db = new Proxy(owner.db, {
      get(target, prop, receiver) {
        if (prop === "storage") {
          const storage = target.storage;
          return {
            ...storage,
            from: (bucket: string) => {
              const real = storage.from(bucket);
              return {
                upload: async (path: string, ...rest: [Buffer | Uint8Array, object?]) => {
                  subidas.push(path);
                  return real.upload(path, ...(rest as [Uint8Array, object]));
                },
                remove: (paths: string[]) => real.remove(paths),
              };
            },
          };
        }
        if (prop === "from") {
          return (table: string) => {
            const builder = target.from(table as "products");
            if (table !== "products") return builder;
            return new Proxy(builder, {
              get(t, p, r) {
                if (p === "update") {
                  return (values: { image_path?: string | null }) =>
                    values.image_path
                      ? t.update({ image_path: `${org}/${plato.data.id}/no-es-uuid.png` }) // viola el check de la base
                      : t.update(values);
                }
                return Reflect.get(t, p, r);
              },
            });
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const result = await setProductImage(db, org, plato.data.id, png());
    expect(result.ok).toBe(false);
    expect(subidas).toHaveLength(1);
    expect(await existeObjeto(subidas[0])).toBe(false);
  });
});

vi.setConfig({ testTimeout: 30_000 });
