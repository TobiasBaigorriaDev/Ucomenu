import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  CATEGORY_CAFETERIA,
  CATEGORY_PARRILLA,
  createUser,
  deleteUser,
  ORG_CAFE,
  ORG_INACTIVA,
  ORG_MOROSA,
  ORG_PARRILLA,
  PRODUCT_EN_CATEGORIA_INACTIVA,
  PRODUCT_EN_ORG_INACTIVA,
  PRODUCT_EN_ORG_MOROSA,
  PRODUCT_INACTIVO,
  serviceClient,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * Lectura pública y escritura del rol anónimo, con los datos de supabase/seed.sql.
 * El aislamiento entre miembros de organizaciones está en tenancy.rls.test.ts.
 */

let anon: Db;
let service: Db;
let sinMembresia: TestUser | undefined;

// Usuario con sesión pero SIN membresía en ninguna organización: ve lo mismo que anon.
beforeAll(async () => {
  anon = anonClient();
  service = serviceClient();
  sinMembresia = await createUser(service, "sin-membresia");
});

afterAll(async () => {
  await deleteUser(service, sinMembresia);
});

// Roles de la API que comparten la lectura pública.
const roles = [
  ["anon", () => anon],
  ["authenticated sin membresía", () => (sinMembresia as TestUser).db],
] as const;

describe.each(roles)("lectura pública (rol %s)", (_role, getClient) => {
  it("ve las organizaciones activas y no las inactivas", async () => {
    const { data, error } = await getClient().from("organizations").select("slug").order("slug");

    expect(error).toBeNull();
    // La organización morosa (suspendida) conserva su fila pública, pero no publica su carta.
    // Se ignoran las organizaciones temporales de otras pruebas (`tt-*`, `e2e-*`): si un *worker* de otro archivo se cayó
    // a mitad de camino, sus restos no tienen por qué romper una prueba sobre las organizaciones del seed.
    const delSeed = data?.map((o) => o.slug).filter((slug) => !slug.startsWith("tt-") && !slug.startsWith("e2e-"));
    expect(delSeed).toEqual(["cafe-ejemplo", "parrilla-demo", "resto-moroso"]);
  });

  it("ve solo los platos activos de categorías activas en organizaciones activas", async () => {
    const { data, error } = await getClient()
      .from("products")
      .select("name")
      .eq("organization_id", ORG_CAFE)
      .order("name");

    expect(error).toBeNull();
    expect(data?.map((p) => p.name)).toEqual(["Espresso", "Flat white", "Medialuna de manteca"]);
  });

  it("no ve las categorías inactivas", async () => {
    const { data, error } = await getClient()
      .from("categories")
      .select("name")
      .eq("organization_id", ORG_CAFE)
      .order("name");

    expect(error).toBeNull();
    expect(data?.map((c) => c.name)).toEqual(["Cafetería", "Pastelería"]);
  });

  it.each([
    ["un plato inactivo", PRODUCT_INACTIVO],
    ["un plato activo dentro de una categoría inactiva", PRODUCT_EN_CATEGORIA_INACTIVA],
    ["un plato de una organización inactiva", PRODUCT_EN_ORG_INACTIVA],
    ["un plato de una organización suspendida por mora", PRODUCT_EN_ORG_MOROSA],
  ])("no puede leer %s ni siquiera por id", async (_label, id) => {
    const { data, error } = await getClient().from("products").select("id").eq("id", id).maybeSingle();

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("no ve sucursales ni categorías de una organización inactiva", async () => {
    const branches = await getClient().from("branches").select("id").eq("organization_id", ORG_INACTIVA);
    const categories = await getClient().from("categories").select("id").eq("organization_id", ORG_INACTIVA);

    expect(branches.error).toBeNull();
    expect(branches.data).toEqual([]);
    expect(categories.error).toBeNull();
    expect(categories.data).toEqual([]);
  });

  it("no ve sucursales, categorías ni platos de una organización suspendida por mora", async () => {
    const branches = await getClient().from("branches").select("id").eq("organization_id", ORG_MOROSA);
    const categories = await getClient().from("categories").select("id").eq("organization_id", ORG_MOROSA);
    const products = await getClient().from("products").select("id").eq("organization_id", ORG_MOROSA);

    for (const r of [branches, categories, products]) {
      expect(r.error).toBeNull();
      expect(r.data).toEqual([]);
    }
  });

  it("al filtrar por organización no aparece ningún plato de otra", async () => {
    const { data, error } = await getClient()
      .from("products")
      .select("name, organization_id")
      .eq("organization_id", ORG_PARRILLA);

    expect(error).toBeNull();
    expect(data?.map((p) => p.name).sort()).toEqual(["Entraña", "Provoleta"]);
    expect(data?.every((p) => p.organization_id === ORG_PARRILLA)).toBe(true);
  });
});

describe("escritura (rol anon): todo rechazado", () => {
  // Filas VÁLIDAS (cumplen NOT NULL, CHECK y FK): así el único motivo posible de rechazo es el permiso.
  const inserts = {
    organizations: () => anon.from("organizations").insert({ slug: "intruso", name: "intruso" }),
    branches: () =>
      anon.from("branches").insert({ organization_id: ORG_CAFE, slug: "intruso", name: "intruso" }),
    categories: () => anon.from("categories").insert({ organization_id: ORG_CAFE, name: "intruso" }),
    products: () =>
      anon
        .from("products")
        .insert({ organization_id: ORG_CAFE, category_id: CATEGORY_CAFETERIA, name: "intruso", price_cents: 100 }),
  };

  it.each(Object.keys(inserts) as (keyof typeof inserts)[])("no puede insertar una fila válida en %s", async (table) => {
    const { error } = await inserts[table]();

    expect(error?.code).toBe("42501"); // insufficient_privilege
  });

  it.each(["organizations", "branches", "categories", "products"] as const)("no puede modificar %s", async (table) => {
    const { error } = await anon.from(table).update({ name: "hackeado" }).neq("name", "");

    expect(error?.code).toBe("42501");
  });

  it.each(["organizations", "branches", "categories", "products"] as const)("no puede borrar %s", async (table) => {
    const { error } = await anon.from(table).delete().neq("name", "");

    expect(error?.code).toBe("42501");
  });

  it("después de los intentos, los datos siguen intactos", async () => {
    const { data, error } = await service.from("products").select("name").eq("organization_id", ORG_CAFE);

    expect(error).toBeNull();
    expect(data).toHaveLength(5); // 3 publicables + 2 ocultos
    expect(data?.some((p) => p.name === "hackeado" || p.name === "intruso")).toBe(false);
  });
});

describe("integridad entre organizaciones (a nivel de base)", () => {
  it("un plato no puede apuntar a una categoría de otra organización", async () => {
    const { error } = await service.from("products").insert({
      organization_id: ORG_PARRILLA,
      category_id: CATEGORY_CAFETERIA,
      name: "Plato cruzado",
      price_cents: 1000,
    });

    expect(error?.code).toBe("23503"); // foreign_key_violation
  });

  it("el mismo plato sí es válido dentro de su propia organización", async () => {
    const { data, error } = await service
      .from("products")
      .insert({ organization_id: ORG_PARRILLA, category_id: CATEGORY_PARRILLA, name: "Plato propio", price_cents: 1000 })
      .select("id")
      .single();

    expect(error).toBeNull();
    if (data) await service.from("products").delete().eq("id", data.id);
  });

  it("rechaza precios negativos", async () => {
    const { error } = await service.from("products").insert({
      organization_id: ORG_CAFE,
      category_id: CATEGORY_CAFETERIA,
      name: "Precio negativo",
      price_cents: -1,
    });

    expect(error?.code).toBe("23514"); // check_violation
  });
});

describe("largo máximo de slug (64 caracteres)", () => {
  const slug64 = "a".repeat(64);
  const slug65 = "a".repeat(65);

  it("acepta una organización con un slug de 64 caracteres", async () => {
    const { data, error } = await service
      .from("organizations")
      .insert({ slug: slug64, name: "Slug largo" })
      .select("id")
      .single();

    expect(error).toBeNull();
    if (data) await service.from("organizations").delete().eq("id", data.id);
  });

  it("rechaza una organización con un slug de 65 caracteres", async () => {
    const { error } = await service.from("organizations").insert({ slug: slug65, name: "Slug demasiado largo" });

    expect(error?.code).toBe("23514"); // check_violation
    expect(error?.message).toContain("organizations_slug_max_length");
  });

  describe("sucursales (en una organización propia: el plan Básico admite una sola)", () => {
    let orgId: string;

    beforeAll(async () => {
      const org = await service.from("organizations").insert({ slug: "tt-slug-sucursales", name: "tt-slug" }).select("id").single();
      if (org.error) throw new Error(org.error.message);
      orgId = org.data.id;
    });

    afterAll(async () => {
      await service.from("organizations").delete().eq("id", orgId);
    });

    it("acepta una sucursal con un slug de 64 caracteres", async () => {
      const { error } = await service.from("branches").insert({ organization_id: orgId, slug: slug64, name: "Slug largo" });

      expect(error).toBeNull();
      await service.from("branches").delete().eq("organization_id", orgId);
    });

    it("rechaza una sucursal con un slug de 65 caracteres", async () => {
      const { error } = await service
        .from("branches")
        .insert({ organization_id: orgId, slug: slug65, name: "Slug demasiado largo" });

      expect(error?.code).toBe("23514"); // check_violation
      expect(error?.message).toContain("branches_slug_max_length");
    });
  });
});
