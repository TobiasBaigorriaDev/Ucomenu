import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  createCategory,
  createOrg,
  createUser,
  deleteOrg,
  deleteUser,
  insertProducts,
  serviceClient,
  setSubscription,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * Límites por plan (nivel C): se aplican al crear y al activar, sobre registros activos,
 * en la base y para todos los roles. Ver agile/cambios/planes-y-entitlements.md.
 */

const LIMIT_EXCEEDED = "53400"; // configuration_limit_exceeded

let service: Db;
let owner: TestUser;
const orgs: string[] = [];

/** Crea una organización de prueba con su categoría y a `owner` como dueño. */
async function nuevaOrg(slug: string, plan: "basic" | "pro" | "premium") {
  const id = await createOrg(service, slug, plan);
  orgs.push(id);
  await addMembership(service, owner, id, "owner");
  const categoryId = await createCategory(service, id);
  return { id, categoryId };
}

async function activos(orgId: string): Promise<number> {
  const { count } = await service
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("is_active", true);
  return count ?? 0;
}

beforeAll(async () => {
  service = serviceClient();
  owner = await createUser(service, "limites-owner");
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await deleteUser(service, owner);
});

describe("platos activos: Básico (tope 80)", () => {
  let org: { id: string; categoryId: string };

  beforeAll(async () => {
    org = await nuevaOrg("tt-lim-basico", "basic");
    const r = await insertProducts(service, org.id, org.categoryId, 80);
    expect(r.error).toBeNull();
  });

  it("tiene exactamente 80 activos; el 81 se rechaza para el owner (API) y para el servidor", async () => {
    expect(await activos(org.id)).toBe(80);

    const porApi = await owner.db
      .from("products")
      .insert({ organization_id: org.id, category_id: org.categoryId, name: "tt-81-api", price_cents: 1 });
    const porServidor = await service
      .from("products")
      .insert({ organization_id: org.id, category_id: org.categoryId, name: "tt-81-servidor", price_cents: 1 });

    expect(porApi.error?.code).toBe(LIMIT_EXCEEDED);
    expect(porApi.error?.message).toBe("limit_exceeded:active_products");
    expect(porServidor.error?.code).toBe(LIMIT_EXCEEDED);
    expect(await activos(org.id)).toBe(80);
  });

  it("un plato inactivo se puede crear aunque se esté en el tope", async () => {
    const { error } = await owner.db
      .from("products")
      .insert({ organization_id: org.id, category_id: org.categoryId, name: "tt-inactivo", price_cents: 1, is_active: false });

    expect(error).toBeNull();
  });

  it("activar un plato inactivo en el tope se rechaza; desactivar otro libera el cupo", async () => {
    const inactivo = await service.from("products").select("id").eq("organization_id", org.id).eq("name", "tt-inactivo").single();
    const otroActivo = await service.from("products").select("id").eq("organization_id", org.id).eq("is_active", true).limit(1).single();
    const id = inactivo.data?.id as string;

    const bloqueado = await owner.db.from("products").update({ is_active: true }).eq("id", id);
    expect(bloqueado.error?.code).toBe(LIMIT_EXCEEDED);
    expect(bloqueado.error?.message).toBe("limit_exceeded:active_products");

    const desactivar = await owner.db.from("products").update({ is_active: false }).eq("id", otroActivo.data?.id as string);
    expect(desactivar.error).toBeNull(); // activo -> inactivo nunca se bloquea
    expect(await activos(org.id)).toBe(79);

    const activar = await owner.db.from("products").update({ is_active: true }).eq("id", id);
    expect(activar.error).toBeNull();
    expect(await activos(org.id)).toBe(80);

    // Queda en el tope otra vez: 80 activos y un plato inactivo (el que se desactivó para liberar el cupo).
    expect(await activos(org.id)).toBe(80);
  });

  it("editar un plato que ya está activo (precio, nombre) no consume cupo", async () => {
    const activo = await service.from("products").select("id").eq("organization_id", org.id).eq("is_active", true).limit(1).single();
    expect(await activos(org.id)).toBe(80);

    const { error } = await owner.db
      .from("products")
      .update({ price_cents: 4321, name: "tt-editado", is_active: true })
      .eq("id", activo.data?.id as string);

    expect(error).toBeNull();
  });

  it("el límite de otra organización no afecta a esta, ni al revés", async () => {
    const otra = await nuevaOrg("tt-lim-otra", "basic");

    const { error } = await owner.db
      .from("products")
      .insert({ organization_id: otra.id, category_id: otra.categoryId, name: "tt-primero", price_cents: 1 });

    expect(error).toBeNull(); // 'tt-lim-basico' está en 80/80 y no cuenta acá
    expect(await activos(org.id)).toBe(80);
  });
});

describe("platos activos: Pro (tope 200) y Premium (sin tope)", () => {
  it("Pro acepta 200 y rechaza el 201", async () => {
    const org = await nuevaOrg("tt-lim-pro", "pro");

    const lote = await insertProducts(service, org.id, org.categoryId, 200);
    expect(lote.error).toBeNull();

    const extra = await owner.db
      .from("products")
      .insert({ organization_id: org.id, category_id: org.categoryId, name: "tt-201", price_cents: 1 });
    expect(extra.error?.code).toBe(LIMIT_EXCEEDED);
    expect(await activos(org.id)).toBe(200);
  });

  it("un lote que supera el tope falla entero: no queda a medias", async () => {
    const org = await nuevaOrg("tt-lim-lote", "basic");

    const lote = await insertProducts(service, org.id, org.categoryId, 81);

    expect(lote.error?.code).toBe(LIMIT_EXCEEDED);
    expect(await activos(org.id)).toBe(0);
  });

  it("Premium no tiene tope", async () => {
    const org = await nuevaOrg("tt-lim-premium", "premium");

    const lote = await insertProducts(service, org.id, org.categoryId, 250);
    const extra = await owner.db
      .from("products")
      .insert({ organization_id: org.id, category_id: org.categoryId, name: "tt-251", price_cents: 1 });

    expect(lote.error).toBeNull();
    expect(extra.error).toBeNull();
    expect(await activos(org.id)).toBe(251);
  });
});

describe("el tope sale de la tabla plans", () => {
  it("cambiar max_active_products en la base cambia el comportamiento, sin tocar código", async () => {
    const org = await nuevaOrg("tt-lim-param", "basic");
    try {
      await service.from("plans").update({ max_active_products: 3 }).eq("code", "basic");
      const lote = await insertProducts(service, org.id, org.categoryId, 3);
      const cuarto = await owner.db
        .from("products")
        .insert({ organization_id: org.id, category_id: org.categoryId, name: "tt-4", price_cents: 1 });

      expect(lote.error).toBeNull();
      expect(cuarto.error?.code).toBe(LIMIT_EXCEEDED);

      await service.from("plans").update({ max_active_products: null }).eq("code", "basic");
      const sinTope = await owner.db
        .from("products")
        .insert({ organization_id: org.id, category_id: org.categoryId, name: "tt-4", price_cents: 1 });
      expect(sinTope.error).toBeNull();
    } finally {
      await service.from("plans").update({ max_active_products: 80 }).eq("code", "basic");
    }
    const restaurado = await service.from("plans").select("max_active_products").eq("code", "basic").single();
    expect(restaurado.data?.max_active_products).toBe(80);
  });
});

describe("bajar de plan (downgrade)", () => {
  it("de Pro a Básico con 150 activos: no se borra nada; solo se bloquea crear y activar más", async () => {
    const org = await nuevaOrg("tt-lim-downgrade", "pro");
    expect((await insertProducts(service, org.id, org.categoryId, 150)).error).toBeNull();
    expect((await insertProducts(service, org.id, org.categoryId, 5, false, "tt-inactivo")).error).toBeNull();

    await setSubscription(service, org.id, { plan: "basic" });

    expect(await activos(org.id)).toBe(150); // nada se desactivó ni se borró
    const total = await service.from("products").select("id", { count: "exact", head: true }).eq("organization_id", org.id);
    expect(total.count).toBe(155);

    const unActivo = await service.from("products").select("id").eq("organization_id", org.id).eq("is_active", true).limit(1).single();
    const unInactivo = await service.from("products").select("id").eq("organization_id", org.id).eq("is_active", false).limit(1).single();

    // Seguir editando lo existente funciona, incluso estando por encima del tope.
    const editar = await owner.db.from("products").update({ price_cents: 777 }).eq("id", unActivo.data?.id as string);
    expect(editar.error).toBeNull();

    // Crear o activar uno más, no.
    const crear = await owner.db
      .from("products")
      .insert({ organization_id: org.id, category_id: org.categoryId, name: "tt-nuevo", price_cents: 1 });
    const activar = await owner.db.from("products").update({ is_active: true }).eq("id", unInactivo.data?.id as string);
    expect(crear.error?.code).toBe(LIMIT_EXCEEDED);
    expect(activar.error?.code).toBe(LIMIT_EXCEEDED);

    // Desactivar siempre se puede; hay que bajar de 80 para volver a activar.
    const ids = await service.from("products").select("id").eq("organization_id", org.id).eq("is_active", true).limit(71);
    for (const fila of ids.data ?? []) await owner.db.from("products").update({ is_active: false }).eq("id", fila.id);
    expect(await activos(org.id)).toBe(79);

    const activarAhora = await owner.db.from("products").update({ is_active: true }).eq("id", unInactivo.data?.id as string);
    expect(activarAhora.error).toBeNull();
    expect(await activos(org.id)).toBe(80);
    const otroInactivo = await service.from("products").select("id").eq("organization_id", org.id).eq("is_active", false).limit(1).single();
    const otraVez = await owner.db.from("products").update({ is_active: true }).eq("id", otroInactivo.data?.id as string);
    expect(otraVez.error?.code).toBe(LIMIT_EXCEEDED);
  });
});

describe("sucursales", () => {
  const sucursal = (orgId: string, n: number) => ({ organization_id: orgId, slug: `tt-suc-${n}`, name: `Sucursal ${n}` });

  it("Básico admite 1; la segunda se rechaza", async () => {
    const org = await nuevaOrg("tt-lim-suc-basico", "basic");

    const primera = await service.from("branches").insert(sucursal(org.id, 1));
    const segunda = await service.from("branches").insert(sucursal(org.id, 2));

    expect(primera.error).toBeNull();
    expect(segunda.error?.code).toBe(LIMIT_EXCEEDED);
    expect(segunda.error?.message).toBe("limit_exceeded:branches");
  });

  it("Pro admite 2; la tercera se rechaza; borrar una libera el cupo", async () => {
    const org = await nuevaOrg("tt-lim-suc-pro", "pro");

    expect((await service.from("branches").insert(sucursal(org.id, 1))).error).toBeNull();
    expect((await service.from("branches").insert(sucursal(org.id, 2))).error).toBeNull();
    expect((await service.from("branches").insert(sucursal(org.id, 3))).error?.code).toBe(LIMIT_EXCEEDED);

    await service.from("branches").delete().eq("organization_id", org.id).eq("slug", "tt-suc-2");
    expect((await service.from("branches").insert(sucursal(org.id, 3))).error).toBeNull();
  });

  it("Premium no tiene tope", async () => {
    const org = await nuevaOrg("tt-lim-suc-premium", "premium");

    const lote = await service.from("branches").insert([1, 2, 3, 4, 5].map((n) => sucursal(org.id, n)));

    expect(lote.error).toBeNull();
  });

  it("el límite de mesas por sucursal queda disponible para «Mesas y QR»", async () => {
    const { sql } = await import("./helpers");
    const org = await nuevaOrg("tt-lim-mesas", "pro");

    expect(sql(`select private.org_limit('${org.id}', 'tables_per_branch')`)[0][0]).toBe("50");
    await setSubscription(service, org.id, { plan: "premium" });
    expect(sql(`select coalesce(private.org_limit('${org.id}', 'tables_per_branch')::text, 'sin-limite')`)[0][0]).toBe("sin-limite");
  });
});

describe("el tope no filtra información a quien no es de la organización", () => {
  // Los triggers BEFORE corren antes del WITH CHECK de RLS: sin una comprobación previa de pertenencia,
  // un tercero podría provocar 53400 contra una organización al tope y leer su límite y su uso en el detalle.
  let llena: { id: string; categoryId: string };
  let ajeno: TestUser;
  let deOtraOrg: TestUser;

  beforeAll(async () => {
    llena = await nuevaOrg("tt-lim-fuga", "basic");
    expect((await insertProducts(service, llena.id, llena.categoryId, 80)).error).toBeNull();
    expect((await insertProducts(service, llena.id, llena.categoryId, 1, false, "tt-dormido")).error).toBeNull();
    ajeno = await createUser(service, "fuga-ajeno");
    deOtraOrg = await createUser(service, "fuga-otra-org");
    const otra = await createOrg(service, "tt-lim-fuga-otra", "basic");
    orgs.push(otra);
    await addMembership(service, deOtraOrg, otra, "owner");
  });

  afterAll(async () => {
    await Promise.all([ajeno, deOtraOrg].map((u) => deleteUser(service, u)));
  });

  const sinPistas = (error: { code?: string; message: string; details?: string | null; hint?: string | null } | null) => {
    expect(error?.code).toBe("42501");
    const todo = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ");
    expect(todo).not.toMatch(/limit|active|53400|cupo|plan/i);
  };

  it.each([
    ["un usuario sin membresía", () => ajeno],
    ["el owner de otra organización", () => deOtraOrg],
  ])("%s que inserta un plato activo en una organización al tope recibe 42501 sin datos del tope", async (_label, getUser) => {
    const { error } = await getUser()
      .db.from("products")
      .insert({ organization_id: llena.id, category_id: llena.categoryId, name: "tt-intruso", price_cents: 1 });

    sinPistas(error);
  });

  it("tampoco filtra al insertar una sucursal o al activar un plato ajeno", async () => {
    for (const usuario of [ajeno, deOtraOrg]) {
      const sucursal = await usuario.db
        .from("branches")
        .insert({ organization_id: llena.id, slug: "tt-intruso", name: "tt-intruso" });
      sinPistas(sucursal.error);

      const dormido = await service.from("products").select("id").eq("organization_id", llena.id).eq("is_active", false).single();
      const activar = await usuario.db.from("products").update({ is_active: true }).eq("id", dormido.data?.id as string).select("id");
      expect(activar.error).toBeNull(); // RLS oculta la fila: 0 filas, sin error ni pistas
      expect(activar.data).toEqual([]);
    }
  });

  it("el personal de la propia organización sí recibe el motivo (con el tope)", async () => {
    const { error } = await owner.db
      .from("products")
      .insert({ organization_id: llena.id, category_id: llena.categoryId, name: "tt-propio", price_cents: 1 });

    expect(error?.code).toBe("53400");
    expect(error?.message).toBe("limit_exceeded:active_products");
  });

  it("el servidor sigue sujeto al tope", async () => {
    const { error } = await service
      .from("products")
      .insert({ organization_id: llena.id, category_id: llena.categoryId, name: "tt-servidor", price_cents: 1 });

    expect(error?.code).toBe("53400");
  });
});

describe("concurrencia", () => {
  it("con 79 activos, diez altas simultáneas dejan exactamente 80", async () => {
    const org = await nuevaOrg("tt-lim-concurrencia", "basic");
    expect((await insertProducts(service, org.id, org.categoryId, 79)).error).toBeNull();

    const resultados = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        service
          .from("products")
          .insert({ organization_id: org.id, category_id: org.categoryId, name: `tt-carrera-${i}`, price_cents: 1 }),
      ),
    );

    expect(resultados.filter((r) => r.error === null)).toHaveLength(1);
    expect(resultados.filter((r) => r.error?.code === LIMIT_EXCEEDED)).toHaveLength(9);
    expect(await activos(org.id)).toBe(80);
  });

  it("con 79 activos y 10 inactivos, diez activaciones simultáneas dejan exactamente 80", async () => {
    const org = await nuevaOrg("tt-lim-concurrencia-2", "basic");
    expect((await insertProducts(service, org.id, org.categoryId, 79)).error).toBeNull();
    expect((await insertProducts(service, org.id, org.categoryId, 10, false, "tt-dormido")).error).toBeNull();
    const dormidos = await service.from("products").select("id").eq("organization_id", org.id).eq("is_active", false);

    const resultados = await Promise.all(
      (dormidos.data ?? []).map((fila) => service.from("products").update({ is_active: true }).eq("id", fila.id)),
    );

    expect(resultados.filter((r) => r.error === null)).toHaveLength(1);
    expect(await activos(org.id)).toBe(80);
  });
});
