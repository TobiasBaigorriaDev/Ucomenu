import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  apiKey,
  apiUrl,
  BRANCH_CAFE,
  BRANCH_PARRILLA,
  CATEGORY_CAFETERIA,
  CATEGORY_PARRILLA,
  CATEGORY_TEMPORADA_INACTIVA,
  createUser,
  deleteUser,
  ORG_CAFE,
  ORG_PARRILLA,
  PRODUCT_ESPRESSO,
  serviceClient,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * Núcleo multi-tenant (nivel C): aislamiento entre organizaciones, roles y membresías.
 * Cada prueba usa usuarios reales de Supabase Auth con membresías creadas por el servidor.
 * Ver agile/cambios/nucleo-multi-tenant.md.
 *
 * Organización A = Café Ejemplo (ORG_CAFE) · Organización B = Parrilla Demo (ORG_PARRILLA).
 * Las filas que crean las pruebas llevan el prefijo "tt-" y se borran al terminar.
 */

const PREFIX = "tt-";
const INSUFFICIENT_PRIVILEGE = "42501";
const FOREIGN_KEY_VIOLATION = "23503";

let service: Db;
let anon: Db;
let ownerA: TestUser;
let staffA: TestUser;
let ownerB: TestUser;
let sinMembresia: TestUser;

// Filas privadas (no publicables) de B: nadie de A debe poder verlas.
let ocultoCategoriaB: string;
let ocultoProductoB: string;

async function limpiar() {
  await service.from("products").delete().like("name", `${PREFIX}%`);
  await service.from("categories").delete().like("name", `${PREFIX}%`);
}

async function membresia(user: TestUser, organizationId: string, role: "owner" | "staff") {
  const { error } = await service.from("memberships").insert({ user_id: user.id, organization_id: organizationId, role });
  if (error) throw new Error(`No se pudo crear la membresía: ${error.message}`);
}

beforeAll(async () => {
  anon = anonClient();
  service = serviceClient();
  await limpiar();

  [ownerA, staffA, ownerB, sinMembresia] = await Promise.all([
    createUser(service, "owner-a"),
    createUser(service, "staff-a"),
    createUser(service, "owner-b"),
    createUser(service, "sin-membresia"),
  ]);
  await membresia(ownerA, ORG_CAFE, "owner");
  await membresia(staffA, ORG_CAFE, "staff");
  await membresia(ownerB, ORG_PARRILLA, "owner");

  const cat = await service
    .from("categories")
    .insert({ organization_id: ORG_PARRILLA, name: `${PREFIX}categoria-oculta-b`, is_active: false })
    .select("id")
    .single();
  if (cat.error) throw new Error(cat.error.message);
  ocultoCategoriaB = cat.data.id;

  const prod = await service
    .from("products")
    .insert({
      organization_id: ORG_PARRILLA,
      category_id: CATEGORY_PARRILLA,
      name: `${PREFIX}plato-oculto-b`,
      price_cents: 5000,
      is_active: false,
    })
    .select("id")
    .single();
  if (prod.error) throw new Error(prod.error.message);
  ocultoProductoB = prod.data.id;
});

afterAll(async () => {
  await limpiar();
  // Los usuarios se borran con sus membresías (ON DELETE CASCADE).
  await Promise.all([ownerA, staffA, ownerB, sinMembresia].map((u) => deleteUser(service, u)));
});

const miembrosDeA = [
  ["owner de A", () => ownerA],
  ["staff de A", () => staffA],
] as const;

describe.each(miembrosDeA)("lectura del %s", (_label, getUser) => {
  it("ve todo lo de su organización, incluido lo inactivo", async () => {
    const db = getUser().db;
    const categorias = await db.from("categories").select("name").eq("organization_id", ORG_CAFE).order("name");
    const platos = await db.from("products").select("name").eq("organization_id", ORG_CAFE).order("name");

    expect(categorias.error).toBeNull();
    expect(categorias.data?.map((c) => c.name)).toEqual(["Cafetería", "Pastelería", "Temporada"]);
    expect(platos.error).toBeNull();
    expect(platos.data).toHaveLength(5);
  });

  it("no ve lo privado de otra organización", async () => {
    const db = getUser().db;
    const categorias = await db.from("categories").select("id").eq("id", ocultoCategoriaB);
    const platos = await db.from("products").select("id").eq("id", ocultoProductoB);

    expect(categorias.error).toBeNull();
    expect(categorias.data).toEqual([]);
    expect(platos.error).toBeNull();
    expect(platos.data).toEqual([]);
  });
});

describe("lectura del owner de B", () => {
  it("ve lo privado de su organización", async () => {
    const platos = await ownerB.db.from("products").select("id").eq("id", ocultoProductoB);

    expect(platos.error).toBeNull();
    expect(platos.data).toHaveLength(1);
  });

  it("no ve lo inactivo de A", async () => {
    const { data, error } = await ownerB.db.from("categories").select("id").eq("id", CATEGORY_TEMPORADA_INACTIVA);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe("lectura del usuario sin membresía", () => {
  it("no ve lo inactivo de ninguna organización", async () => {
    const a = await sinMembresia.db.from("categories").select("id").eq("id", CATEGORY_TEMPORADA_INACTIVA);
    const b = await sinMembresia.db.from("products").select("id").eq("id", ocultoProductoB);

    expect(a.data).toEqual([]);
    expect(b.data).toEqual([]);
  });
});

describe("escritura del usuario autenticado sin membresía", () => {
  it("no puede insertar en ninguna tabla de negocio, de A ni de B", async () => {
    const db = sinMembresia.db;
    for (const org of [ORG_CAFE, ORG_PARRILLA]) {
      const categoria = await db.from("categories").insert({ organization_id: org, name: `${PREFIX}sin-membresia` });
      const plato = await db.from("products").insert({
        organization_id: org,
        category_id: org === ORG_CAFE ? CATEGORY_CAFETERIA : CATEGORY_PARRILLA,
        name: `${PREFIX}sin-membresia`,
        price_cents: 1,
      });
      expect(categoria.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(plato.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it("no modifica ni borra nada (0 filas) y los datos quedan intactos", async () => {
    const db = sinMembresia.db;
    const tablas = ["organizations", "branches", "categories", "products"] as const;
    const antes = await Promise.all(tablas.map((t) => service.from(t).select("*").order("id")));

    const resultados = [];
    for (const t of tablas) {
      resultados.push(await db.from(t).update({ name: "hackeado" }).neq("name", "").select("id"));
      resultados.push(await db.from(t).delete().neq("name", "").select("id"));
    }

    // Sin permiso de DELETE (organizations, branches) falla con 42501; con permiso, RLS deja 0 filas.
    for (const r of resultados) {
      if (r.error) expect(r.error.code).toBe(INSUFFICIENT_PRIVILEGE);
      else expect(r.data).toEqual([]);
    }

    const despues = await Promise.all(tablas.map((t) => service.from(t).select("*").order("id")));
    expect(despues.map((r) => r.data)).toEqual(antes.map((r) => r.data));
  });
});

describe("membresías: quién ve qué", () => {
  it("el owner ve las de su organización y no las de otra", async () => {
    const { data, error } = await ownerA.db.from("memberships").select("user_id, organization_id, role");

    expect(error).toBeNull();
    expect(data?.every((m) => m.organization_id === ORG_CAFE)).toBe(true);
    expect(data?.map((m) => m.user_id).sort()).toEqual([ownerA.id, staffA.id].sort());
  });

  it("el staff ve solo la suya", async () => {
    const { data, error } = await staffA.db.from("memberships").select("user_id, role");

    expect(error).toBeNull();
    expect(data).toEqual([{ user_id: staffA.id, role: "staff" }]);
  });

  it("el usuario sin membresía no ve ninguna", async () => {
    const { data, error } = await sinMembresia.db.from("memberships").select("id");

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("anon no puede leer la tabla", async () => {
    const { error } = await anon.from("memberships").select("id");

    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe.each(miembrosDeA)("escritura del %s dentro de su organización", (_label, getUser) => {
  it("crea, edita (precio incluido) y borra categorías y platos", async () => {
    const db = getUser().db;

    const cat = await db
      .from("categories")
      .insert({ organization_id: ORG_CAFE, name: `${PREFIX}cat-${getUser().id}` })
      .select("id")
      .single();
    expect(cat.error).toBeNull();
    const categoryId = cat.data?.id as string;

    const prod = await db
      .from("products")
      .insert({ organization_id: ORG_CAFE, category_id: categoryId, name: `${PREFIX}plato`, price_cents: 100 })
      .select("id")
      .single();
    expect(prod.error).toBeNull();
    const productId = prod.data?.id as string;

    const precio = await db.from("products").update({ price_cents: 250, name: `${PREFIX}plato-2` }).eq("id", productId).select("price_cents");
    expect(precio.error).toBeNull();
    expect(precio.data).toEqual([{ price_cents: 250 }]);

    const renombrada = await db.from("categories").update({ name: `${PREFIX}cat-2`, is_active: false }).eq("id", categoryId).select("id");
    expect(renombrada.data).toHaveLength(1);

    const borrado = await db.from("products").delete().eq("id", productId).select("id");
    expect(borrado.data).toHaveLength(1);
    const categoriaBorrada = await db.from("categories").delete().eq("id", categoryId).select("id");
    expect(categoriaBorrada.data).toHaveLength(1);
  });

  it("no puede elegir el id de la fila que crea", async () => {
    const { error } = await getUser()
      .db.from("categories")
      .insert({ id: "99999999-0000-4000-8000-000000000001", organization_id: ORG_CAFE, name: `${PREFIX}con-id` });

    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe.each(miembrosDeA)("escritura del %s hacia otra organización (B)", (_label, getUser) => {
  it("no puede crear categorías ni platos en B", async () => {
    const db = getUser().db;
    const categoria = await db.from("categories").insert({ organization_id: ORG_PARRILLA, name: `${PREFIX}intruso` });
    const plato = await db
      .from("products")
      .insert({ organization_id: ORG_PARRILLA, category_id: CATEGORY_PARRILLA, name: `${PREFIX}intruso`, price_cents: 1 });

    expect(categoria.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(plato.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("no modifica ni borra nada de B (0 filas afectadas) y los datos quedan intactos", async () => {
    const db = getUser().db;
    const antes = await service.from("products").select("id, name, price_cents, is_active").eq("organization_id", ORG_PARRILLA).order("id");
    const categoriasAntes = await service.from("categories").select("id, name, is_active").eq("organization_id", ORG_PARRILLA).order("id");

    const actualizados = await db.from("products").update({ price_cents: 1, name: "hackeado" }).eq("organization_id", ORG_PARRILLA).select("id");
    const categoriasActualizadas = await db.from("categories").update({ name: "hackeado" }).eq("organization_id", ORG_PARRILLA).select("id");
    const borrados = await db.from("products").delete().eq("organization_id", ORG_PARRILLA).select("id");
    const categoriasBorradas = await db.from("categories").delete().eq("organization_id", ORG_PARRILLA).select("id");
    const org = await db.from("organizations").update({ name: "hackeado" }).eq("id", ORG_PARRILLA).select("id");
    const sucursal = await db.from("branches").update({ name: "hackeado" }).eq("id", BRANCH_PARRILLA).select("id");

    for (const r of [actualizados, categoriasActualizadas, borrados, categoriasBorradas, org, sucursal]) {
      expect(r.error).toBeNull();
      expect(r.data).toEqual([]);
    }

    const despues = await service.from("products").select("id, name, price_cents, is_active").eq("organization_id", ORG_PARRILLA).order("id");
    const categoriasDespues = await service.from("categories").select("id, name, is_active").eq("organization_id", ORG_PARRILLA).order("id");
    expect(despues.data).toEqual(antes.data);
    expect(categoriasDespues.data).toEqual(categoriasAntes.data);
  });

  it("no puede mover un plato propio a B ni cambiar el organization_id de una categoría", async () => {
    const db = getUser().db;
    const plato = await db.from("products").update({ organization_id: ORG_PARRILLA }).eq("id", PRODUCT_ESPRESSO);
    const categoria = await db.from("categories").update({ organization_id: ORG_PARRILLA }).eq("id", CATEGORY_CAFETERIA);

    expect(plato.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(categoria.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("no puede crear un plato propio dentro de una categoría de B", async () => {
    const { error } = await getUser()
      .db.from("products")
      .insert({ organization_id: ORG_CAFE, category_id: CATEGORY_PARRILLA, name: `${PREFIX}cruzado`, price_cents: 1 });

    expect(error?.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("no puede cambiar su plato a una categoría de B", async () => {
    const { error } = await getUser().db.from("products").update({ category_id: CATEGORY_PARRILLA }).eq("id", PRODUCT_ESPRESSO);

    expect(error?.code).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe("usuario miembro de dos organizaciones", () => {
  // Con RLS solo no alcanza: un miembro de A y de B pasaría el WITH CHECK al mover filas de una a otra.
  // La barrera es el permiso por columna: organization_id no se puede actualizar por la API.
  it("no puede mover platos ni categorías entre sus organizaciones", async () => {
    const doble = await createUser(service, "doble");
    const creada = await service
      .from("categories")
      .insert({ organization_id: ORG_CAFE, name: `${PREFIX}mover` })
      .select("id")
      .single();
    expect(creada.error).toBeNull();
    try {
      await membresia(doble, ORG_CAFE, "staff");
      await membresia(doble, ORG_PARRILLA, "staff");

      const plato = await doble.db
        .from("products")
        .update({ organization_id: ORG_PARRILLA, category_id: CATEGORY_PARRILLA })
        .eq("id", PRODUCT_ESPRESSO);
      const categoria = await doble.db
        .from("categories")
        .update({ organization_id: ORG_PARRILLA })
        .eq("id", creada.data?.id as string);

      expect(plato.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(categoria.error?.code).toBe(INSUFFICIENT_PRIVILEGE);

      const espresso = await service.from("products").select("organization_id").eq("id", PRODUCT_ESPRESSO).single();
      expect(espresso.data?.organization_id).toBe(ORG_CAFE);
    } finally {
      await deleteUser(service, doble);
    }
  });
});

describe("organizaciones y sucursales", () => {
  it("el staff no puede cambiar la organización ni las sucursales (0 filas)", async () => {
    const org = await staffA.db.from("organizations").update({ name: "hackeado" }).eq("id", ORG_CAFE).select("id");
    const sucursal = await staffA.db.from("branches").update({ name: "hackeado" }).eq("id", BRANCH_CAFE).select("id");

    expect(org.error).toBeNull();
    expect(org.data).toEqual([]);
    expect(sucursal.error).toBeNull();
    expect(sucursal.data).toEqual([]);
  });

  it("el owner puede cambiar el nombre y se restaura", async () => {
    const original = await service.from("organizations").select("name").eq("id", ORG_CAFE).single();
    const org = await ownerA.db.from("organizations").update({ name: `${PREFIX}Nuevo nombre` }).eq("id", ORG_CAFE).select("name");
    const sucursal = await ownerA.db.from("branches").update({ name: `${PREFIX}Nueva sucursal` }).eq("id", BRANCH_CAFE).select("name");

    expect(org.data).toEqual([{ name: `${PREFIX}Nuevo nombre` }]);
    expect(sucursal.data).toEqual([{ name: `${PREFIX}Nueva sucursal` }]);

    await service.from("organizations").update({ name: original.data?.name as string }).eq("id", ORG_CAFE);
    await service.from("branches").update({ name: "Centro" }).eq("id", BRANCH_CAFE);
  });

  it("el owner no puede cambiar slug, is_active ni organization_id", async () => {
    const slug = await ownerA.db.from("organizations").update({ slug: "otro" }).eq("id", ORG_CAFE);
    const activa = await ownerA.db.from("organizations").update({ is_active: false }).eq("id", ORG_CAFE);
    const slugSucursal = await ownerA.db.from("branches").update({ slug: "otra" }).eq("id", BRANCH_CAFE);
    const mover = await ownerA.db.from("branches").update({ organization_id: ORG_PARRILLA }).eq("id", BRANCH_CAFE);

    for (const r of [slug, activa, slugSucursal, mover]) expect(r.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("nadie crea ni borra organizaciones o sucursales por la API", async () => {
    for (const user of [ownerA, staffA, sinMembresia]) {
      const crearOrg = await user.db.from("organizations").insert({ slug: "tt-nueva", name: "tt-nueva" });
      const crearSucursal = await user.db
        .from("branches")
        .insert({ organization_id: ORG_CAFE, slug: "tt-nueva", name: "tt-nueva" });
      const borrarOrg = await user.db.from("organizations").delete().eq("id", ORG_CAFE);
      const borrarSucursal = await user.db.from("branches").delete().eq("id", BRANCH_CAFE);

      for (const r of [crearOrg, crearSucursal, borrarOrg, borrarSucursal]) {
        expect(r.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
      }
    }
    const intactas = await service.from("branches").select("id").eq("id", BRANCH_CAFE);
    expect(intactas.data).toHaveLength(1);
  });
});

describe("membresías: ninguna escritura por la API", () => {
  it("nadie puede crear, elevar ni borrar membresías", async () => {
    const intentos: [string, TestUser, () => PromiseLike<{ error: { code: string } | null }>][] = [
      ["staff se hace owner (insert)", staffA, () => staffA.db.from("memberships").insert({ user_id: staffA.id, organization_id: ORG_CAFE, role: "owner" })],
      ["staff se eleva (update)", staffA, () => staffA.db.from("memberships").update({ role: "owner" }).eq("user_id", staffA.id)],
      ["staff se borra", staffA, () => staffA.db.from("memberships").delete().eq("user_id", staffA.id)],
      ["owner agrega a un tercero", ownerA, () => ownerA.db.from("memberships").insert({ user_id: sinMembresia.id, organization_id: ORG_CAFE, role: "staff" })],
      ["owner de A se agrega a B", ownerA, () => ownerA.db.from("memberships").insert({ user_id: ownerA.id, organization_id: ORG_PARRILLA, role: "owner" })],
      ["owner cambia el rol de su staff", ownerA, () => ownerA.db.from("memberships").update({ role: "owner" }).eq("user_id", staffA.id)],
      ["owner borra a su staff", ownerA, () => ownerA.db.from("memberships").delete().eq("user_id", staffA.id)],
      ["sin membresía se hace owner de B", sinMembresia, () => sinMembresia.db.from("memberships").insert({ user_id: sinMembresia.id, organization_id: ORG_PARRILLA, role: "owner" })],
    ];

    for (const [, , run] of intentos) {
      const { error } = await run();
      expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    }

    const { data } = await service.from("memberships").select("user_id, organization_id, role").order("user_id");
    const propias = data?.filter((m) => [ownerA.id, staffA.id, ownerB.id, sinMembresia.id].includes(m.user_id));
    expect(propias?.map((m) => `${m.role}@${m.organization_id}`).sort()).toEqual(
      [`owner@${ORG_CAFE}`, `staff@${ORG_CAFE}`, `owner@${ORG_PARRILLA}`].sort(),
    );
  });
});

describe("la autorización no sale del JWT ni de user_metadata", () => {
  it("un staff que se declara owner de B en su metadata sigue sin poder tocar B", async () => {
    const actualizado = await staffA.db.auth.updateUser({ data: { role: "owner", organization_id: ORG_PARRILLA } });
    expect(actualizado.error).toBeNull();
    const renovado = await staffA.db.auth.refreshSession(); // el nuevo token ya trae la metadata
    expect(renovado.error).toBeNull();
    expect(renovado.data.user?.user_metadata).toMatchObject({ role: "owner", organization_id: ORG_PARRILLA });

    const plato = await staffA.db.from("products").update({ price_cents: 1 }).eq("organization_id", ORG_PARRILLA).select("id");
    const categoria = await staffA.db.from("categories").insert({ organization_id: ORG_PARRILLA, name: `${PREFIX}metadata` });
    const oculto = await staffA.db.from("products").select("id").eq("id", ocultoProductoB);

    expect(plato.data).toEqual([]);
    expect(categoria.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(oculto.data).toEqual([]);
  });
});

describe("revocación inmediata", () => {
  it("al quitar la membresía, la sesión vigente pierde el acceso en el siguiente pedido", async () => {
    const temporal = await createUser(service, "temporal");
    try {
      await membresia(temporal, ORG_CAFE, "staff");
      const antes = await temporal.db.from("categories").select("id").eq("id", CATEGORY_TEMPORADA_INACTIVA);
      expect(antes.data).toHaveLength(1);

      await service.from("memberships").delete().eq("user_id", temporal.id);

      const despues = await temporal.db.from("categories").select("id").eq("id", CATEGORY_TEMPORADA_INACTIVA);
      const escritura = await temporal.db.from("categories").insert({ organization_id: ORG_CAFE, name: `${PREFIX}revocado` });
      expect(despues.data).toEqual([]);
      expect(escritura.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    } finally {
      await deleteUser(service, temporal);
    }
  });
});

describe("funciones auxiliares de autorización", () => {
  async function llamar(user: TestUser | undefined, schema: "private" | "public") {
    const token = user ? (await user.db.auth.getSession()).data.session?.access_token : undefined;
    const response = await fetch(`${apiUrl}/rest/v1/rpc/is_org_member`, {
      method: "POST",
      headers: {
        apikey: apiKey as string,
        authorization: `Bearer ${token ?? apiKey}`,
        "content-type": "application/json",
        "content-profile": schema,
      },
      body: JSON.stringify({ org_id: ORG_CAFE }),
    });
    return { status: response.status, body: (await response.json()) as { code?: string } };
  }

  it.each([
    ["anon", undefined],
    ["un owner", "ownerA"],
  ] as const)("no se pueden invocar por la API (%s)", async (_label, quien) => {
    const user = quien ? ownerA : undefined;
    for (const schema of ["private", "public"] as const) {
      const { status, body } = await llamar(user, schema);

      expect(status).toBeGreaterThanOrEqual(400);
      expect(["PGRST106", "PGRST202"]).toContain(body.code); // esquema no expuesto / función inexistente
    }
  });
});
