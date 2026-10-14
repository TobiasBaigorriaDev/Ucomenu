import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  apiUrl,
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
  type TestUser,
} from "./helpers";

/**
 * Fotos de los platos (ficha gestion-de-carta): bucket `product-images`, ruta
 * `{organization_id}/{product_id}/{uuid}.{ext}`, escritura solo de miembros con la cuenta al día y
 * `products.image_path` acotado a la carpeta del propio plato.
 */

const BUCKET = "product-images";
// PNG de 1x1 píxel.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);

let service: Db;
let ownerA: TestUser;
let staffA: TestUser;
let ownerB: TestUser;
const orgs: string[] = [];
const subidos: string[] = [];

type Org = { id: string; categoryId: string; productId: string };

async function nuevaOrg(slug: string): Promise<Org> {
  const id = await createOrg(service, slug, "basic");
  orgs.push(id);
  const categoryId = await createCategory(service, id);
  const product = await service
    .from("products")
    .insert({ organization_id: id, category_id: categoryId, name: "tt-plato", price_cents: 1000 })
    .select("id")
    .single();
  if (product.error) throw new Error(product.error.message);
  return { id, categoryId, productId: product.data.id };
}

const ruta = (org: Org, ext = "png") => `${org.id}/${org.productId}/${randomUUID()}.${ext}`;

async function subir(db: Db, path: string, body: Buffer = PNG, contentType = "image/png", upsert = false) {
  const result = await db.storage.from(BUCKET).upload(path, body, { contentType, upsert });
  if (!result.error) subidos.push(path);
  return result;
}

async function existe(path: string): Promise<boolean> {
  const { data } = await service.storage.from(BUCKET).list(path.split("/").slice(0, 2).join("/"));
  return (data ?? []).some((f) => f.name === path.split("/")[2]);
}

let A: Org;
let B: Org;

beforeAll(async () => {
  service = serviceClient();
  [ownerA, staffA, ownerB] = await Promise.all([
    createUser(service, "img-ownerA"),
    createUser(service, "img-staffA"),
    createUser(service, "img-ownerB"),
  ]);
  A = await nuevaOrg("tt-img-a");
  B = await nuevaOrg("tt-img-b");
  await addMembership(service, ownerA, A.id, "owner");
  await addMembership(service, staffA, A.id, "staff");
  await addMembership(service, ownerB, B.id, "owner");
});

afterAll(async () => {
  if (subidos.length > 0) await service.storage.from(BUCKET).remove(subidos);
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([ownerA, staffA, ownerB].map((u) => deleteUser(service, u)));
});

describe("subir fotos", () => {
  it("el Dueño y el Staff suben a la carpeta de su organización, y la foto es pública", async () => {
    const delDueno = ruta(A);
    const delStaff = ruta(A, "jpg");
    expect((await subir(ownerA.db, delDueno)).error).toBeNull();
    expect((await subir(staffA.db, delStaff, PNG, "image/jpeg")).error).toBeNull();

    const publica = await fetch(`${apiUrl}/storage/v1/object/public/${BUCKET}/${delDueno}`);
    expect(publica.status).toBe(200);
    expect(publica.headers.get("content-type")).toContain("image/png");
  });

  it("un miembro de otra organización no puede subir a la carpeta ajena", async () => {
    const result = await subir(ownerB.db, ruta(A));
    expect(result.error).not.toBeNull();
  });

  it("un usuario anónimo no puede subir", async () => {
    const result = await subir(anonClient(), ruta(A));
    expect(result.error).not.toBeNull();
  });

  it("las rutas con otra forma se rechazan aunque la carpeta sea propia", async () => {
    const malas = [
      `${A.id}/${randomUUID()}.png`, // falta la carpeta del plato
      `${A.id}/${A.productId}/${randomUUID()}.gif`, // extensión no permitida
      `${A.id}/${A.productId}/foto.png`, // nombre que no es uuid
      `${A.id}/${A.productId}/extra/${randomUUID()}.png`, // una carpeta de más
      `no-es-uuid/${A.productId}/${randomUUID()}.png`, // organización mal formada
      `${A.id.toUpperCase()}/${A.productId}/${randomUUID()}.png`, // mayúsculas
    ];
    for (const path of malas) {
      const result = await subir(ownerA.db, path);
      expect(result.error, path).not.toBeNull();
    }
  });

  it("el bucket rechaza tipos que no son imagen y archivos de más de 2 MB", async () => {
    const html = await subir(ownerA.db, ruta(A), Buffer.from("<script>alert(1)</script>"), "text/html");
    expect(html.error).not.toBeNull();

    const grande = await subir(ownerA.db, ruta(A), Buffer.alloc(2 * 1024 * 1024 + 1, 1));
    expect(grande.error).not.toBeNull();
  });

  it("una foto nunca se pisa: sin política de UPDATE, el upsert falla", async () => {
    const path = ruta(A);
    expect((await subir(ownerA.db, path)).error).toBeNull();
    const again = await subir(ownerA.db, path, PNG, "image/png", true);
    expect(again.error).not.toBeNull();
  });
});

describe("listar fotos", () => {
  it("un miembro lista las de su organización; otra organización o un anónimo no ven nada", async () => {
    const path = ruta(A);
    expect((await subir(ownerA.db, path)).error).toBeNull();
    const carpeta = `${A.id}/${A.productId}`;

    const propia = await ownerA.db.storage.from(BUCKET).list(carpeta);
    expect(propia.data?.map((f) => f.name)).toContain(path.split("/")[2]);

    const ajena = await ownerB.db.storage.from(BUCKET).list(carpeta);
    const anonima = await anonClient().storage.from(BUCKET).list(carpeta);
    expect(ajena.data ?? []).toHaveLength(0);
    expect(anonima.data ?? []).toHaveLength(0);
  });
});

describe("borrar fotos", () => {
  it("el Dueño y el Staff borran las de su organización", async () => {
    const a = ruta(A);
    const b = ruta(A);
    expect((await subir(ownerA.db, a)).error).toBeNull();
    expect((await subir(ownerA.db, b)).error).toBeNull();

    const delDueno = await ownerA.db.storage.from(BUCKET).remove([a]);
    const delStaff = await staffA.db.storage.from(BUCKET).remove([b]);
    expect(delDueno.data).toHaveLength(1);
    expect(delStaff.data).toHaveLength(1);
    expect(await existe(a)).toBe(false);
    expect(await existe(b)).toBe(false);
  });

  it("otra organización o un anónimo no borran nada (el archivo sigue)", async () => {
    const path = ruta(A);
    expect((await subir(ownerA.db, path)).error).toBeNull();

    const ajeno = await ownerB.db.storage.from(BUCKET).remove([path]);
    const anonimo = await anonClient().storage.from(BUCKET).remove([path]);
    expect(ajeno.data ?? []).toHaveLength(0);
    expect(anonimo.data ?? []).toHaveLength(0);
    expect(await existe(path)).toBe(true);
  });
});

describe("cuenta que no puede escribir", () => {
  it("en solo lectura y suspendida no se sube ni se borra; en gracia sí", async () => {
    const org = await nuevaOrg("tt-img-mora");
    await addMembership(service, ownerA, org.id, "owner");

    const existente = ruta(org);
    expect((await subir(service, existente)).error).toBeNull();

    // Gracia (día 3): se escribe con normalidad.
    await setSubscription(service, org.id, { finEnMs: -3 * DIA_MS });
    expect((await subir(ownerA.db, ruta(org))).error).toBeNull();

    for (const [estado, dias] of [
      ["solo lectura", 10],
      ["suspendida", 20],
    ] as const) {
      await setSubscription(service, org.id, { finEnMs: -dias * DIA_MS });
      const subida = await subir(ownerA.db, ruta(org));
      expect(subida.error, `subir en ${estado}`).not.toBeNull();
      const borrado = await ownerA.db.storage.from(BUCKET).remove([existente]);
      expect(borrado.data ?? [], `borrar en ${estado}`).toHaveLength(0);
      expect(await existe(existente)).toBe(true);
    }
  });
});

describe("products.image_path", () => {
  it("acepta la ruta de la carpeta propia y nulo", async () => {
    const path = ruta(A, "jpg");
    const set = await ownerA.db.from("products").update({ image_path: path }).eq("id", A.productId).select("image_path");
    expect(set.error).toBeNull();
    expect(set.data).toEqual([{ image_path: path }]);

    const clear = await staffA.db.from("products").update({ image_path: null }).eq("id", A.productId).select("image_path");
    expect(clear.error).toBeNull();
    expect(clear.data).toEqual([{ image_path: null }]);
  });

  it("rechaza apuntar a la carpeta de otra organización, a otro plato o con otra forma", async () => {
    const otra = await service
      .from("products")
      .insert({ organization_id: A.id, category_id: A.categoryId, name: "tt-otro", price_cents: 1 })
      .select("id")
      .single();
    expect(otra.error).toBeNull();

    const malas = [
      ruta(B), // organización ajena
      `${A.id}/${otra.data!.id}/${randomUUID()}.png`, // otro plato de la misma organización
      `${A.id}/${A.productId}/${randomUUID()}.gif`, // extensión
      `../${A.id}/${A.productId}/${randomUUID()}.png`, // intento de salir de la carpeta
      `${A.id}/${A.productId}/${randomUUID()}.png/../x.png`,
      "https://example.com/foto.png", // URL externa
    ];
    for (const path of malas) {
      const result = await ownerA.db.from("products").update({ image_path: path }).eq("id", A.productId).select("id");
      expect(result.error?.code, path).toBe("23514");
    }
  });

  it("también al crear: el INSERT con una ruta ajena falla", async () => {
    const result = await ownerA.db.from("products").insert({
      organization_id: A.id,
      category_id: A.categoryId,
      name: "tt-con-foto-ajena",
      price_cents: 1,
      image_path: ruta(B),
    });
    expect(result.error?.code).toBe("23514");
  });

  it("un miembro de otra organización no puede cambiar la foto de un plato ajeno", async () => {
    const result = await ownerB.db.from("products").update({ image_path: ruta(A) }).eq("id", A.productId).select("id");
    expect(result.data ?? []).toHaveLength(0);
  });
});
