import { expect, test, type Page } from "@playwright/test";
import {
  alerta,
  createTenant,
  expectNoHorizontalOverflow,
  FOTO_PNG,
  login,
  service,
  type Estado,
  type Person,
  type Tenant,
} from "./support";

/**
 * Gestión de carta (ficha gestion-de-carta): categorías y platos con foto, orden y activo/inactivo,
 * tope del plan y cuenta bloqueada, contra el build y el Supabase local, a 390 px.
 * Cada prueba trabaja sobre un local propio y lo borra al terminar.
 */


/** BMP sin comprimir (24 bits) con un degradé: pesa varios MB y el navegador lo decodifica. */
function bmp(width: number, height: number): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const buf = Buffer.alloc(size);
  buf.write("BM", 0);
  buf.writeUInt32LE(size, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(rowSize * height, 34);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = 54 + y * rowSize + x * 3;
      buf[o] = (x * 255) / width;
      buf[o + 1] = (y * 255) / height;
      buf[o + 2] = 128;
    }
  }
  return buf;
}

const tenants: Tenant[] = [];

async function nuevoLocal(label: string, estado: Estado = "active") {
  const t = await createTenant(label, estado);
  tenants.push(t);
  return t;
}

test.afterAll(async () => {
  const db = service();
  for (const t of tenants) {
    // Los archivos de Storage no se borran con la cascada de la organización.
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

/** Carga categorías y platos con la clave de servicio (no es lo que se prueba). Devuelve los ids. */
async function sembrar(t: Tenant, categorias: { nombre: string; platos: { nombre: string; precio?: number; activo?: boolean }[] }[]) {
  const db = service();
  const ids: Record<string, string> = {};
  for (const [i, c] of categorias.entries()) {
    const cat = await db.from("categories").insert({ organization_id: t.orgId, name: c.nombre, sort_order: i }).select("id").single();
    if (cat.error) throw new Error(cat.error.message);
    ids[c.nombre] = cat.data.id;
    if (c.platos.length > 0) {
      const platos = await db
        .from("products")
        .insert(
          c.platos.map((p, j) => ({
            organization_id: t.orgId,
            category_id: cat.data.id,
            name: p.nombre,
            price_cents: p.precio ?? 150000,
            sort_order: j,
            is_active: p.activo ?? true,
          })),
        )
        .select("id, name");
      if (platos.error) throw new Error(platos.error.message);
      for (const p of platos.data) ids[p.name] = p.id;
    }
  }
  return ids;
}

async function ingresar(page: Page, persona: Person, t: Tenant, ruta = "/carta") {
  await login(page, persona.email, persona.password);
  await page.goto(`/panel/${t.slug}${ruta}`);
}

const categoria = (page: Page, nombre: string) => page.locator(`[data-testid="categoria"][data-name="${nombre}"]`);
const plato = (page: Page, nombre: string) => page.locator(`[data-testid="plato"][data-name="${nombre}"]`);
const estado = (page: Page) => page.locator("form").getByRole("status");

async function nombresDeCategorias(page: Page) {
  return page.locator('[data-testid="categoria"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-name")));
}
async function nombresDePlatos(page: Page, cat: string) {
  return categoria(page, cat).locator('[data-testid="plato"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-name")));
}
async function nombresPublicos(page: Page, t: Tenant) {
  await page.goto(`/m/${t.slug}/centro`);
  return page.locator("main h2, main h3").allInnerTexts();
}

test.describe("categorías y platos (Dueño)", () => {
  test("crea categorías y platos desde la pantalla y la carta pública los muestra en orden", async ({ page }) => {
    const t = await nuevoLocal("carta-flujo");
    await ingresar(page, t.owner, t);

    await expect(page.getByTestId("carta-vacia")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Dos categorías.
    for (const nombre of ["Entradas", "Postres"]) {
      await page.getByLabel("Nombre de la categoría").fill(nombre);
      await page.getByRole("button", { name: "Crear categoría" }).click();
      await expect(categoria(page, nombre)).toBeVisible();
    }
    expect(await nombresDeCategorias(page)).toEqual(["Entradas", "Postres"]);
    await expect(page.getByLabel("Nombre de la categoría")).toHaveValue("");

    // Un nombre de solo espacios pasa el `required` del navegador y lo rechaza el servidor, sin crear nada.
    await page.getByLabel("Nombre de la categoría").fill("   ");
    await page.getByRole("button", { name: "Crear categoría" }).click();
    await expect(alerta(page)).toContainText("Ingresá un nombre");
    expect(await nombresDeCategorias(page)).toEqual(["Entradas", "Postres"]);

    // Un plato en cada una, con precio con coma.
    for (const [cat, nombre, precio] of [
      ["Entradas", "Empanada", "2.800,50"],
      ["Postres", "Flan", "3200"],
    ] as const) {
      await page.getByRole("link", { name: `Agregar un plato a ${cat}` }).click();
      await expect(page).toHaveURL(/\/carta\/platos\/nuevo/);
      await expect(page.getByLabel("Categoría", { exact: true })).toHaveValue(/.+/);
      await page.getByLabel("Nombre", { exact: true }).fill(nombre);
      await page.getByLabel("Descripción").fill("Casera");
      await page.getByLabel("Precio en pesos").fill(precio);
      await page.getByRole("button", { name: "Crear plato" }).click();
      await expect(page.getByTestId("plato-creado")).toBeVisible();
      await page.goto(`/panel/${t.slug}/carta`);
    }
    await expect(plato(page, "Empanada")).toContainText("$ 2.800,50");
    await expect(plato(page, "Flan")).toContainText("$ 3.200");
    await expect(page.getByTestId("platos-activos")).toContainText("2 de 80");

    // Pública: en el orden de la carta.
    expect(await nombresPublicos(page, t)).toEqual(["Entradas", "Empanada", "Postres", "Flan"]);
  });

  test("ordena categorías y platos y los activa o desactiva; la carta pública lo refleja", async ({ page }) => {
    const t = await nuevoLocal("carta-orden");
    await sembrar(t, [
      { nombre: "Entradas", platos: [{ nombre: "Empanada" }] },
      { nombre: "Postres", platos: [{ nombre: "Flan" }] },
    ]);
    await ingresar(page, t.owner, t);

    // Subir la segunda categoría la pone primera, en el panel y en la carta pública.
    await page.getByRole("button", { name: "Subir Postres" }).click();
    await expect.poll(() => nombresDeCategorias(page)).toEqual(["Postres", "Entradas"]);
    await expect(page.getByRole("button", { name: "Subir Postres" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Bajar Entradas" })).toBeDisabled();
    expect(await nombresPublicos(page, t)).toEqual(["Postres", "Flan", "Entradas", "Empanada"]);

    // Desactivar un plato lo oculta de la carta pública; activarlo lo devuelve.
    await page.goto(`/panel/${t.slug}/carta`);
    await page.getByRole("button", { name: "Desactivar Flan" }).click();
    await expect(plato(page, "Flan")).toContainText("Inactivo");
    await expect(page.getByTestId("platos-activos")).toContainText("1 de 80");
    expect(await nombresPublicos(page, t)).toEqual(["Entradas", "Empanada"]);

    await page.goto(`/panel/${t.slug}/carta`);
    await page.getByRole("button", { name: "Activar Flan" }).click();
    await expect(plato(page, "Flan")).not.toContainText("Inactivo");

    // Desactivar una categoría oculta también sus platos.
    await page.getByRole("button", { name: "Desactivar Postres" }).click();
    await expect(categoria(page, "Postres")).toContainText("Inactiva");
    expect(await nombresPublicos(page, t)).toEqual(["Entradas", "Empanada"]);
  });

  test("edita un plato (nombre, precio, categoría) y renombra una categoría", async ({ page }) => {
    const t = await nuevoLocal("carta-editar");
    const ids = await sembrar(t, [
      { nombre: "Platos", platos: [{ nombre: "Milanesa" }, { nombre: "Ravioles" }] },
      { nombre: "Bebidas", platos: [] },
    ]);
    await ingresar(page, t.owner, t);

    await categoria(page, "Bebidas").locator("summary", { hasText: "Renombrar" }).click();
    await categoria(page, "Bebidas").getByLabel("Nombre nuevo").fill("Para tomar");
    await categoria(page, "Bebidas").getByRole("button", { name: "Guardar nombre" }).click();
    await expect(categoria(page, "Para tomar")).toBeVisible();

    await page.getByRole("link", { name: "Editar Milanesa" }).click();
    await expect(page).toHaveURL(new RegExp(`/carta/platos/${ids.Milanesa}$`));
    await page.getByLabel("Nombre", { exact: true }).fill("Milanesa napolitana");
    await page.getByLabel("Precio en pesos").fill("4.500");
    await page.getByLabel("Categoría", { exact: true }).selectOption({ label: "Para tomar" });
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(estado(page)).toHaveText("Cambios guardados.");

    await page.goto(`/panel/${t.slug}/carta`);
    expect(await nombresDePlatos(page, "Platos")).toEqual(["Ravioles"]);
    expect(await nombresDePlatos(page, "Para tomar")).toEqual(["Milanesa napolitana"]);
    await expect(plato(page, "Milanesa napolitana")).toContainText("$ 4.500");
  });

  test("los errores de validación se muestran y conservan lo escrito", async ({ page }) => {
    const t = await nuevoLocal("carta-validacion");
    await sembrar(t, [{ nombre: "Platos", platos: [] }]);
    await ingresar(page, t.owner, t, "/carta/platos/nuevo");

    for (const [precio, mensaje] of [
      ["abc", "El precio no es válido"],
      ["1,234", "como máximo 2 decimales"],
      ["99999999", "demasiado alto"],
    ] as const) {
      await page.getByLabel("Nombre", { exact: true }).fill("Plato de prueba");
      await page.getByLabel("Precio en pesos").fill(precio);
      await page.getByRole("button", { name: "Crear plato" }).click();
      await expect(alerta(page)).toContainText(mensaje);
      await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Plato de prueba");
      await expect(page.getByLabel("Precio en pesos")).toHaveValue(precio);
    }
    const { count } = await service().from("products").select("id", { count: "exact", head: true }).eq("organization_id", t.orgId);
    expect(count).toBe(0);
  });
});

test.describe("Staff", () => {
  test("el Staff gestiona la carta igual que el Dueño", async ({ page }) => {
    const t = await nuevoLocal("carta-staff");
    await sembrar(t, [{ nombre: "Platos", platos: [{ nombre: "Milanesa" }, { nombre: "Ravioles" }] }]);
    await ingresar(page, t.staff, t);

    await page.getByRole("button", { name: "Bajar Milanesa" }).click();
    await expect.poll(() => nombresDePlatos(page, "Platos")).toEqual(["Ravioles", "Milanesa"]);
    await expect(page.getByRole("button", { name: "Subir Ravioles" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Bajar Milanesa" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Bajar Ravioles" })).toBeEnabled();

    await page.getByRole("link", { name: "Agregar un plato a Platos" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Ñoquis");
    await page.getByLabel("Precio en pesos").fill("3000");
    await page.getByRole("button", { name: "Crear plato" }).click();
    await expect(page.getByTestId("plato-creado")).toBeVisible();
  });
});

test.describe("fotos", () => {
  test("sube una foto, se ve en el panel y en la carta pública, se reemplaza y se quita", async ({ page }) => {
    const t = await nuevoLocal("carta-foto");
    const ids = await sembrar(t, [{ nombre: "Platos", platos: [{ nombre: "Milanesa" }] }]);
    await ingresar(page, t.owner, t, `/carta/platos/${ids.Milanesa}`);

    const fotoActual = async () =>
      (await service().from("products").select("image_path").eq("id", ids.Milanesa).single()).data?.image_path ?? null;

    await page.getByLabel("Elegir una foto").setInputFiles({ name: "milanesa.png", mimeType: "image/png", buffer: FOTO_PNG });
    await expect(page.getByText("Foto lista")).toBeVisible();
    await page.getByRole("button", { name: "Guardar foto" }).click();
    await expect(estado(page)).toHaveText("Foto guardada.");
    const primera = await fotoActual();
    expect(primera).toMatch(new RegExp(`^${t.orgId}/${ids.Milanesa}/[0-9a-f-]{36}\\.png$`));

    const imagen = page.getByRole("img", { name: "Foto de Milanesa" });
    await expect(imagen).toBeVisible();
    await expect.poll(() => imagen.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

    // En la carta pública.
    await page.goto(`/m/${t.slug}/centro`);
    const publica = page.getByRole("img", { name: "Foto de Milanesa" });
    await publica.scrollIntoViewIfNeeded();
    await expect.poll(() => publica.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    await expectNoHorizontalOverflow(page);

    // Reemplazarla deja una sola foto.
    await page.goto(`/panel/${t.slug}/carta/platos/${ids.Milanesa}`);
    await page.getByLabel("Reemplazar la foto").setInputFiles({ name: "otra.png", mimeType: "image/png", buffer: FOTO_PNG });
    await page.getByRole("button", { name: "Guardar foto" }).click();
    await expect(estado(page)).toHaveText("Foto guardada.");
    const segunda = await fotoActual();
    expect(segunda).not.toBe(primera);
    const archivos = await service().storage.from("product-images").list(`${t.orgId}/${ids.Milanesa}`);
    expect(archivos.data?.map((f) => f.name)).toEqual([segunda!.split("/")[2]]);

    // Quitarla.
    await page.getByRole("button", { name: "Quitar la foto" }).click();
    await expect(page.getByText("Este plato todavía no tiene foto.")).toBeVisible();
    expect(await fotoActual()).toBeNull();
    const vacia = await service().storage.from("product-images").list(`${t.orgId}/${ids.Milanesa}`);
    expect(vacia.data ?? []).toHaveLength(0);
  });

  test("una foto grande se reduce en el navegador antes de subirla", async ({ page }) => {
    const t = await nuevoLocal("carta-foto-grande");
    const ids = await sembrar(t, [{ nombre: "Platos", platos: [{ nombre: "Milanesa" }] }]);
    await ingresar(page, t.owner, t, `/carta/platos/${ids.Milanesa}`);

    const grande = bmp(1800, 1800); // ~9,7 MB
    expect(grande.length).toBeGreaterThan(8 * 1024 * 1024);
    await page.getByLabel("Elegir una foto").setInputFiles({ name: "camara.bmp", mimeType: "image/bmp", buffer: grande });
    await expect(page.getByText("Foto lista")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Guardar foto" }).click();
    await expect(estado(page)).toHaveText("Foto guardada.", { timeout: 30_000 });

    const { data } = await service().from("products").select("image_path").eq("id", ids.Milanesa).single();
    expect(data?.image_path).toMatch(/\.jpg$/); // el navegador la convirtió a JPEG
    const bajada = await service().storage.from("product-images").download(data!.image_path!);
    expect(bajada.data!.size).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(bajada.data!.size).toBeGreaterThan(1000);
  });

  test("una foto de 1 a 1,5 MB se sube tal cual: pasa el límite de 1 MB que traen las server actions por defecto", async ({ page }) => {
    const t = await nuevoLocal("carta-foto-media");
    const ids = await sembrar(t, [{ nombre: "Platos", platos: [{ nombre: "Milanesa" }] }]);
    await ingresar(page, t.owner, t, `/carta/platos/${ids.Milanesa}`);

    // PNG de ruido (no se comprime) de ~1,4 MB y menos de 1600 px: la app no la reduce.
    const bytes = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 590;
      canvas.height = 590;
      const context = canvas.getContext("2d")!;
      const image = context.createImageData(590, 590);
      crypto.getRandomValues(image.data.subarray(0, 65536)); // getRandomValues admite hasta 64 KB por llamada
      for (let i = 65536; i < image.data.length; i += 65536) crypto.getRandomValues(image.data.subarray(i, i + 65536));
      for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
      context.putImageData(image, 0, 0);
      const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    const foto = Buffer.from(bytes);
    expect(foto.length).toBeGreaterThan(1.05 * 1024 * 1024);
    expect(foto.length).toBeLessThan(1.5 * 1024 * 1024);

    await page.getByLabel("Elegir una foto").setInputFiles({ name: "media.png", mimeType: "image/png", buffer: foto });
    await expect(page.getByText("Foto lista")).toBeVisible();
    await page.getByRole("button", { name: "Guardar foto" }).click();
    await expect(estado(page)).toHaveText("Foto guardada.");
    const { data } = await service().from("products").select("image_path").eq("id", ids.Milanesa).single();
    expect(data?.image_path).toMatch(/\.png$/);
  });

  test("una foto de más de 2 MB que no se puede reducir se rechaza en el navegador con un mensaje claro", async ({ page }) => {
    const t = await nuevoLocal("carta-foto-pesada");
    const ids = await sembrar(t, [{ nombre: "Platos", platos: [{ nombre: "Milanesa" }] }]);
    await ingresar(page, t.owner, t, `/carta/platos/${ids.Milanesa}`);

    // Bytes que no son una imagen: el navegador no la puede decodificar ni reducir y pesa más de 2 MB.
    await page.getByLabel("Elegir una foto").setInputFiles({ name: "pesada.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(2.5 * 1024 * 1024, 7) });
    await expect(page.getByRole("alert").filter({ hasText: "el máximo es 2.0 MB" })).toBeVisible();
    await expect(page.getByLabel("Elegir una foto")).toHaveValue("");
    const { data } = await service().from("products").select("image_path").eq("id", ids.Milanesa).single();
    expect(data?.image_path).toBeNull();
  });

  test("un archivo que no es una imagen se rechaza aunque se llame .jpg, y el plato no cambia", async ({ page }) => {
    const t = await nuevoLocal("carta-foto-falsa");
    const ids = await sembrar(t, [{ nombre: "Platos", platos: [{ nombre: "Milanesa" }] }]);
    await ingresar(page, t.owner, t, `/carta/platos/${ids.Milanesa}`);

    await page.getByLabel("Elegir una foto").setInputFiles({
      name: "foto.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("<script>alert(1)</script>"),
    });
    await page.getByRole("button", { name: "Guardar foto" }).click();
    await expect(alerta(page)).toContainText("JPG, PNG o WebP");
    const { data } = await service().from("products").select("image_path").eq("id", ids.Milanesa).single();
    expect(data?.image_path).toBeNull();
  });
});

test.describe("tope del plan", () => {
  test("con el tope de platos activos alcanzado, crear o activar muestra el mensaje; desactivar y crear oculto siguen", async ({ page }) => {
    const t = await nuevoLocal("carta-tope");
    const db = service();
    const cat = await db.from("categories").insert({ organization_id: t.orgId, name: "Todo" }).select("id").single();
    await db.from("products").insert(
      Array.from({ length: 80 }, (_, i) => ({
        organization_id: t.orgId,
        category_id: cat.data!.id,
        name: `Plato ${String(i + 1).padStart(2, "0")}`,
        price_cents: 1000,
        sort_order: i,
      })),
    );
    await db.from("products").insert({ organization_id: t.orgId, category_id: cat.data!.id, name: "Escondido", price_cents: 1000, sort_order: 99, is_active: false });

    await ingresar(page, t.owner, t);
    await expect(page.getByTestId("platos-activos")).toContainText("80 de 80");
    await expect(page.getByTestId("aviso-tope")).toBeVisible();

    // Activar uno inactivo.
    await page.getByRole("button", { name: "Activar Escondido" }).click();
    await expect(plato(page, "Escondido").getByRole("alert")).toContainText("Llegaste al tope de 80 platos activos de tu plan");
    await expect(plato(page, "Escondido")).toContainText("Inactivo");

    // Crear uno activo.
    await page.goto(`/panel/${t.slug}/carta/platos/nuevo`);
    await page.getByLabel("Nombre", { exact: true }).fill("Plato 81");
    await page.getByLabel("Precio en pesos").fill("1000");
    await page.getByRole("button", { name: "Crear plato" }).click();
    await expect(alerta(page)).toContainText("Llegaste al tope de 80 platos activos de tu plan");
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Plato 81");

    // Crearlo oculto sí se puede.
    await page.getByLabel("Mostrar en la carta").uncheck();
    await page.getByRole("button", { name: "Crear plato" }).click();
    await expect(page.getByTestId("plato-creado")).toBeVisible();

    // Desactivar uno libera el cupo, y entonces se puede activar el otro.
    await page.goto(`/panel/${t.slug}/carta`);
    await page.getByRole("button", { name: "Desactivar Plato 01" }).click();
    await expect(page.getByTestId("platos-activos")).toContainText("79 de 80");
    await page.getByRole("button", { name: "Activar Escondido" }).click();
    await expect(page.getByTestId("platos-activos")).toContainText("80 de 80");
  });
});

test.describe("cuenta que no puede escribir", () => {
  for (const [nombreEstado, estadoCuenta, texto] of [
    ["solo lectura", "read_only", "solo lectura"],
    ["suspendida", "suspended", "suspendida"],
  ] as const) {
    for (const rol of ["owner", "staff"] as const) {
      test(`${nombreEstado}, ${rol}: se ve la carta, no se puede editar y una acción forzada no guarda ni dice que guardó`, async ({ page }) => {
        const t = await nuevoLocal(`carta-${estadoCuenta.replace("_", "")}-${rol}`, estadoCuenta);
        const ids = await sembrar(t, [{ nombre: "Platos", platos: [{ nombre: "Milanesa" }, { nombre: "Ravioles" }] }]);
        await ingresar(page, t[rol], t);

        // Se ve todo y el aviso explica por qué no se edita.
        await expect(plato(page, "Milanesa")).toBeVisible();
        await expect(page.getByTestId("carta-bloqueada")).toContainText(texto);
        await expectNoHorizontalOverflow(page);

        // Ningún control de edición está habilitado.
        for (const nombre of ["Subir Platos", "Bajar Platos", "Desactivar Platos", "Bajar Milanesa", "Desactivar Milanesa", "Desactivar Ravioles"]) {
          await expect(page.getByRole("button", { name: nombre })).toBeDisabled();
        }
        await expect(page.getByRole("button", { name: "Crear categoría" })).toBeDisabled();
        await expect(page.getByLabel("Nombre de la categoría")).toBeDisabled();

        // Acción forzada desde la pantalla de la fila: se quita `disabled` a mano y se envía.
        await page.getByRole("button", { name: "Desactivar Milanesa" }).evaluate((el: HTMLButtonElement) => {
          el.disabled = true; // el botón sigue sin poder enviar: se arma el envío a mano con su formulario
          const form = el.form!;
          const intent = document.createElement("input");
          intent.type = "hidden";
          intent.name = "intent";
          intent.value = "deactivate";
          form.append(intent);
          form.requestSubmit();
        });
        await expect(plato(page, "Milanesa").getByRole("alert")).toContainText(texto);
        await expect(plato(page, "Milanesa").getByRole("status")).toHaveCount(0);

        // Lo mismo desde el formulario del plato, con los campos habilitados a mano.
        await page.goto(`/panel/${t.slug}/carta/platos/${ids.Milanesa}`);
        await expect(page.getByTestId("carta-bloqueada")).toContainText(texto);
        await expect(page.getByLabel("Precio en pesos")).toBeDisabled();
        await page.locator("form").filter({ has: page.getByRole("button", { name: "Guardar cambios", exact: true }) })
          .locator("fieldset").first().evaluate((el: HTMLFieldSetElement) => (el.disabled = false));
        await page.getByLabel("Precio en pesos").fill("99999");
        await page.getByRole("button", { name: "Guardar cambios" }).click();
        await expect(alerta(page)).toContainText(texto);

        // Y subiendo una foto.
        await page.locator("form").filter({ has: page.getByRole("button", { name: "Guardar foto", exact: true }) })
          .locator("fieldset").first().evaluate((el: HTMLFieldSetElement) => (el.disabled = false));
        await page.getByLabel("Elegir una foto").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: FOTO_PNG });
        await page.getByRole("button", { name: "Guardar foto" }).click();
        await expect(alerta(page).last()).toContainText(texto);

        // Nada cambió en la base.
        const { data } = await service().from("products").select("name, price_cents, is_active, image_path").eq("id", ids.Milanesa).single();
        expect(data).toEqual({ name: "Milanesa", price_cents: 150000, is_active: true, image_path: null });
        const archivos = await service().storage.from("product-images").list(`${t.orgId}/${ids.Milanesa}`);
        expect(archivos.data ?? []).toHaveLength(0);
      });
    }
  }

  test("en gracia se edita con normalidad", async ({ page }) => {
    const t = await nuevoLocal("carta-gracia", "grace");
    await sembrar(t, [{ nombre: "Platos", platos: [{ nombre: "Milanesa" }, { nombre: "Ravioles" }] }]);
    await ingresar(page, t.owner, t);
    await expect(page.getByTestId("carta-bloqueada")).toHaveCount(0);
    await page.getByRole("button", { name: "Bajar Milanesa" }).click();
    await expect.poll(() => nombresDePlatos(page, "Platos")).toEqual(["Ravioles", "Milanesa"]);
  });
});

test.describe("aislamiento entre locales y acceso", () => {
  test("sin sesión pide ingresar; otro local recibe 404; un plato ajeno es 404", async ({ page, context }) => {
    const a = await nuevoLocal("carta-aislado-a");
    const b = await nuevoLocal("carta-aislado-b");
    const idsB = await sembrar(b, [{ nombre: "Secreta", platos: [{ nombre: "Plato ajeno" }] }]);

    await page.goto(`/panel/${a.slug}/carta`);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=`));
    await context.clearCookies();

    await login(page, a.owner.email, a.owner.password);
    const otroLocal = await page.goto(`/panel/${b.slug}/carta`);
    expect(otroLocal?.status()).toBe(404);
    await expect(page.getByText("Secreta")).toHaveCount(0);

    // Un id de plato de otro local, en la URL de mi local.
    const ajeno = await page.goto(`/panel/${a.slug}/carta/platos/${idsB["Plato ajeno"]}`);
    expect(ajeno?.status()).toBe(404);
    const inexistente = await page.goto(`/panel/${a.slug}/carta/platos/00000000-0000-4000-8000-000000000000`);
    expect(inexistente?.status()).toBe(404);
    const malformado = await page.goto(`/panel/${a.slug}/carta/platos/no-es-un-id`);
    expect(malformado?.status()).toBe(404);
  });

  test("un formulario manipulado (local ajeno, plato ajeno) no escribe en el otro local", async ({ page }) => {
    const a = await nuevoLocal("carta-manip-a");
    const b = await nuevoLocal("carta-manip-b");
    const idsA = await sembrar(a, [{ nombre: "Platos", platos: [{ nombre: "Milanesa" }] }]);
    const idsB = await sembrar(b, [{ nombre: "Platos", platos: [{ nombre: "Plato ajeno" }] }]);
    await ingresar(page, a.owner, a);

    // 1) Cambia el campo oculto «org» por el local ajeno: la acción exige membresía de ese local.
    await page.getByLabel("Nombre de la categoría").fill("Intrusa");
    await page.locator('form input[name="org"]').first().evaluate((el: HTMLInputElement, slug) => (el.value = slug), b.slug);
    await page.getByRole("button", { name: "Crear categoría" }).click();
    await expect.poll(async () => (await service().from("categories").select("id").eq("name", "Intrusa")).data?.length).toBe(0);

    // 2) En mi local, apunta una fila al id de un plato ajeno.
    await page.goto(`/panel/${a.slug}/carta`);
    await page.locator(`${'[data-testid="plato"]'} input[name="id"]`).first().evaluate((el: HTMLInputElement, id) => (el.value = id), idsB["Plato ajeno"]);
    await plato(page, "Milanesa").getByRole("button", { name: "Desactivar Milanesa" }).click();
    await expect(plato(page, "Milanesa").getByRole("alert")).toBeVisible();
    const ajeno = await service().from("products").select("is_active").eq("id", idsB["Plato ajeno"]).single();
    expect(ajeno.data?.is_active).toBe(true);
    const propio = await service().from("products").select("is_active").eq("id", idsA.Milanesa).single();
    expect(propio.data?.is_active).toBe(true);
  });
});

test.describe("borrado de platos y categorías", () => {
  const archivosDe = async (t: Tenant, platoId: string) =>
    (await service().storage.from("product-images").list(`${t.orgId}/${platoId}`)).data ?? [];

  async function subirFoto(page: Page, t: Tenant, platoId: string) {
    await page.goto(`/panel/${t.slug}/carta/platos/${platoId}`);
    await page.getByLabel("Elegir una foto").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: FOTO_PNG });
    await page.getByRole("button", { name: "Guardar foto" }).click();
    await expect(estado(page)).toHaveText("Foto guardada.");
  }

  test("borra un plato en dos pasos desde su pantalla: desaparece de la carta, de la pública y de Storage", async ({ page }) => {
    const t = await nuevoLocal("carta-borrar-plato");
    const ids = await sembrar(t, [{ nombre: "Platos", platos: [{ nombre: "Milanesa" }, { nombre: "Ravioles" }] }]);
    await ingresar(page, t.owner, t);
    await subirFoto(page, t, ids.Milanesa);
    expect(await archivosDe(t, ids.Milanesa)).toHaveLength(1);

    await page.goto(`/panel/${t.slug}/carta/platos/${ids.Milanesa}`);
    await expectNoHorizontalOverflow(page);
    // Primer paso: solo explica; nada se borra todavía.
    await page.locator("summary", { hasText: "Borrar plato" }).click();
    await expect(page.getByText("No se puede deshacer.")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect((await service().from("products").select("id").eq("id", ids.Milanesa)).data).toHaveLength(1);

    // Segundo paso.
    await page.getByRole("button", { name: "Sí, borrar el plato definitivamente" }).click();
    await expect(page).toHaveURL(new RegExp(`/panel/${t.slug}/carta\\?borrado=plato`));
    await expect(page.getByTestId("aviso-borrado")).toHaveText("Plato borrado.");
    await expect(plato(page, "Milanesa")).toHaveCount(0);
    await expect(plato(page, "Ravioles")).toBeVisible();

    expect((await service().from("products").select("id").eq("id", ids.Milanesa)).data).toHaveLength(0);
    expect(await archivosDe(t, ids.Milanesa)).toHaveLength(0);
    expect(await nombresPublicos(page, t)).not.toContain("Milanesa");
    // La pantalla del plato borrado ya no existe.
    expect((await page.goto(`/panel/${t.slug}/carta/platos/${ids.Milanesa}`))?.status()).toBe(404);
  });

  test("borra una categoría con platos: exige escribir el nombre, y borra platos y fotos de esa categoría solamente", async ({ page }) => {
    const t = await nuevoLocal("carta-borrar-cat");
    const ids = await sembrar(t, [
      { nombre: "Postres", platos: [{ nombre: "Flan" }, { nombre: "Helado", activo: false }] },
      { nombre: "Bebidas", platos: [{ nombre: "Agua" }] },
    ]);
    await ingresar(page, t.owner, t);
    await subirFoto(page, t, ids.Flan);
    await subirFoto(page, t, ids.Agua);

    await page.goto(`/panel/${t.slug}/carta`);
    const postres = categoria(page, "Postres");
    await postres.locator("summary", { hasText: "Borrar categoría" }).click();
    await expect(postres.getByText("2 platos")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Con un nombre equivocado, el servidor no borra.
    await postres.getByLabel(/Para confirmar, escribí/).fill("postres");
    await postres.getByRole("button", { name: "Sí, borrar la categoría definitivamente" }).click();
    await expect(postres.getByRole("alert")).toContainText("no coincide");
    expect((await service().from("categories").select("id").eq("id", ids.Postres)).data).toHaveLength(1);
    expect(await archivosDe(t, ids.Flan)).toHaveLength(1);

    await postres.getByLabel(/Para confirmar, escribí/).fill("Postres");
    await postres.getByRole("button", { name: "Sí, borrar la categoría definitivamente" }).click();
    await expect(page).toHaveURL(new RegExp(`/panel/${t.slug}/carta\\?borrado=categoria&platos=2`));
    await expect(page.getByTestId("aviso-borrado")).toHaveText("Categoría borrada, con 2 platos.");
    expect(await nombresDeCategorias(page)).toEqual(["Bebidas"]);

    expect((await service().from("categories").select("id").eq("id", ids.Postres)).data).toHaveLength(0);
    expect((await service().from("products").select("id").in("id", [ids.Flan, ids.Helado])).data).toHaveLength(0);
    expect(await archivosDe(t, ids.Flan)).toHaveLength(0);
    // La otra categoría conserva su plato y su foto.
    expect(await archivosDe(t, ids.Agua)).toHaveLength(1);
    expect(await nombresPublicos(page, t)).not.toContain("Postres");
  });

  test("una categoría vacía se borra sin escribir el nombre; si cambió mientras tanto, no se borra nada", async ({ page }) => {
    const t = await nuevoLocal("carta-borrar-vacia");
    const ids = await sembrar(t, [
      { nombre: "Vacía", platos: [] },
      { nombre: "Cambia", platos: [{ nombre: "Uno" }] },
    ]);
    await ingresar(page, t.owner, t);

    const vacia = categoria(page, "Vacía");
    await vacia.locator("summary", { hasText: "Borrar categoría" }).click();
    await expect(vacia.getByLabel(/Para confirmar, escribí/)).toHaveCount(0);
    await vacia.getByRole("button", { name: "Sí, borrar la categoría definitivamente" }).click();
    await expect(page.getByTestId("aviso-borrado")).toHaveText("Categoría borrada.");

    // «Cambia» se mostró con 1 plato; otra persona le agrega uno antes de confirmar.
    const cambia = categoria(page, "Cambia");
    await cambia.locator("summary", { hasText: "Borrar categoría" }).click();
    await cambia.getByLabel(/Para confirmar, escribí/).fill("Cambia");
    const nuevo = await service().from("products").insert({ organization_id: t.orgId, category_id: ids.Cambia, name: "Dos", price_cents: 1000, sort_order: 5 });
    expect(nuevo.error).toBeNull();
    await cambia.getByRole("button", { name: "Sí, borrar la categoría definitivamente" }).click();
    await expect(cambia.getByRole("alert")).toContainText("cambió");
    expect((await service().from("categories").select("id").eq("id", ids.Cambia)).data).toHaveLength(1);
    expect((await service().from("products").select("id").eq("category_id", ids.Cambia)).data).toHaveLength(2);
  });

  test("el Staff también borra", async ({ page }) => {
    const staffLocal = await nuevoLocal("carta-borrar-staff");
    const idsStaff = await sembrar(staffLocal, [{ nombre: "Platos", platos: [{ nombre: "Milanesa" }] }]);
    await ingresar(page, staffLocal.staff, staffLocal, `/carta/platos/${idsStaff.Milanesa}`);
    await page.locator("summary", { hasText: "Borrar plato" }).click();
    await page.getByRole("button", { name: "Sí, borrar el plato definitivamente" }).click();
    await expect(page.getByTestId("aviso-borrado")).toHaveText("Plato borrado.");
    expect((await service().from("products").select("id").eq("id", idsStaff.Milanesa)).data).toHaveLength(0);
  });

  for (const rol of ["owner", "staff"] as const) {
    test(`en solo lectura (${rol}) el borrado está deshabilitado y una acción forzada no borra ni dice que borró`, async ({ page }) => {
      const t = await nuevoLocal(`carta-borrar-ro-${rol}`, "read_only");
      const ids = await sembrar(t, [{ nombre: "Platos", platos: [{ nombre: "Milanesa" }] }]);
      await ingresar(page, t[rol], t);

      const cat = categoria(page, "Platos");
      await cat.locator("summary", { hasText: "Borrar categoría" }).click();
      await expect(cat.getByRole("button", { name: "Sí, borrar la categoría definitivamente" })).toBeDisabled();

      // Forzado: se habilita el bloque a mano y se confirma con el nombre.
      await cat.locator("fieldset").filter({ has: page.getByRole("button", { name: "Sí, borrar la categoría definitivamente" }) })
        .evaluate((el: HTMLFieldSetElement) => (el.disabled = false));
      await cat.getByLabel(/Para confirmar, escribí/).fill("Platos");
      await cat.getByRole("button", { name: "Sí, borrar la categoría definitivamente" }).click();
      await expect(cat.getByRole("alert")).toContainText("solo lectura");
      await expect(cat.getByRole("status")).toHaveCount(0);

      await page.goto(`/panel/${t.slug}/carta/platos/${ids.Milanesa}`);
      await page.locator("summary", { hasText: "Borrar plato" }).click();
      await expect(page.getByRole("button", { name: "Sí, borrar el plato definitivamente" })).toBeDisabled();
      await page.locator("form").filter({ has: page.getByRole("button", { name: "Sí, borrar el plato definitivamente" }) })
        .locator("fieldset").first().evaluate((el: HTMLFieldSetElement) => (el.disabled = false));
      await page.getByRole("button", { name: "Sí, borrar el plato definitivamente" }).click();
      await expect(alerta(page)).toContainText("solo lectura");

      expect((await service().from("products").select("id").eq("id", ids.Milanesa)).data).toHaveLength(1);
      expect((await service().from("categories").select("id").eq("id", ids.Platos)).data).toHaveLength(1);
    });
  }
});
