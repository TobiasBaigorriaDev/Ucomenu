import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Pruebas de integración contra el Supabase LOCAL con los datos de supabase/seed.sql.
 * Requisitos: `pnpm db:start` y `pnpm db:reset`. Ver .env.example.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Ids de supabase/seed.sql
const ORG_CAFE = "10000000-0000-4000-8000-000000000001";
const ORG_PARRILLA = "20000000-0000-4000-8000-000000000001";
const ORG_INACTIVA = "30000000-0000-4000-8000-000000000001";
const CATEGORY_CAFETERIA = "12000000-0000-4000-8000-000000000001";
const CATEGORY_PARRILLA = "22000000-0000-4000-8000-000000000001";
const PRODUCT_INACTIVO = "13000000-0000-4000-8000-000000000003";
const PRODUCT_EN_CATEGORIA_INACTIVA = "13000000-0000-4000-8000-000000000005";
const PRODUCT_EN_ORG_INACTIVA = "33000000-0000-4000-8000-000000000001";

function client(key: string | undefined): SupabaseClient<Database> {
  if (!url || !key) {
    throw new Error("Faltan variables de entorno de Supabase. Copiá .env.example a .env.local y .env.test.local.");
  }
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

let anon: SupabaseClient<Database>;
let authenticated: SupabaseClient<Database>;
let service: SupabaseClient<Database>;
let authenticatedUserId: string | undefined;

// Usuario con sesión pero SIN membresía en ninguna organización: debe ver y poder lo mismo que anon.
beforeAll(async () => {
  anon = client(publishableKey);
  service = client(serviceKey);

  const email = `rls-sin-membresia-${Date.now()}@example.test`;
  const password = "contrasena-de-prueba-123";
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    throw new Error(`No se pudo crear el usuario de prueba: ${created.error?.message}`);
  }
  authenticatedUserId = created.data.user.id;

  authenticated = client(publishableKey);
  const signedIn = await authenticated.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`No se pudo iniciar sesión: ${signedIn.error.message}`);
});

afterAll(async () => {
  if (authenticatedUserId) await service.auth.admin.deleteUser(authenticatedUserId);
});

// Roles de la Data API que comparten las políticas públicas: cada prueba de lectura y escritura corre con ambos.
const roles = [
  ["anon", () => anon],
  ["authenticated", () => authenticated],
] as const;

describe.each(roles)("lectura pública (rol %s)", (_role, getClient) => {
  it("ve las organizaciones activas y no las inactivas", async () => {
    const { data, error } = await getClient().from("organizations").select("slug").order("slug");

    expect(error).toBeNull();
    expect(data?.map((o) => o.slug)).toEqual(["cafe-ejemplo", "parrilla-demo"]);
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

describe.each(roles)("escritura (rol %s): todo rechazado", (_role, getClient) => {
  // Filas VÁLIDAS (cumplen NOT NULL, CHECK y FK): así el único motivo posible de rechazo es el permiso.
  const inserts = {
    organizations: () => getClient().from("organizations").insert({ slug: "intruso", name: "intruso" }),
    branches: () =>
      getClient().from("branches").insert({ organization_id: ORG_CAFE, slug: "intruso", name: "intruso" }),
    categories: () => getClient().from("categories").insert({ organization_id: ORG_CAFE, name: "intruso" }),
    products: () =>
      getClient()
        .from("products")
        .insert({ organization_id: ORG_CAFE, category_id: CATEGORY_CAFETERIA, name: "intruso", price_cents: 100 }),
  };

  it.each(Object.keys(inserts) as (keyof typeof inserts)[])("no puede insertar una fila válida en %s", async (table) => {
    const { error } = await inserts[table]();

    expect(error?.code).toBe("42501"); // insufficient_privilege
  });

  it.each(["organizations", "branches", "categories", "products"] as const)("no puede modificar %s", async (table) => {
    const { error } = await getClient().from(table).update({ name: "hackeado" }).neq("name", "");

    expect(error?.code).toBe("42501");
  });

  it.each(["organizations", "branches", "categories", "products"] as const)("no puede borrar %s", async (table) => {
    const { error } = await getClient().from(table).delete().neq("name", "");

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

  it("acepta una sucursal con un slug de 64 caracteres", async () => {
    const { data, error } = await service
      .from("branches")
      .insert({ organization_id: ORG_CAFE, slug: slug64, name: "Slug largo" })
      .select("id")
      .single();

    expect(error).toBeNull();
    if (data) await service.from("branches").delete().eq("id", data.id);
  });

  it("rechaza una sucursal con un slug de 65 caracteres", async () => {
    const { error } = await service
      .from("branches")
      .insert({ organization_id: ORG_CAFE, slug: slug65, name: "Slug demasiado largo" });

    expect(error?.code).toBe("23514"); // check_violation
    expect(error?.message).toContain("branches_slug_max_length");
  });
});
