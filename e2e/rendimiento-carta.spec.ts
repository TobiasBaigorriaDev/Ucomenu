import { expect, test, type Page } from "@playwright/test";
import { createTenant, login, service, type Tenant } from "./support";

/**
 * Rendimiento de la carta pública (ficha rendimiento-carta-publica): la carta guarda en caché las categorías y los platos,
 * y el panel la invalida al guardar. Lo que NO puede pasar: una carta vieja después de un cambio del panel, datos de otra
 * organización, o publicar una cuenta suspendida o una organización desactivada porque «estaba en caché». Las fotos se
 * sirven reducidas y solo las de nuestro bucket. Cada prueba trabaja sobre locales propios y los borra al terminar.
 */

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);

const tenants: Tenant[] = [];

async function nuevoLocal(label: string) {
  const t = await createTenant(label);
  tenants.push(t);
  return t;
}

test.afterAll(async () => {
  const db = service();
  for (const t of tenants) {
    const folders = await db.storage.from("product-images").list(t.orgId);
    const paths: string[] = [];
    for (const folder of folders.data ?? []) {
      const files = await db.storage.from("product-images").list(`${t.orgId}/${folder.name}`);
      paths.push(...(files.data ?? []).map((f) => `${t.orgId}/${folder.name}/${f.name}`));
    }
    if (paths.length > 0) await db.storage.from("product-images").remove(paths);
    await t.cleanup();
  }
});

/** Categoría con platos, con la clave de servicio (no es lo que se prueba). Devuelve el id de cada plato por nombre. */
async function sembrar(t: Tenant, categoria: string, platos: { nombre: string; precio?: number }[]) {
  const db = service();
  const cat = await db.from("categories").insert({ organization_id: t.orgId, name: categoria, sort_order: 0 }).select("id").single();
  if (cat.error) throw new Error(cat.error.message);
  const filas = await db
    .from("products")
    .insert(platos.map((p, i) => ({ organization_id: t.orgId, category_id: cat.data.id, name: p.nombre, price_cents: p.precio ?? 150000, sort_order: i })))
    .select("id, name");
  if (filas.error) throw new Error(filas.error.message);
  return Object.fromEntries(filas.data.map((p) => [p.name, p.id]));
}

/** Mira la carta pública como un comensal. */
async function publica(page: Page, t: Tenant) {
  const respuesta = await page.goto(`/m/${t.slug}/centro`);
  return { status: respuesta?.status(), texto: await page.locator("body").innerText() };
}

async function editor(page: Page, t: Tenant, ruta = "/carta") {
  await login(page, t.owner.email, t.owner.password);
  await page.goto(`/panel/${t.slug}${ruta}`);
}

const estado = (page: Page) => page.locator("form").getByRole("status");

test.describe("caché de la carta pública", () => {
  test("la carta se sirve de la caché: un cambio hecho fuera de la app no se ve hasta que vence", async ({ page }) => {
    const t = await nuevoLocal("rend-cache");
    const ids = await sembrar(t, "Platos", [{ nombre: "Milanesa" }]);

    expect((await publica(page, t)).texto).toContain("Milanesa");
    const cambio = await service().from("products").update({ name: "Milanesa editada" }).eq("id", ids.Milanesa);
    expect(cambio.error).toBeNull();

    // Si esto falla, la caché dejó de funcionar y las demás pruebas de este archivo no demuestran nada.
    const segunda = (await publica(page, t)).texto;
    expect(segunda).toContain("Milanesa");
    expect(segunda).not.toContain("Milanesa editada");
  });

  test("lo cacheado vence a los 60 s aunque la carta haya quedado vacía por un cambio hecho fuera de la app", async ({ page }) => {
    test.setTimeout(150_000);
    const t = await nuevoLocal("rend-vence");
    const ids = await sembrar(t, "Platos", [{ nombre: "Milanesa" }]);
    expect((await publica(page, t)).texto).toContain("Milanesa");

    // Se apaga el único plato directo en la base: sin invalidar nada, solo el vencimiento puede sacarlo de la carta.
    expect((await service().from("products").update({ is_active: false }).eq("id", ids.Milanesa)).error).toBeNull();
    expect((await publica(page, t)).texto).toContain("Milanesa"); // todavía en caché (antes de vencer)

    await page.waitForTimeout(62_000);
    // Tras vencer, la primera carga puede servir lo viejo mientras se renueva; la siguiente ya no.
    await expect
      .poll(async () => (await publica(page, t)).texto.includes("Milanesa"), { timeout: 20_000, intervals: [1_000] })
      .toBe(false);
  });

  test("lo que se guarda en el panel se ve en la carta pública enseguida, aunque ya estuviera en caché", async ({ page }) => {
    const t = await nuevoLocal("rend-panel");
    await sembrar(t, "Platos", [{ nombre: "Milanesa" }, { nombre: "Ravioles" }]);
    await editor(page, t);

    // Caliente la caché de la carta.
    expect((await publica(page, t)).texto).toContain("Milanesa");

    // Editar el nombre y el precio de un plato.
    await page.goto(`/panel/${t.slug}/carta`);
    await page.getByRole("link", { name: "Editar Milanesa" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Milanesa napolitana");
    await page.getByLabel("Precio en pesos").fill("4.500");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(estado(page)).toHaveText("Cambios guardados.");
    const tras = await publica(page, t);
    expect(tras.texto).toContain("Milanesa napolitana");
    expect(tras.texto).toMatch(/\$\s4\.500/);

    // Renombrar la categoría.
    await page.goto(`/panel/${t.slug}/carta`);
    const categoria = page.locator('[data-testid="categoria"][data-name="Platos"]');
    await categoria.locator("summary", { hasText: "Renombrar" }).click();
    await categoria.getByLabel("Nombre nuevo").fill("Platos de la casa");
    await categoria.getByRole("button", { name: "Guardar nombre" }).click();
    await expect(page.locator('[data-testid="categoria"][data-name="Platos de la casa"]')).toBeVisible();
    expect((await publica(page, t)).texto).toContain("Platos de la casa");

    // Un plato nuevo.
    await page.goto(`/panel/${t.slug}/carta/platos/nuevo`);
    await page.getByLabel("Nombre", { exact: true }).fill("Ñoquis");
    await page.getByLabel("Precio en pesos").fill("3000");
    await page.getByRole("button", { name: "Crear plato" }).click();
    await expect(page.getByTestId("plato-creado")).toBeVisible();
    expect((await publica(page, t)).texto).toContain("Ñoquis");

    // Ocultar un plato y volver a mostrarlo.
    await page.goto(`/panel/${t.slug}/carta`);
    await page.getByRole("button", { name: "Desactivar Ravioles" }).click();
    await expect(page.locator('[data-testid="plato"][data-name="Ravioles"]')).toContainText("Inactivo");
    expect((await publica(page, t)).texto).not.toContain("Ravioles");
    await page.goto(`/panel/${t.slug}/carta`);
    await page.getByRole("button", { name: "Activar Ravioles" }).click();
    await expect(page.locator('[data-testid="plato"][data-name="Ravioles"]')).not.toContainText("Inactivo");
    expect((await publica(page, t)).texto).toContain("Ravioles");
  });

  test("la foto de un plato aparece y desaparece de la carta pública al subirla y quitarla", async ({ page }) => {
    const t = await nuevoLocal("rend-foto");
    const ids = await sembrar(t, "Platos", [{ nombre: "Milanesa" }]);
    await editor(page, t, `/carta/platos/${ids.Milanesa}`);

    await publica(page, t); // caliente la caché (todavía sin foto)
    expect(await page.getByRole("img", { name: "Foto de Milanesa" }).count()).toBe(0);

    await page.goto(`/panel/${t.slug}/carta/platos/${ids.Milanesa}`);
    await page.getByLabel("Elegir una foto").setInputFiles({ name: "milanesa.png", mimeType: "image/png", buffer: PNG_1X1 });
    await page.getByRole("button", { name: "Guardar foto" }).click();
    await expect(estado(page)).toHaveText("Foto guardada.");

    await publica(page, t);
    await expect(page.getByRole("img", { name: "Foto de Milanesa" })).toHaveCount(1);

    await page.goto(`/panel/${t.slug}/carta/platos/${ids.Milanesa}`);
    await page.getByRole("button", { name: "Quitar la foto" }).click();
    await expect(page.getByText("Este plato todavía no tiene foto.")).toBeVisible();
    await publica(page, t);
    await expect(page.getByRole("img", { name: "Foto de Milanesa" })).toHaveCount(0);
  });

  test("la entrada por el QR de la mesa también refleja el cambio del panel", async ({ page }) => {
    const t = await nuevoLocal("rend-mesa");
    await sembrar(t, "Platos", [{ nombre: "Milanesa" }]);
    const sucursal = await service().from("branches").select("id").eq("organization_id", t.orgId).single();
    const mesa = await service().from("tables").insert({ organization_id: t.orgId, branch_id: sucursal.data!.id, label: "Mesa 1" }).select("qr_token").single();
    expect(mesa.error).toBeNull();
    const token = mesa.data!.qr_token;

    await page.goto(`/t/${token}`);
    await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Milanesa"]);

    await editor(page, t);
    await page.getByRole("link", { name: "Editar Milanesa" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Milanesa napolitana");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(estado(page)).toHaveText("Cambios guardados.");

    await page.goto(`/t/${token}`);
    await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Milanesa napolitana"]);
  });
});

test.describe("la caché no mezcla organizaciones", () => {
  test("dos locales con la misma sucursal «centro» ven cada uno solo lo suyo, también tras editar uno", async ({ page }) => {
    const a = await nuevoLocal("rend-aisl-a");
    const b = await nuevoLocal("rend-aisl-b");
    await sembrar(a, "Cafetería", [{ nombre: "Cortado de A", precio: 100000 }]);
    await sembrar(b, "Parrilla", [{ nombre: "Asado de B", precio: 900000 }]);

    for (const [propio, ajeno, local] of [
      ["Cortado de A", "Asado de B", a],
      ["Asado de B", "Cortado de A", b],
      ["Cortado de A", "Asado de B", a], // ya en caché
      ["Asado de B", "Cortado de A", b],
    ] as const) {
      const { texto } = await publica(page, local);
      expect(texto).toContain(propio);
      expect(texto).not.toContain(ajeno);
    }

    // Editar el local A no toca la carta de B ni la mezcla.
    await editor(page, a);
    await page.getByRole("link", { name: "Editar Cortado de A" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Cortado doble de A");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(estado(page)).toHaveText("Cambios guardados.");

    const deA = await publica(page, a);
    expect(deA.texto).toContain("Cortado doble de A");
    expect(deA.texto).not.toContain("Asado de B");
    const deB = await publica(page, b);
    expect(deB.texto).toContain("Asado de B");
    expect(deB.texto).not.toContain("Cortado");
  });
});

test.describe("la caché respeta la cuenta y el estado del local", () => {
  const DIA_MS = 24 * 60 * 60 * 1000;
  const periodoHasta = (t: Tenant, ms: number) =>
    service().from("subscriptions").update({ current_period_end: new Date(Date.now() + ms).toISOString(), trial_ends_at: null }).eq("organization_id", t.orgId);

  test("una carta ya en caché deja de publicarse apenas la cuenta se suspende, y vuelve al regularizarla", async ({ page }) => {
    const t = await nuevoLocal("rend-susp");
    await sembrar(t, "Platos", [{ nombre: "Milanesa completa" }]);
    const sucursal = await service().from("branches").select("id").eq("organization_id", t.orgId).single();
    const mesa = await service().from("tables").insert({ organization_id: t.orgId, branch_id: sucursal.data!.id, label: "Mesa 1" }).select("qr_token").single();
    const token = mesa.data!.qr_token;

    for (let i = 0; i < 2; i++) expect((await publica(page, t)).texto).toContain("Milanesa completa"); // en caché

    expect((await periodoHasta(t, -20 * DIA_MS)).error).toBeNull(); // 20 días de mora: suspendida
    const suspendida = await publica(page, t);
    expect(suspendida.status).toBe(200);
    expect(suspendida.texto).toContain("Carta temporalmente no disponible");
    expect(suspendida.texto).not.toContain("Milanesa completa");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

    await page.goto(`/t/${token}`);
    await expect(page.getByText("Carta temporalmente no disponible")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Milanesa completa");

    expect((await periodoHasta(t, 5 * DIA_MS)).error).toBeNull(); // pagó
    expect((await publica(page, t)).texto).toContain("Milanesa completa");
  });

  test("una carta en caché da 404 apenas el local se desactiva", async ({ page }) => {
    const t = await nuevoLocal("rend-baja");
    await sembrar(t, "Platos", [{ nombre: "Milanesa" }]);
    for (let i = 0; i < 2; i++) expect((await publica(page, t)).status).toBe(200);

    expect((await service().from("organizations").update({ is_active: false }).eq("id", t.orgId)).error).toBeNull();
    const baja = await publica(page, t);
    expect(baja.status).toBe(404);
    expect(baja.texto).not.toContain("Milanesa");

    expect((await service().from("organizations").update({ is_active: true }).eq("id", t.orgId)).error).toBeNull();
    expect((await publica(page, t)).status).toBe(200);
  });

  test("lo inactivo no se publica ni siquiera si se cacheó cuando estaba activo", async ({ page }) => {
    const t = await nuevoLocal("rend-inactivo");
    const ids = await sembrar(t, "Platos", [{ nombre: "Milanesa" }, { nombre: "Ravioles" }]);
    await publica(page, t);

    // Lo desactiva el panel: la carta no puede seguir mostrándolo.
    await editor(page, t);
    await page.getByRole("button", { name: "Desactivar Ravioles" }).click();
    await expect(page.locator('[data-testid="plato"][data-name="Ravioles"]')).toContainText("Inactivo");
    const texto = (await publica(page, t)).texto;
    expect(texto).toContain("Milanesa");
    expect(texto).not.toContain("Ravioles");
    expect(ids.Ravioles).toBeTruthy();
  });
});

test.describe("fotos optimizadas", () => {
  test("la carta pide las fotos reducidas y solo se optimizan las de nuestro bucket", async ({ page, request }) => {
    const t = await nuevoLocal("rend-img");
    const ids = await sembrar(t, "Platos", [{ nombre: "Milanesa" }]);
    const ruta = `${t.orgId}/${ids.Milanesa}/${crypto.randomUUID()}.png`;
    const db = service();
    expect((await db.storage.from("product-images").upload(ruta, PNG_1X1, { contentType: "image/png" })).error).toBeNull();
    expect((await db.from("products").update({ image_path: ruta }).eq("id", ids.Milanesa)).error).toBeNull();

    await page.goto(`/m/${t.slug}/centro`);
    const foto = page.getByRole("img", { name: "Foto de Milanesa" });
    await foto.scrollIntoViewIfNeeded();
    await expect.poll(() => foto.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

    const src = (await foto.getAttribute("src"))!;
    expect(src).toContain("/_next/image?url=");
    expect(await foto.getAttribute("srcset")).toMatch(/w=96&q=75 1x, .*w=192&q=75 2x/);
    // Con el tamaño fijado en el HTML la lista no salta al cargar la foto.
    expect(await foto.getAttribute("width")).toBe("96");
    expect(await foto.getAttribute("height")).toBe("96");

    const reducida = await request.get(src, { headers: { Accept: "image/webp,image/*,*/*;q=0.8" } });
    expect(reducida.status()).toBe(200);
    expect(reducida.headers()["content-type"]).toBe("image/webp");

    // El optimizador no es un proxy abierto: ni otro dominio ni otro bucket de nuestro Storage.
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    for (const ajena of ["https://example.com/foto.png", `${base}/storage/v1/object/public/otro-bucket/foto.png`, `${base}/rest/v1/products`]) {
      const respuesta = await request.get(`/_next/image?url=${encodeURIComponent(ajena)}&w=96&q=75`);
      expect(respuesta.status(), ajena).toBe(400);
    }
  });
});
