import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  anonClient,
  createCategory as seedCategory,
  createOrg,
  createUser,
  DIA_MS,
  deleteOrg,
  deleteUser,
  ORG_CAFE,
  serviceClient,
  setSubscription,
  type Db,
  type TestUser,
} from "./helpers";
import { loadTranslationTree, saveTranslations } from "@/lib/idiomas/panel";
import { loadRows } from "@/lib/public-menu";

/**
 * Carta en varios idiomas contra el Supabase local (ficha carta-en-varios-idiomas, ADR 0023): la columna `translations`
 * de categorías, platos, grupos y opciones. La lectura y la escritura siguen las políticas de cada tabla; acá se prueba lo
 * nuevo: el CHECK de la forma, el permiso por columna, que lo oculto no se publique, la cuenta en solo lectura y el módulo
 * del panel con personas reales.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
const orgs: string[] = [];

type Escenario = { org: string; category: string; product: string; group: string; option: string };

/** Una organización con Dueño y Staff, un plato con descripción, un grupo y una opción (creados con la clave de servicio). */
async function escenario(slug: string): Promise<Escenario> {
  const org = await createOrg(service, slug);
  orgs.push(org);
  await addMembership(service, owner, org, "owner");
  await addMembership(service, staff, org, "staff");
  const category = await seedCategory(service, org);
  const product = await service
    .from("products")
    .insert({ organization_id: org, category_id: category, name: "tt-plato", description: "Descripción original", price_cents: 1000 })
    .select("id")
    .single();
  if (product.error) throw new Error(product.error.message);
  const group = await service
    .from("option_groups")
    .insert({ organization_id: org, product_id: product.data.id, name: "Tamaño", min_choices: 1, max_choices: 1 })
    .select("id")
    .single();
  if (group.error) throw new Error(group.error.message);
  const option = await service
    .from("options")
    .insert({ organization_id: org, group_id: group.data.id, name: "Grande", price_delta_cents: 50000 })
    .select("id")
    .single();
  if (option.error) throw new Error(option.error.message);
  return { org, category, product: product.data.id, group: group.data.id, option: option.data.id };
}

const TABLAS = ["categories", "products", "option_groups", "options"] as const;
const idDe = (e: Escenario, tabla: (typeof TABLAS)[number]) =>
  ({ categories: e.category, products: e.product, option_groups: e.group, options: e.option })[tabla];

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([
    createUser(service, "trd-owner"),
    createUser(service, "trd-staff"),
    createUser(service, "trd-ajeno"),
  ]);
  const propia = await createOrg(service, "tt-trd-propia");
  orgs.push(propia);
  await addMembership(service, stranger, propia, "owner");
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, stranger].map((u) => deleteUser(service, u)));
});

describe("forma de la columna (CHECK)", () => {
  it("acepta idiomas en y pt con nombre y, solo en los platos, descripción", async () => {
    const e = await escenario("tt-trd-check-ok");
    for (const tabla of TABLAS) {
      const valor = tabla === "products" ? { en: { name: "Dish", description: "Tasty" }, pt: { name: "Prato" } } : { en: { name: "Name" }, pt: { name: "Nome" } };
      const r = await service.from(tabla).update({ translations: valor }).eq("id", idDe(e, tabla)).select("translations");
      expect(r.error, tabla).toBeNull();
      expect(r.data?.[0].translations, tabla).toEqual(valor);
    }
  });

  it("rechaza (23514) idiomas ajenos, claves ajenas, descripciones fuera de los platos, textos vacíos, con espacios o largos, y formas que no son objetos", async () => {
    const e = await escenario("tt-trd-check-mal");
    const invalidos: [string, unknown, "products" | "categories"][] = [
      ["idioma ajeno", { fr: { name: "x" } }, "products"],
      ["clave ajena", { en: { name: "x", price: "1" } }, "products"],
      ["descripción en una categoría", { en: { name: "x", description: "y" } }, "categories"],
      ["idioma vacío", { en: {} }, "products"],
      ["nombre vacío", { en: { name: "" } }, "products"],
      ["nombre con espacios en los bordes", { en: { name: " x" } }, "products"],
      ["nombre de 81 caracteres", { en: { name: "a".repeat(81) } }, "products"],
      ["descripción de 301 caracteres", { en: { description: "a".repeat(301) } }, "products"],
      ["nombre que no es texto", { en: { name: 5 } }, "products"],
      ["nombre nulo", { en: { name: null } }, "products"],
      ["entrada que no es objeto", { en: "x" }, "products"],
      ["lista", [{ en: { name: "x" } }], "products"],
      ["texto", "x", "products"],
    ];
    for (const [nombre, valor, tabla] of invalidos) {
      const r = await service.from(tabla).update({ translations: valor as never }).eq("id", idDe(e, tabla)).select("id");
      expect(r.error?.code, nombre).toBe("23514");
    }
    // Los límites exactos sí valen.
    const limite = await service
      .from("products")
      .update({ translations: { en: { name: "a".repeat(80), description: "a".repeat(300) } } })
      .eq("id", e.product)
      .select("id");
    expect(limite.error).toBeNull();
  });

  it("el nulo no existe: la columna es obligatoria y arranca vacía", async () => {
    const e = await escenario("tt-trd-check-nulo");
    expect((await service.from("products").update({ translations: null as never }).eq("id", e.product).select("id")).error?.code).toBe("23502");
    const actual = await service.from("products").select("translations").eq("id", e.product).single();
    expect(actual.data?.translations).toEqual({});
  });
});

describe("permisos: miembros escriben, nadie más", () => {
  it("Dueño y Staff escriben las traducciones de las cuatro tablas", async () => {
    const e = await escenario("tt-trd-miembros");
    for (const persona of [owner, staff]) {
      for (const tabla of TABLAS) {
        const valor = { en: { name: `por ${persona.id.slice(0, 4)}` } };
        const r = await persona.db.from(tabla).update({ translations: valor }).eq("id", idDe(e, tabla)).select("translations");
        expect(r.error, `${tabla} ${persona.email}`).toBeNull();
        expect(r.data?.[0].translations).toEqual(valor);
      }
    }
  });

  it("el alta también puede traer traducciones (permiso de INSERT por columna)", async () => {
    const e = await escenario("tt-trd-alta");
    const r = await owner.db
      .from("categories")
      .insert({ organization_id: e.org, name: "Con traducción", sort_order: 5, translations: { en: { name: "Translated" } } })
      .select("translations")
      .single();
    expect(r.error).toBeNull();
    expect(r.data?.translations).toEqual({ en: { name: "Translated" } });
  });

  it("una persona de otra organización no cambia nada (0 filas) y anon recibe 42501", async () => {
    const e = await escenario("tt-trd-ajeno");
    const anon = anonClient();
    for (const tabla of TABLAS) {
      const ajeno = await stranger.db.from(tabla).update({ translations: { en: { name: "hackeado" } } }).eq("id", idDe(e, tabla)).select("id");
      expect(ajeno.data ?? [], tabla).toHaveLength(0);
      const publico = await anon.from(tabla).update({ translations: { en: { name: "hackeado" } } }).eq("id", idDe(e, tabla));
      expect(publico.error?.code, tabla).toBe("42501");
      const guardado = await service.from(tabla).select("translations").eq("id", idDe(e, tabla)).single();
      expect(guardado.data?.translations, tabla).toEqual({});
    }
  });

  it("solo se suma la columna translations a lo que ya se podía escribir: el padre y la organización siguen fijos", async () => {
    const e = await escenario("tt-trd-columnas");
    const otro = await seedCategory(service, e.org, "tt-otra");
    const mover = await owner.db.from("products").update({ organization_id: ORG_CAFE }).eq("id", e.product);
    expect(mover.error?.code).toBe("42501");
    // El plato sí puede cambiar de categoría: ya era así. Lo que importa es que su traducción viaja con la fila.
    await service.from("products").update({ translations: { en: { name: "Dish" } } }).eq("id", e.product);
    const movido = await owner.db.from("products").update({ category_id: otro }).eq("id", e.product).select("translations");
    expect(movido.data?.[0].translations).toEqual({ en: { name: "Dish" } });
  });
});

describe("lectura pública", () => {
  it("anon lee las traducciones de lo publicado y no las de un plato oculto ni las de una categoría oculta", async () => {
    const e = await escenario("tt-trd-publico");
    await service.from("products").update({ translations: { en: { name: "Dish", description: "Tasty" } } }).eq("id", e.product);
    await service.from("categories").update({ translations: { en: { name: "Category" } } }).eq("id", e.category);
    const anon = anonClient();

    const visible = await anon.from("products").select("translations").eq("id", e.product).single();
    expect(visible.data?.translations).toEqual({ en: { name: "Dish", description: "Tasty" } });

    await service.from("products").update({ is_active: false }).eq("id", e.product);
    expect((await anon.from("products").select("translations").eq("id", e.product)).data).toEqual([]);
    await service.from("products").update({ is_active: true }).eq("id", e.product);

    await service.from("categories").update({ is_active: false }).eq("id", e.category);
    expect((await anon.from("products").select("translations").eq("id", e.product)).data).toEqual([]);
    expect((await anon.from("categories").select("translations").eq("id", e.category)).data).toEqual([]);
  });

  it("la lectura de la carta pública (loadRows) trae las traducciones de las cuatro tablas, con la forma de siempre", async () => {
    const e = await escenario("tt-trd-loadrows");
    await Promise.all([
      service.from("categories").update({ translations: { pt: { name: "Categoria" } } }).eq("id", e.category),
      service.from("products").update({ translations: { en: { name: "Dish", description: "Tasty" } } }).eq("id", e.product),
      service.from("option_groups").update({ translations: { en: { name: "Size" } } }).eq("id", e.group),
      service.from("options").update({ translations: { en: { name: "Large" } } }).eq("id", e.option),
    ]);
    const filas = await loadRows(e.org);
    expect(filas.categories[0].translations).toEqual({ pt: { name: "Categoria" } });
    expect(filas.products[0].translations).toEqual({ en: { name: "Dish", description: "Tasty" } });
    expect(filas.optionGroups[0].translations).toEqual({ en: { name: "Size" } });
    expect(filas.options[0].translations).toEqual({ en: { name: "Large" } });
  });

  it("una fila sin traducciones llega como objeto vacío", async () => {
    const filas = await loadRows(ORG_CAFE);
    expect(filas.products.length).toBeGreaterThan(0);
    for (const fila of [...filas.categories, ...filas.products, ...filas.optionGroups, ...filas.options]) {
      expect(fila.translations).toEqual({});
    }
  });
});

describe("cuenta en solo lectura o suspendida", () => {
  it("la base rechaza la escritura en solo lectura y suspendida; en gracia escribe", async () => {
    const e = await escenario("tt-trd-cuenta");
    const intentar = async () =>
      (await owner.db.from("products").update({ translations: { en: { name: "Dish" } } }).eq("id", e.product).select("id")).data?.length ?? 0;

    expect(await intentar()).toBe(1);
    await setSubscription(service, e.org, { finEnMs: -3 * DIA_MS }); // gracia
    expect(await intentar()).toBe(1);
    await setSubscription(service, e.org, { finEnMs: -10 * DIA_MS }); // solo lectura
    expect(await intentar()).toBe(0);
    await setSubscription(service, e.org, { finEnMs: -20 * DIA_MS }); // suspendida
    expect(await intentar()).toBe(0);
  });
});

describe("módulo del panel (saveTranslations) con personas reales", () => {
  it("lee el árbol completo, también lo oculto, en el orden de la carta", async () => {
    const e = await escenario("tt-trd-arbol");
    await service.from("products").update({ is_active: false }).eq("id", e.product);
    const arbol = await loadTranslationTree(owner.db, e.org);
    expect(arbol).toHaveLength(1);
    const plato = arbol[0].children[0];
    expect(plato).toMatchObject({ kind: "product", name: "tt-plato", description: "Descripción original", isActive: false });
    expect(plato.children[0]).toMatchObject({ kind: "group", name: "Tamaño" });
    expect(plato.children[0].children[0]).toMatchObject({ kind: "option", name: "Grande" });
  });

  it("guarda en las cuatro tablas, solo cuenta lo que cambió y no pisa los otros idiomas", async () => {
    const e = await escenario("tt-trd-guardar");
    const entradas = [
      { kind: "category" as const, id: e.category, name: "Category" },
      { kind: "product" as const, id: e.product, name: "Dish", description: "Tasty" },
      { kind: "group" as const, id: e.group, name: "Size" },
      { kind: "option" as const, id: e.option, name: "Large" },
    ];
    const primera = await saveTranslations(owner.db, e.org, "en", entradas);
    expect(primera).toEqual({ ok: true, changed: 4 });
    expect(await saveTranslations(owner.db, e.org, "en", entradas)).toEqual({ ok: true, changed: 0 });

    const pt = await saveTranslations(staff.db, e.org, "pt", [{ kind: "product", id: e.product, name: "Prato" }]);
    expect(pt).toEqual({ ok: true, changed: 1 });
    const plato = await service.from("products").select("translations").eq("id", e.product).single();
    expect(plato.data?.translations).toEqual({ en: { name: "Dish", description: "Tasty" }, pt: { name: "Prato" } });
  });

  it("un campo vacío borra esa traducción y, sin campos, quita el idioma", async () => {
    const e = await escenario("tt-trd-borrar");
    await saveTranslations(owner.db, e.org, "en", [{ kind: "product", id: e.product, name: "Dish", description: "Tasty" }]);
    await saveTranslations(owner.db, e.org, "en", [{ kind: "product", id: e.product, name: "Dish", description: "" }]);
    expect((await service.from("products").select("translations").eq("id", e.product).single()).data?.translations).toEqual({ en: { name: "Dish" } });
    await saveTranslations(owner.db, e.org, "en", [{ kind: "product", id: e.product, name: "" }]);
    expect((await service.from("products").select("translations").eq("id", e.product).single()).data?.translations).toEqual({});
  });

  it("ignora filas de otra organización o inexistentes", async () => {
    const mia = await escenario("tt-trd-propia-org");
    const ajena = await escenario("tt-trd-otra-org");
    const resultado = await saveTranslations(owner.db, mia.org, "en", [
      { kind: "product", id: ajena.product, name: "Robado" },
      { kind: "category", id: "00000000-0000-4000-8000-000000000000", name: "No existe" },
    ]);
    expect(resultado).toEqual({ ok: true, changed: 0 });
    expect((await service.from("products").select("translations").eq("id", ajena.product).single()).data?.translations).toEqual({});
  });

  it("rechaza lo largo sin escribir nada y nombra el problema", async () => {
    const e = await escenario("tt-trd-largo");
    const r = await saveTranslations(owner.db, e.org, "en", [
      { kind: "category", id: e.category, name: "Bien" },
      { kind: "product", id: e.product, name: "a".repeat(81) },
    ]);
    expect(r).toEqual({ ok: false, error: "name_too_long", changed: 0 });
    expect((await service.from("categories").select("translations").eq("id", e.category).single()).data?.translations).toEqual({});
  });

  it("en solo lectura o suspendida no escribe y lo dice; una persona ajena no ve ni escribe nada", async () => {
    const e = await escenario("tt-trd-bloqueo");
    const entrada = [{ kind: "product" as const, id: e.product, name: "Dish" }];
    await setSubscription(service, e.org, { finEnMs: -10 * DIA_MS });
    expect(await saveTranslations(owner.db, e.org, "en", entrada)).toEqual({ ok: false, error: "blocked_read_only", changed: 0 });
    await setSubscription(service, e.org, { finEnMs: -20 * DIA_MS });
    expect(await saveTranslations(owner.db, e.org, "en", entrada)).toEqual({ ok: false, error: "blocked_suspended", changed: 0 });
    await setSubscription(service, e.org, { finEnMs: 5 * DIA_MS });

    // Lo publicado es público para cualquiera; lo oculto, solo para los miembros.
    await service.from("products").update({ is_active: false }).eq("id", e.product);
    expect((await loadTranslationTree(stranger.db, e.org)).flatMap((categoria) => categoria.children)).toEqual([]);
    expect(await saveTranslations(stranger.db, e.org, "en", entrada)).toMatchObject({ changed: 0 });
    expect((await service.from("products").select("translations").eq("id", e.product).single()).data?.translations).toEqual({});
  });
});
