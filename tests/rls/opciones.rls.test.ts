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
  ORG_PARRILLA,
  serviceClient,
  setSubscription,
  sql,
  type Db,
  type TestUser,
} from "./helpers";
import {
  createGroup,
  createOption,
  loadProductOptions,
  moveGroup,
  moveOption,
  setGroupActive,
  setOptionActive,
  updateGroup,
  updateOption,
} from "@/lib/carta/options";
import { loadRows } from "@/lib/public-menu";

/**
 * Variantes y adicionales contra el Supabase local (ficha variantes-y-adicionales): aislamiento entre organizaciones,
 * lectura pública solo de lo activo y visible, permisos por columna, CHECKs, topes técnicos, cuenta en solo lectura o
 * suspendida y el módulo `options` con personas reales.
 */

const ID_ESPRESSO = "13000000-0000-4000-8000-000000000001";

let service: Db;
let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
const orgs: string[] = [];

type Escenario = { org: string; category: string; product: string; group: string; option: string };

/** Una organización con Dueño y Staff, un plato y un grupo con una opción (creados con la clave de servicio). */
async function escenario(slug: string): Promise<Escenario> {
  const org = await createOrg(service, slug);
  orgs.push(org);
  await addMembership(service, owner, org, "owner");
  await addMembership(service, staff, org, "staff");
  const category = await seedCategory(service, org);
  const product = await service
    .from("products")
    .insert({ organization_id: org, category_id: category, name: "tt-plato", price_cents: 1000 })
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

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([
    createUser(service, "opc-owner"),
    createUser(service, "opc-staff"),
    createUser(service, "opc-ajeno"),
  ]);
  // El ajeno es Dueño de su propia organización (otra), nunca de las de las pruebas.
  const propia = await createOrg(service, "tt-opc-propia");
  orgs.push(propia);
  await addMembership(service, stranger, propia, "owner");
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, stranger].map((u) => deleteUser(service, u)));
});

describe("lectura pública (anon)", () => {
  it("el seed publica solo lo activo de platos visibles: ni grupos inactivos, ni opciones inactivas, ni los de un plato oculto", async () => {
    const anon = anonClient();
    const grupos = await anon.from("option_groups").select("id, name").eq("organization_id", ORG_CAFE).order("sort_order");
    expect(grupos.error).toBeNull();
    expect(grupos.data?.map((g) => g.name)).toEqual(["Tamaño", "Extras"]);

    const opciones = await anon.from("options").select("name").eq("organization_id", ORG_CAFE).order("name");
    expect(opciones.data?.map((o) => o.name)).toEqual(["Crema", "Doble", "Leche de almendras", "Simple"]);

    const parrilla = await anon.from("option_groups").select("name").eq("organization_id", ORG_PARRILLA);
    expect(parrilla.data?.map((g) => g.name)).toEqual(["Punto de cocción"]);
  });

  it("un grupo o una opción desactivados dejan de verse y vuelven al reactivarlos", async () => {
    const e = await escenario("tt-opc-anon-activo");
    const anon = anonClient();
    const ver = async () => ({
      grupos: (await anon.from("option_groups").select("id").eq("organization_id", e.org)).data?.length,
      opciones: (await anon.from("options").select("id").eq("organization_id", e.org)).data?.length,
    });
    expect(await ver()).toEqual({ grupos: 1, opciones: 1 });

    await service.from("options").update({ is_active: false }).eq("id", e.option);
    expect(await ver()).toEqual({ grupos: 1, opciones: 0 });
    await service.from("options").update({ is_active: true }).eq("id", e.option);

    await service.from("option_groups").update({ is_active: false }).eq("id", e.group);
    expect(await ver()).toEqual({ grupos: 0, opciones: 0 });
    await service.from("option_groups").update({ is_active: true }).eq("id", e.group);
    expect(await ver()).toEqual({ grupos: 1, opciones: 1 });
  });

  it("un plato inactivo o en categoría inactiva oculta sus grupos y opciones", async () => {
    const e = await escenario("tt-opc-anon-plato");
    const anon = anonClient();
    const cantidad = async () =>
      ((await anon.from("option_groups").select("id").eq("organization_id", e.org)).data?.length ?? 0) +
      ((await anon.from("options").select("id").eq("organization_id", e.org)).data?.length ?? 0);
    expect(await cantidad()).toBe(2);

    await service.from("products").update({ is_active: false }).eq("id", e.product);
    expect(await cantidad()).toBe(0);
    await service.from("products").update({ is_active: true }).eq("id", e.product);

    await service.from("categories").update({ is_active: false }).eq("id", e.category);
    expect(await cantidad()).toBe(0);
  });

  it("una organización inactiva o suspendida por mora no publica sus grupos ni opciones; en solo lectura sí", async () => {
    const e = await escenario("tt-opc-anon-cuenta");
    const anon = anonClient();
    const cantidad = async () =>
      ((await anon.from("option_groups").select("id").eq("organization_id", e.org)).data?.length ?? 0) +
      ((await anon.from("options").select("id").eq("organization_id", e.org)).data?.length ?? 0);

    await setSubscription(service, e.org, { finEnMs: -10 * DIA_MS }); // solo lectura: la carta sigue publicada
    expect(await cantidad()).toBe(2);
    await setSubscription(service, e.org, { finEnMs: -20 * DIA_MS }); // suspendida
    expect(await cantidad()).toBe(0);
    await setSubscription(service, e.org, { finEnMs: 5 * DIA_MS });
    expect(await cantidad()).toBe(2);
    await service.from("organizations").update({ is_active: false }).eq("id", e.org);
    expect(await cantidad()).toBe(0);
  });

  it("anon no puede escribir nada", async () => {
    const e = await escenario("tt-opc-anon-escribe");
    const anon = anonClient();
    const nuevoGrupo = await anon
      .from("option_groups")
      .insert({ organization_id: e.org, product_id: e.product, name: "x", min_choices: 0, max_choices: 1 });
    expect(nuevoGrupo.error?.code).toBe("42501");
    const nuevaOpcion = await anon.from("options").insert({ organization_id: e.org, group_id: e.group, name: "x" });
    expect(nuevaOpcion.error?.code).toBe("42501");
    const cambio = await anon.from("options").update({ name: "hackeada" }).eq("id", e.option);
    expect(cambio.error?.code).toBe("42501");
    expect((await service.from("options").select("name").eq("id", e.option).single()).data?.name).toBe("Grande");
  });
});

describe("miembros: Dueño y Staff", () => {
  it("ambos leen, crean, editan y desactivan grupos y opciones, también los inactivos", async () => {
    const e = await escenario("tt-opc-miembros");

    for (const persona of [owner, staff]) {
      const grupo = await persona.db
        .from("option_groups")
        .insert({ organization_id: e.org, product_id: e.product, name: `Extras ${persona.id.slice(0, 4)}`, min_choices: 0, max_choices: 3 })
        .select("id")
        .single();
      expect(grupo.error).toBeNull();
      const opcion = await persona.db
        .from("options")
        .insert({ organization_id: e.org, group_id: grupo.data!.id, name: "Queso", price_delta_cents: 20000 })
        .select("id")
        .single();
      expect(opcion.error).toBeNull();

      const editado = await persona.db.from("options").update({ price_delta_cents: 25000, is_active: false }).eq("id", opcion.data!.id).select("id");
      expect(editado.data).toHaveLength(1);
      const grupoEditado = await persona.db
        .from("option_groups")
        .update({ name: "Renombrado", is_active: false, min_choices: 0, max_choices: 2 })
        .eq("id", grupo.data!.id)
        .select("id");
      expect(grupoEditado.data).toHaveLength(1);
    }

    // Leen también lo inactivo.
    const todo = await staff.db.from("option_groups").select("id, is_active").eq("organization_id", e.org);
    expect(todo.data).toHaveLength(3);
    expect(todo.data?.filter((g) => !g.is_active)).toHaveLength(2);
  });

  it("sin DELETE: ni el Dueño ni el Staff borran grupos ni opciones", async () => {
    const e = await escenario("tt-opc-sin-delete");
    const borrarOpcion = await owner.db.from("options").delete().eq("id", e.option).select("id");
    expect(borrarOpcion.error?.code).toBe("42501");
    const borrarGrupo = await staff.db.from("option_groups").delete().eq("id", e.group).select("id");
    expect(borrarGrupo.error?.code).toBe("42501");
    expect((await service.from("options").select("id").eq("id", e.option)).data).toHaveLength(1);
  });

  it("borrar el plato se lleva sus grupos y opciones (cascada), sin dejar restos", async () => {
    const e = await escenario("tt-opc-cascada");
    const borrado = await service.from("products").delete().eq("id", e.product);
    expect(borrado.error).toBeNull();
    expect((await service.from("option_groups").select("id").eq("organization_id", e.org)).data).toEqual([]);
    expect((await service.from("options").select("id").eq("organization_id", e.org)).data).toEqual([]);
  });
});

describe("aislamiento entre organizaciones", () => {
  it("otra organización no lee los grupos inactivos ni escribe en los de esta", async () => {
    const e = await escenario("tt-opc-aislada");
    await service.from("option_groups").update({ is_active: false }).eq("id", e.group);
    await service.from("options").update({ is_active: false }).eq("id", e.option);

    // Lectura: el ajeno solo ve lo público; lo inactivo es invisible.
    expect((await stranger.db.from("option_groups").select("id").eq("organization_id", e.org)).data).toEqual([]);
    expect((await stranger.db.from("options").select("id").eq("organization_id", e.org)).data).toEqual([]);

    // Escritura: 0 filas afectadas, nada cambia.
    const grupo = await stranger.db.from("option_groups").update({ name: "pisado" }).eq("id", e.group).select("id");
    expect(grupo.data).toEqual([]);
    const opcion = await stranger.db.from("options").update({ price_delta_cents: 1 }).eq("id", e.option).select("id");
    expect(opcion.data).toEqual([]);
    expect((await service.from("option_groups").select("name").eq("id", e.group).single()).data?.name).toBe("Tamaño");
    expect((await service.from("options").select("price_delta_cents").eq("id", e.option).single()).data?.price_delta_cents).toBe(50000);
  });

  it("lo ACTIVO se lee por ser público, pero no se escribe: otra organización afecta 0 filas aunque lo vea", async () => {
    const e = await escenario("tt-opc-aislada-publico");
    // Visible para el ajeno (activo, plato y categoría activos): la lectura pública no da permiso de escritura.
    expect((await stranger.db.from("options").select("id").eq("id", e.option)).data).toHaveLength(1);
    expect((await stranger.db.from("option_groups").select("id").eq("id", e.group)).data).toHaveLength(1);

    const opcion = await stranger.db.from("options").update({ price_delta_cents: 1, is_active: false }).eq("id", e.option).select("id");
    expect(opcion.data).toEqual([]);
    const grupo = await stranger.db.from("option_groups").update({ name: "pisado", is_active: false }).eq("id", e.group).select("id");
    expect(grupo.data).toEqual([]);
    expect((await service.from("options").select("price_delta_cents, is_active").eq("id", e.option).single()).data).toEqual({
      price_delta_cents: 50000,
      is_active: true,
    });
    expect((await service.from("option_groups").select("name, is_active").eq("id", e.group).single()).data).toEqual({ name: "Tamaño", is_active: true });
  });

  it("no se crea un grupo ni una opción en una organización ajena, ni con una organización propia y un plato ajeno", async () => {
    const e = await escenario("tt-opc-aislada-alta");
    const [propia] = (await stranger.db.from("memberships").select("organization_id")).data ?? [];
    expect(propia).toBeDefined();
    const propiaOrg = propia.organization_id;

    // En la organización ajena: RLS lo rechaza.
    const enAjena = await stranger.db
      .from("option_groups")
      .insert({ organization_id: e.org, product_id: e.product, name: "intruso", min_choices: 0, max_choices: 1 });
    expect(enAjena.error?.code).toBe("42501");
    const opcionEnAjena = await stranger.db.from("options").insert({ organization_id: e.org, group_id: e.group, name: "intruso" });
    expect(opcionEnAjena.error?.code).toBe("42501");

    // Con la organización propia pero el plato (o el grupo) ajeno: la clave foránea compuesta lo rechaza.
    const platoAjeno = await stranger.db
      .from("option_groups")
      .insert({ organization_id: propiaOrg, product_id: e.product, name: "cruzado", min_choices: 0, max_choices: 1 });
    expect(platoAjeno.error?.code).toBe("23503");
    const grupoAjeno = await stranger.db.from("options").insert({ organization_id: propiaOrg, group_id: e.group, name: "cruzada" });
    expect(grupoAjeno.error?.code).toBe("23503");

    expect((await service.from("option_groups").select("id").eq("organization_id", e.org)).data).toHaveLength(1);
  });

  it("un miembro de dos organizaciones no puede mover un grupo ni una opción de una a otra (columnas fijas)", async () => {
    const a = await escenario("tt-opc-multi-a");
    const b = await escenario("tt-opc-multi-b");
    const mueveGrupoDePlato = await owner.db.from("option_groups").update({ product_id: b.product }).eq("id", a.group);
    expect(mueveGrupoDePlato.error?.code).toBe("42501");
    const mueveGrupoDeOrg = await owner.db.from("option_groups").update({ organization_id: b.org }).eq("id", a.group);
    expect(mueveGrupoDeOrg.error?.code).toBe("42501");
    const mueveOpcionDeGrupo = await owner.db.from("options").update({ group_id: b.group }).eq("id", a.option);
    expect(mueveOpcionDeGrupo.error?.code).toBe("42501");
    const mueveOpcionDeOrg = await owner.db.from("options").update({ organization_id: b.org }).eq("id", a.option);
    expect(mueveOpcionDeOrg.error?.code).toBe("42501");
    const cambiaId = await owner.db.from("options").update({ id: "00000000-0000-4000-8000-000000000999" }).eq("id", a.option);
    expect(cambiaId.error?.code).toBe("42501");
    expect((await service.from("options").select("group_id").eq("id", a.option).single()).data?.group_id).toBe(a.group);
  });
});

describe("restricciones de las tablas", () => {
  it("el mínimo no supera al máximo, el máximo va de 1 a 50 y el nombre de 1 a 80 caracteres", async () => {
    const e = await escenario("tt-opc-checks");
    const intento = (campos: Record<string, unknown>) =>
      service.from("option_groups").insert({ organization_id: e.org, product_id: e.product, name: "ok", min_choices: 0, max_choices: 1, ...campos });

    expect((await intento({ min_choices: 2, max_choices: 1 })).error?.code).toBe("23514");
    expect((await intento({ max_choices: 0 })).error?.code).toBe("23514");
    expect((await intento({ max_choices: 51 })).error?.code).toBe("23514");
    expect((await intento({ min_choices: -1 })).error?.code).toBe("23514");
    expect((await intento({ name: "   " })).error?.code).toBe("23514");
    expect((await intento({ name: "x".repeat(81) })).error?.code).toBe("23514");
    expect((await intento({ name: "x".repeat(80), min_choices: 50, max_choices: 50 })).error).toBeNull();
  });

  it("la diferencia de precio no es negativa ni pasa de $ 10.000.000, y el nombre de la opción de 1 a 80", async () => {
    const e = await escenario("tt-opc-checks-opc");
    const intento = (campos: Record<string, unknown>) =>
      service.from("options").insert({ organization_id: e.org, group_id: e.group, name: "ok", ...campos });

    expect((await intento({ price_delta_cents: -1 })).error?.code).toBe("23514");
    expect((await intento({ price_delta_cents: 1_000_000_001 })).error?.code).toBe("23514");
    expect((await intento({ name: "" })).error?.code).toBe("23514");
    expect((await intento({ name: "y".repeat(81) })).error?.code).toBe("23514");
    expect((await intento({ price_delta_cents: 0 })).error).toBeNull();
    expect((await intento({ price_delta_cents: 1_000_000_000 })).error).toBeNull();
  });

  it("los checks también valen para la API: un Dueño no guarda un máximo menor que el mínimo ni un precio negativo", async () => {
    const e = await escenario("tt-opc-checks-api");
    const grupo = await owner.db.from("option_groups").update({ min_choices: 3, max_choices: 2 }).eq("id", e.group);
    expect(grupo.error?.code).toBe("23514");
    const opcion = await owner.db.from("options").update({ price_delta_cents: -100 }).eq("id", e.option);
    expect(opcion.error?.code).toBe("23514");
  });

  it("topes técnicos: 20 grupos por plato y 60 opciones por grupo, contando también lo inactivo (54000)", async () => {
    const e = await escenario("tt-opc-topes");
    const grupos = Array.from({ length: 19 }, (_, i) => ({
      organization_id: e.org,
      product_id: e.product,
      name: `g${i}`,
      min_choices: 0,
      max_choices: 1,
      is_active: i % 2 === 0,
    }));
    expect((await service.from("option_groups").insert(grupos)).error).toBeNull(); // ya hay 1 + 19 = 20
    const demasiados = await owner.db
      .from("option_groups")
      .insert({ organization_id: e.org, product_id: e.product, name: "el 21", min_choices: 0, max_choices: 1 });
    expect(demasiados.error?.code).toBe("54000");

    const opciones = Array.from({ length: 59 }, (_, i) => ({ organization_id: e.org, group_id: e.group, name: `o${i}`, is_active: i % 2 === 0 }));
    expect((await service.from("options").insert(opciones)).error).toBeNull(); // 1 + 59 = 60
    const demasiadas = await staff.db.from("options").insert({ organization_id: e.org, group_id: e.group, name: "la 61" });
    expect(demasiadas.error?.code).toBe("54000");
  });
});

describe("topes técnicos con altas simultáneas", () => {
  it("con 59 opciones, cuatro altas a la vez dejan exactamente 60: una se guarda y las otras reciben 54000 (candado de transacción)", async () => {
    const e = await escenario("tt-opc-carrera-opc");
    await service.from("options").insert(Array.from({ length: 58 }, (_, i) => ({ organization_id: e.org, group_id: e.group, name: `o${i}` })));

    // Cada alta es una transacción independiente (una petición HTTP propia). Sin el candado, todas cuentan 60 filas y pasan.
    const resultados = await Promise.all(
      [owner, staff, owner, staff].map((persona, i) =>
        persona.db.from("options").insert({ organization_id: e.org, group_id: e.group, name: `carrera${i}` }),
      ),
    );
    const guardadas = resultados.filter((r) => r.error === null).length;
    expect(guardadas).toBe(1);
    expect(resultados.filter((r) => r.error?.code === "54000")).toHaveLength(3);
    expect((await service.from("options").select("id", { count: "exact", head: true }).eq("group_id", e.group)).count).toBe(60);
  });

  it("con 19 grupos, cuatro altas a la vez dejan exactamente 20 por plato", async () => {
    const e = await escenario("tt-opc-carrera-grp");
    await service
      .from("option_groups")
      .insert(Array.from({ length: 18 }, (_, i) => ({ organization_id: e.org, product_id: e.product, name: `g${i}`, min_choices: 0, max_choices: 1 })));

    const resultados = await Promise.all(
      [owner, staff, owner, staff].map((persona, i) =>
        persona.db
          .from("option_groups")
          .insert({ organization_id: e.org, product_id: e.product, name: `carrera${i}`, min_choices: 0, max_choices: 1 }),
      ),
    );
    expect(resultados.filter((r) => r.error === null)).toHaveLength(1);
    expect(resultados.filter((r) => r.error?.code === "54000")).toHaveLength(3);
    expect((await service.from("option_groups").select("id", { count: "exact", head: true }).eq("product_id", e.product)).count).toBe(20);
  });
});

describe("más de 1000 filas (PostgREST corta cada lectura en max_rows)", () => {
  it("las opciones de un plato (20 grupos × 60 = 1200) y las de toda la organización se leen completas", async () => {
    const e = await escenario("tt-opc-paginas");
    const grupos = await service
      .from("option_groups")
      .insert(Array.from({ length: 19 }, (_, i) => ({ organization_id: e.org, product_id: e.product, name: `g${i}`, min_choices: 0, max_choices: 1 })))
      .select("id");
    const ids = [e.group, ...(grupos.data ?? []).map((g) => g.id)];
    expect(ids).toHaveLength(20);
    for (const id of ids) {
      const hechas = (await service.from("options").select("id", { count: "exact", head: true }).eq("group_id", id)).count ?? 0;
      const faltan = Array.from({ length: 60 - hechas }, (_, i) => ({ organization_id: e.org, group_id: id, name: `opcion ${i}`, price_delta_cents: 100 }));
      const insertadas = await service.from("options").insert(faltan);
      expect(insertadas.error).toBeNull();
    }
    expect((await service.from("options").select("id", { count: "exact", head: true }).eq("organization_id", e.org)).count).toBe(1200);

    // Panel: el módulo devuelve las 1200 (sin paginar eran 1000).
    const panel = await loadProductOptions(owner.db, e.org, e.product);
    expect(panel).toHaveLength(20);
    expect(panel.reduce((total, g) => total + g.options.length, 0)).toBe(1200);

    // Carta pública (lo que se cachea): también las 1200, leídas como anónimo.
    const filas = await loadRows(e.org);
    expect(filas.optionGroups).toHaveLength(20);
    expect(filas.options).toHaveLength(1200);
  });

  it("los grupos de toda la organización también (51 platos × 20 grupos = 1020)", async () => {
    const e = await escenario("tt-opc-paginas-grupos");
    const platos = await service
      .from("products")
      .insert(Array.from({ length: 50 }, (_, i) => ({ organization_id: e.org, category_id: e.category, name: `plato ${i}`, price_cents: 1000 })))
      .select("id");
    const productos = [e.product, ...(platos.data ?? []).map((p) => p.id)];
    expect(productos).toHaveLength(51);
    const hechos = (await service.from("option_groups").select("id", { count: "exact", head: true }).eq("product_id", e.product)).count ?? 0;
    const filas = productos.flatMap((product, p) =>
      Array.from({ length: p === 0 ? 20 - hechos : 20 }, (_, i) => ({ organization_id: e.org, product_id: product, name: `g${i}`, min_choices: 0, max_choices: 1 })),
    );
    const insertados = await service.from("option_groups").insert(filas);
    expect(insertados.error).toBeNull();
    expect((await service.from("option_groups").select("id", { count: "exact", head: true }).eq("organization_id", e.org)).count).toBe(1020);

    const leidas = await loadRows(e.org);
    expect(leidas.optionGroups).toHaveLength(1020);
  });
});

describe("cuenta en solo lectura o suspendida", () => {
  it("en solo lectura y suspendida nadie escribe grupos ni opciones (la lectura sigue); en gracia sí", async () => {
    const e = await escenario("tt-opc-mora");

    for (const finEnMs of [-10 * DIA_MS, -20 * DIA_MS]) {
      await setSubscription(service, e.org, { finEnMs });
      for (const persona of [owner, staff]) {
        const grupo = await persona.db
          .from("option_groups")
          .insert({ organization_id: e.org, product_id: e.product, name: "bloqueado", min_choices: 0, max_choices: 1 });
        expect(grupo.error?.code).toBe("42501");
        const opcion = await persona.db.from("options").insert({ organization_id: e.org, group_id: e.group, name: "bloqueada" });
        expect(opcion.error?.code).toBe("42501");
        // Un UPDATE bloqueado afecta 0 filas sin error: nunca es un éxito.
        const cambio = await persona.db.from("options").update({ name: "pisada" }).eq("id", e.option).select("id");
        expect(cambio.error).toBeNull();
        expect(cambio.data).toEqual([]);
        const cambioGrupo = await persona.db.from("option_groups").update({ is_active: false }).eq("id", e.group).select("id");
        expect(cambioGrupo.data).toEqual([]);
        // La lectura de miembros sigue.
        expect((await persona.db.from("option_groups").select("id").eq("organization_id", e.org)).data).toHaveLength(1);
      }
    }
    expect((await service.from("options").select("name").eq("id", e.option).single()).data?.name).toBe("Grande");

    await setSubscription(service, e.org, { finEnMs: -3 * DIA_MS + 60 * 60 * 1000 }); // gracia
    const enGracia = await owner.db.from("options").update({ name: "Grande!" }).eq("id", e.option).select("id");
    expect(enGracia.data).toHaveLength(1);
  });
});

describe("módulo options (personas reales)", () => {
  it("crea, edita, ordena y activa grupos y opciones; las opciones nuevas van al final", async () => {
    const e = await escenario("tt-opc-modulo");
    const g2 = await createGroup(staff.db, e.org, e.product, { name: "  Extras ", min: "0", max: "3" });
    expect(g2.ok).toBe(true);
    if (!g2.ok) return;

    let grupos = await loadProductOptions(owner.db, e.org, e.product);
    expect(grupos.map((g) => [g.name, g.sort_order, g.min_choices, g.max_choices])).toEqual([
      ["Tamaño", 0, 1, 1],
      ["Extras", 1, 0, 3],
    ]);

    expect((await moveGroup(owner.db, e.org, g2.data.id, "up")).ok).toBe(true);
    grupos = await loadProductOptions(owner.db, e.org, e.product);
    expect(grupos.map((g) => g.name)).toEqual(["Extras", "Tamaño"]);

    const o1 = await createOption(owner.db, e.org, g2.data.id, { name: "Crema", delta: "200" });
    const o2 = await createOption(staff.db, e.org, g2.data.id, { name: "Queso", delta: "1.250,50" });
    const o3 = await createOption(owner.db, e.org, g2.data.id, { name: "Sin cargo", delta: "" });
    expect(o1.ok && o2.ok && o3.ok).toBe(true);
    if (!o1.ok || !o2.ok || !o3.ok) return;

    expect((await moveOption(owner.db, e.org, o3.data.id, "up")).ok).toBe(true);
    expect((await updateOption(staff.db, e.org, o2.data.id, { name: "Queso rallado", delta: "1.300" })).ok).toBe(true);
    expect((await setOptionActive(owner.db, e.org, o1.data.id, false)).ok).toBe(true);
    expect((await updateGroup(owner.db, e.org, g2.data.id, { name: "Para sumar", min: "1", max: "2" })).ok).toBe(true);
    expect((await setGroupActive(staff.db, e.org, e.group, false)).ok).toBe(true);

    grupos = await loadProductOptions(owner.db, e.org, e.product);
    expect(grupos.map((g) => [g.name, g.is_active, g.min_choices, g.max_choices])).toEqual([
      ["Para sumar", true, 1, 2],
      ["Tamaño", false, 1, 1],
    ]);
    expect(grupos[0].options.map((o) => [o.name, o.price_delta_cents, o.is_active])).toEqual([
      ["Crema", 20000, false],
      ["Sin cargo", 0, true],
      ["Queso rallado", 130000, true],
    ]);
  });

  it("valida antes de escribir y no guarda nada con datos inválidos", async () => {
    const e = await escenario("tt-opc-modulo-invalidos");
    expect(await createGroup(owner.db, e.org, e.product, { name: "", min: "0", max: "1" })).toEqual({ ok: false, error: "name_blank" });
    expect(await createGroup(owner.db, e.org, e.product, { name: "x".repeat(81), min: "0", max: "1" })).toEqual({ ok: false, error: "name_too_long" });
    expect(await createGroup(owner.db, e.org, e.product, { name: "ok", min: "2", max: "1" })).toEqual({ ok: false, error: "choices_min_over_max" });
    expect(await createGroup(owner.db, e.org, e.product, { name: "ok", min: "0", max: "0" })).toEqual({ ok: false, error: "choices_max_range" });
    expect(await createGroup(owner.db, e.org, e.product, { name: "ok", min: "a", max: "1" })).toEqual({ ok: false, error: "choices_invalid" });
    expect(await createOption(owner.db, e.org, e.group, { name: "ok", delta: "-5" })).toEqual({ ok: false, error: "price_invalid" });
    expect(await createOption(owner.db, e.org, e.group, { name: "ok", delta: "1,234" })).toEqual({ ok: false, error: "price_decimals" });
    expect((await service.from("option_groups").select("id").eq("organization_id", e.org)).data).toHaveLength(1);
    expect((await service.from("options").select("id").eq("organization_id", e.org)).data).toHaveLength(1);
  });

  it("un plato o grupo de otra organización responde «no encontrado» y no escribe nada", async () => {
    const e = await escenario("tt-opc-modulo-ajeno");
    const [propia] = (await stranger.db.from("memberships").select("organization_id")).data ?? [];
    const propiaOrg = propia.organization_id;

    expect(await createGroup(stranger.db, propiaOrg, e.product, { name: "cruzado", min: "0", max: "1" })).toEqual({ ok: false, error: "not_found" });
    expect(await createOption(stranger.db, propiaOrg, e.group, { name: "cruzada", delta: "" })).toEqual({ ok: false, error: "not_found" });
    expect(await updateGroup(stranger.db, propiaOrg, e.group, { name: "pisado", min: "0", max: "1" })).toEqual({ ok: false, error: "not_found" });
    expect(await updateOption(stranger.db, propiaOrg, e.option, { name: "pisada", delta: "" })).toEqual({ ok: false, error: "not_found" });
    expect(await setGroupActive(stranger.db, propiaOrg, e.group, false)).toEqual({ ok: false, error: "not_found" });
    expect(await moveOption(stranger.db, propiaOrg, e.option, "up")).toEqual({ ok: false, error: "not_found" });
    expect((await service.from("option_groups").select("name, is_active").eq("id", e.group).single()).data).toEqual({ name: "Tamaño", is_active: true });
  });

  it("cuenta en solo lectura o suspendida: errores claros y nada cambia (sin falsos éxitos)", async () => {
    const e = await escenario("tt-opc-modulo-mora");
    await setSubscription(service, e.org, { finEnMs: -10 * DIA_MS });
    expect(await createGroup(owner.db, e.org, e.product, { name: "x", min: "0", max: "1" })).toEqual({ ok: false, error: "blocked_read_only" });
    expect(await updateOption(staff.db, e.org, e.option, { name: "x", delta: "" })).toEqual({ ok: false, error: "blocked_read_only" });
    await setSubscription(service, e.org, { finEnMs: -20 * DIA_MS });
    expect(await setOptionActive(owner.db, e.org, e.option, false)).toEqual({ ok: false, error: "blocked_suspended" });
    expect(await moveGroup(staff.db, e.org, e.group, "down")).toEqual({ ok: false, error: "blocked_suspended" });
    expect((await service.from("options").select("name, is_active").eq("id", e.option).single()).data).toEqual({ name: "Grande", is_active: true });
  });

  it("los topes técnicos se traducen a mensajes propios (no al tope de platos del plan)", async () => {
    const e = await escenario("tt-opc-modulo-topes");
    await service.from("option_groups").insert(
      Array.from({ length: 19 }, (_, i) => ({ organization_id: e.org, product_id: e.product, name: `g${i}`, min_choices: 0, max_choices: 1 })),
    );
    expect(await createGroup(owner.db, e.org, e.product, { name: "el 21", min: "0", max: "1" })).toEqual({ ok: false, error: "group_cap" });
    await service.from("options").insert(
      Array.from({ length: 59 }, (_, i) => ({ organization_id: e.org, group_id: e.group, name: `o${i}` })),
    );
    expect(await createOption(staff.db, e.org, e.group, { name: "la 61", delta: "" })).toEqual({ ok: false, error: "option_cap" });
  });
});

describe("catálogo de la base", () => {
  it("las columnas que la API inserta y actualiza son exactamente las previstas, y anon solo lee", () => {
    const columnas = (rol: string, privilegio: string, tabla: string) =>
      sql(`
        select column_name from information_schema.column_privileges
        where grantee = '${rol}' and privilege_type = '${privilegio}' and table_schema = 'public' and table_name = '${tabla}'
        order by column_name`).flat();

    expect(columnas("authenticated", "INSERT", "option_groups")).toEqual(["is_active", "max_choices", "min_choices", "name", "organization_id", "product_id", "sort_order"]);
    expect(columnas("authenticated", "UPDATE", "option_groups")).toEqual(["is_active", "max_choices", "min_choices", "name", "sort_order"]);
    expect(columnas("authenticated", "INSERT", "options")).toEqual(["group_id", "is_active", "name", "organization_id", "price_delta_cents", "sort_order"]);
    expect(columnas("authenticated", "UPDATE", "options")).toEqual(["is_active", "name", "price_delta_cents", "sort_order"]);
    for (const tabla of ["option_groups", "options"]) {
      expect(columnas("anon", "INSERT", tabla), `${tabla}: INSERT de anon`).toEqual([]);
      expect(columnas("anon", "UPDATE", tabla), `${tabla}: UPDATE de anon`).toEqual([]);
      const tablaCompleta = sql(
        `select has_table_privilege('anon', 'public.${tabla}', 'delete'), has_table_privilege('authenticated', 'public.${tabla}', 'delete'), has_table_privilege('authenticated', 'public.${tabla}', 'truncate')`,
      );
      expect(tablaCompleta, `${tabla}: DELETE y TRUNCATE`).toEqual([["f", "f", "f"]]);
    }
  });

  it("las pruebas usan el plato del seed que dice la ficha (guarda contra un seed cambiado)", async () => {
    const { data } = await service.from("products").select("name").eq("id", ID_ESPRESSO).single();
    expect(data?.name).toBe("Espresso");
  });
});
