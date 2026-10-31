import { expect, test, type Page } from "@playwright/test";
import { alerta, createTenant, expectNoHorizontalOverflow, login, service, type Estado, type Tenant } from "./support";

const tenants: Tenant[] = [];
async function tenant(label: string, state: Estado = "active") {
  const t = await createTenant(label, state);
  tenants.push(t);
  return t;
}
test.afterAll(async () => {
  for (const t of tenants) {
    const files = await service().storage.from("organization-logos").list(t.orgId);
    if (files.data?.length) await service().storage.from("organization-logos").remove(files.data.map(f => `${t.orgId}/${f.name}`));
    await t.cleanup();
  }
});
/** Cambia de pestaña en Apariencia (Marca, Estilo, Detalles o Fechas especiales). */
async function tab(page: Page, name: string) {
  await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
}
async function editor(page: Page, t: Tenant, width = 1280) {
  // El panel se prueba en escritorio por defecto (la vista previa fija al costado aparece desde 1280 px); la de celular pide 390.
  await page.setViewportSize({ width, height: 900 });
  // Sin desplazamiento suave (`html { scroll-behavior: smooth }`): la página es larga y Playwright mide el botón mientras aún se desplaza.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page, t.owner.email, t.owner.password);
  await page.goto(`/panel/${t.slug}/apariencia`);
}
const identity = async (t: Tenant) => (await service().from("organizations").select("menu_palette, menu_layout, menu_theme, logo_path").eq("id", t.orgId).single()).data!;

test("el Dueño publica colores y logo; persisten en carta y QR sin mezclar locales ni alterar el panel", async ({ page, context }) => {
  const t = await tenant("marca");
  const other = await tenant("otra-marca");
  const db = service();
  const branch = (await db.from("branches").select("id").eq("organization_id", t.orgId).single()).data!;
  const table = await db.from("tables").insert({ organization_id: t.orgId, branch_id: branch.id, label: "Mesa 1" }).select("qr_token").single();
  expect(table.error).toBeNull();
  const category = (await db.from("categories").insert({ organization_id: t.orgId, name: "De la casa" }).select("id").single()).data!;
  await db.from("products").insert({ organization_id: t.orgId, category_id: category.id, name: "Plato del día", price_cents: 180000 });

  const publicPage = await context.newPage();
  await publicPage.goto(`/m/${t.slug}/centro`); // Calienta la caché de filas antes de editar la identidad.
  await expect(publicPage.locator(".carta")).toHaveCSS("background-color", "rgb(244, 239, 228)");
  await editor(page, t);
  await expect(page.getByRole("link", { name: "Apariencia", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("radio", { name: "Vino", exact: true }).check();
  await expect(page.getByTestId("apariencia-preview")).toHaveCSS("background-color", "rgb(251, 243, 232)");
  await page.getByRole("button", { name: "Guardar apariencia" }).click();
  await expect(page.getByRole("status")).toContainText("Apariencia guardada.");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(246, 245, 240)");
  await page.reload();
  await expect(page.getByRole("radio", { name: "Vino", exact: true })).toBeChecked();
  expect((await identity(other)).menu_palette).toBe("oliva");

  // Una paleta oscura: la carta pública se oscurece, el texto sobre el acento pasa a oscuro y el panel del Dueño sigue claro.
  await page.getByRole("radio", { name: "Carbón", exact: true }).check();
  await expect(page.getByTestId("apariencia-preview")).toHaveCSS("background-color", "rgb(22, 20, 18)");
  await page.getByRole("button", { name: "Guardar apariencia" }).click();
  await expect(page.getByRole("status")).toContainText("Apariencia guardada.");
  await expect(page.locator(".panel").first()).toHaveCSS("background-color", "rgb(245, 241, 234)");
  await publicPage.reload();
  await expect(publicPage.locator(".carta")).toHaveCSS("background-color", "rgb(22, 20, 18)");
  await expect(publicPage.locator(".carta")).toHaveCSS("--on-accent", "#161412");
  await page.getByRole("radio", { name: "Vino", exact: true }).check();
  await page.getByRole("button", { name: "Guardar apariencia" }).click();
  await expect(page.getByRole("status")).toContainText("Apariencia guardada.");

  // Estilo de carta: la clásica no tiene mosaico, lista los platos con su precio y la barra de categorías es siempre visible.
  await expect(publicPage.locator(".carta")).toHaveAttribute("data-layout", "bento");
  await page.getByRole("radio", { name: "Clásica" }).check();
  await expect(page.getByTestId("apariencia-preview").locator("nav")).toHaveCount(0); // sin mosaico
  await page.getByRole("button", { name: "Guardar apariencia" }).click();
  await expect.poll(async () => (await identity(t)).menu_layout).toBe("clasica");
  expect((await identity(other)).menu_layout).toBe("bento");
  await publicPage.reload();
  await expect(publicPage.locator(".carta")).toHaveAttribute("data-layout", "clasica");
  await expect(publicPage.getByRole("navigation", { name: "Categorías de la carta" })).toHaveCount(0);
  await expect(publicPage.getByRole("navigation", { name: "Cambiar de categoría" })).toBeVisible();
  await expect(publicPage.getByRole("button", { name: "Ver detalle de Plato del día" })).toBeVisible();
  await page.getByRole("radio", { name: "Minimal" }).check();
  await page.getByRole("button", { name: "Guardar apariencia" }).click();
  await expect.poll(async () => (await identity(t)).menu_layout).toBe("minimal");
  await expect(page.getByRole("button", { name: "Guardar apariencia" })).toBeEnabled(); // terminó: el aviso ya está en pantalla y no mueve el resto // el aviso de la vez anterior sigue en pantalla
  await publicPage.reload();
  await expect(publicPage.locator(".carta")).toHaveAttribute("data-layout", "minimal");
  // Afiche: sin mosaico, título de categoría en la condensada, platos numerados y la fila entera abre el detalle.
  await page.getByRole("radio", { name: "Afiche" }).check();
  await expect(page.getByTestId("apariencia-preview")).toHaveAttribute("data-layout", "afiche");
  await page.getByRole("button", { name: "Guardar apariencia" }).click();
  await expect.poll(async () => (await identity(t)).menu_layout).toBe("afiche");
  await expect(page.getByRole("button", { name: "Guardar apariencia" })).toBeEnabled();
  expect((await identity(other)).menu_layout).toBe("bento");
  await publicPage.reload();
  await expect(publicPage.locator(".carta")).toHaveAttribute("data-layout", "afiche");
  await expect(publicPage.getByRole("navigation", { name: "Categorías de la carta" })).toHaveCount(0);
  await expect(publicPage.getByRole("navigation", { name: "Cambiar de categoría" })).toBeVisible();
  const section = publicPage.getByRole("heading", { name: "De la casa", level: 2 });
  await expect(section).toHaveCSS("text-transform", "uppercase");
  await expect(section).toHaveCSS("font-family", /Big Shoulders/);
  await expect(publicPage.locator(".afiche-row").first()).toContainText("01");
  await publicPage.getByRole("button", { name: "Ver detalle de Plato del día" }).click();
  await expect(publicPage.getByRole("dialog")).toContainText("Plato del día");
  await publicPage.keyboard.press("Escape");
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(publicPage);
  // Hoja: página de columnas, solo texto (nunca fotos de plato) y sin detalle de plato.
  await page.getByRole("radio", { name: "Hoja" }).check();
  await expect(page.getByTestId("apariencia-preview")).toHaveAttribute("data-layout", "hoja");
  await page.getByRole("button", { name: "Guardar apariencia" }).click();
  await expect.poll(async () => (await identity(t)).menu_layout).toBe("hoja");
  await expect(page.getByRole("button", { name: "Guardar apariencia" })).toBeEnabled();
  expect((await identity(other)).menu_layout).toBe("bento");
  await publicPage.reload();
  await expect(publicPage.locator(".carta")).toHaveAttribute("data-layout", "hoja");
  await expect(publicPage.locator(".sheet-columns")).toHaveCSS("column-count", "2");
  await expect(publicPage.locator(".sheet-columns img")).toHaveCount(0);
  // Como un visor de PDF: solo la página, sin buscador ni barra de categorías.
  await expect(publicPage.getByRole("search")).toHaveCount(0);
  await expect(publicPage.getByRole("navigation", { name: "Cambiar de categoría" })).toHaveCount(0);
  await expect(publicPage.getByRole("heading", { name: "De la casa", level: 2 })).toBeVisible();
  // Las filas son solo texto: no se tocan ni abren el detalle del plato.
  await expect(publicPage.getByText("Plato del día").first()).toBeVisible();
  await expect(publicPage.getByRole("button", { name: /Ver detalle/ })).toHaveCount(0);
  await expectNoHorizontalOverflow(publicPage);
  await page.getByRole("radio", { name: "Bento" }).check();
  await page.getByRole("button", { name: "Guardar apariencia" }).click();
  await expect.poll(async () => (await identity(t)).menu_layout).toBe("bento");
  await expect(page.getByRole("button", { name: "Guardar apariencia" })).toBeEnabled(); // terminó: el aviso ya está en pantalla y no mueve el resto

  // Fecha especial: dentro de la ventana la carta lleva el tema (saludo y patrón); vencida o apagada, vuelve a la normal.
  const today = new Date();
  const day = (offset: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(today.getTime() + offset * 86_400_000));
  await expect(publicPage.locator(".carta")).not.toHaveAttribute("data-tema", /.+/);
  await tab(page, "Fechas especiales");
  await page.getByRole("radio", { name: "Navidad" }).check();
  await expect(page.getByTestId("apariencia-preview")).toHaveAttribute("data-tema", "navidad");
  await page.locator("#tema-desde").fill(day(-1));
  await page.locator("#tema-hasta").fill(day(1));
  await page.getByRole("button", { name: "Guardar fecha especial" }).click();
  await expect.poll(async () => (await identity(t)).menu_theme).toBe("navidad");
  await expect(page.getByTestId("tema-estado")).toContainText("Navidad: activo hoy");
  await publicPage.reload();
  await expect(publicPage.locator(".carta")).toHaveAttribute("data-tema", "navidad");
  await expect(publicPage.getByTestId("tema-saludo")).toHaveText("Feliz Navidad");
  await expect(publicPage.locator(".carta")).toHaveCSS("--tema-opacidad", "0.07");
  // Una ventana ya vencida deja la carta normal, sin tocar nada más.
  await page.locator("#tema-desde").fill("2020-01-01");
  await page.locator("#tema-hasta").fill("2020-01-02");
  await page.getByRole("button", { name: "Guardar fecha especial" }).click();
  await expect(page.getByTestId("tema-estado")).toContainText("venció el 2 de enero de 2020");
  await publicPage.reload();
  await expect(publicPage.locator(".carta")).not.toHaveAttribute("data-tema", /.+/);
  await expect(publicPage.getByTestId("tema-saludo")).toHaveCount(0);
  // «Hasta» anterior a «Desde»: se avisa y la base no cambia.
  await page.locator("#tema-desde").fill(day(1));
  await page.locator("#tema-hasta").fill(day(-1));
  await expect(page.locator("#tema-ayuda")).toContainText("no puede ser anterior");
  await page.getByRole("radio", { name: "Ninguno" }).check();
  await page.getByRole("button", { name: "Guardar fecha especial" }).click();
  await expect.poll(async () => (await identity(t)).menu_theme).toBe("ninguno");
  expect((await identity(other)).menu_theme).toBe("ninguno");
  await expect(page.getByTestId("tema-estado")).toContainText("Sin tema");

  await tab(page, "Marca");
  // Logo sintético de prueba, rectangular y transparente, para verificar object-fit y el optimizador.
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 480; canvas.height = 160;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#713a4a"; ctx.font = "bold 72px Georgia";
    ctx.fillText("LOCAL", 100, 100);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const logoFile = { name: "logo.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") };
  await page.locator('input[name="logo"]').setInputFiles(logoFile);
  await page.getByRole("button", { name: "Guardar logo", exact: true }).click();
  await expect(page.getByRole("img", { name: `Logo actual de ${t.name}` })).toBeVisible();
  const first = (await identity(t)).logo_path;

  await publicPage.reload();
  await expect(publicPage.locator(".carta")).toHaveCSS("background-color", "rgb(251, 243, 232)");
  const logo = publicPage.getByRole("img", { name: `Logo de ${t.name}`, exact: true });
  await expect(logo).toHaveAttribute("src", /\/_next\/image\?/);
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(logo).toHaveCSS("object-fit", "contain");
  await expect(publicPage.getByText("Plato del día", { exact: true })).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await publicPage.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
    await expectNoHorizontalOverflow(publicPage);
    await page.screenshot({ path: `output/playwright/identidad/panel-${width}.png`, fullPage: true });
    await publicPage.screenshot({ path: `output/playwright/identidad/carta-${width}.png`, fullPage: true });
  }
  await publicPage.goto(`/t/${table.data!.qr_token}`);
  await expect(publicPage.getByTestId("mesa")).toContainText("Mesa 1");
  await expect(publicPage.locator(".carta")).toHaveCSS("background-color", "rgb(251, 243, 232)");
  await expect(publicPage.getByRole("img", { name: `Logo de ${t.name}`, exact: true })).toBeVisible();

  await page.locator('input[name="logo"]').setInputFiles(logoFile);
  await page.getByRole("button", { name: "Guardar logo", exact: true }).click();
  await expect.poll(async () => (await identity(t)).logo_path).not.toBe(first);
  await page.getByRole("button", { name: "Quitar logo", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Logo quitado" })).toBeVisible();
  await publicPage.reload();
  await expect(publicPage.getByRole("img", { name: `Logo de ${t.name}`, exact: true })).toHaveCount(0);
  await expect(publicPage.getByRole("heading", { name: t.name, exact: true })).toBeVisible();
  await publicPage.close();
});

test("tras guardar, la opción elegida sigue marcada (colores, estilo y fechas) sin recargar", async ({ page }) => {
  const t = await tenant("marca-sigue");
  await editor(page, t);
  await page.getByRole("radio", { name: "Vino", exact: true }).check();
  await page.getByRole("button", { name: "Guardar apariencia" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Apariencia guardada." })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Vino", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: "Carbón", exact: true }).check();
  await page.getByRole("button", { name: "Guardar apariencia" }).click();
  await expect.poll(async () => (await identity(t)).menu_palette).toBe("carbon");
  await expect(page.getByRole("button", { name: "Guardar apariencia" })).toBeEnabled();
  await expect(page.getByRole("radio", { name: "Carbón", exact: true })).toBeChecked();

  await page.getByRole("radio", { name: "Clásica" }).check();
  await page.getByRole("button", { name: "Guardar apariencia" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Apariencia guardada." })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Clásica" })).toBeChecked();

  await tab(page, "Fechas especiales");
  await page.getByRole("radio", { name: "Navidad" }).check();
  await page.getByLabel("Desde (opcional)").fill("2030-12-01");
  await page.getByLabel("Hasta (opcional)").fill("2030-12-31");
  await page.getByRole("button", { name: "Guardar fecha especial" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Fecha especial guardada." })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Navidad" })).toBeChecked();
  await expect(page.getByLabel("Desde (opcional)")).toHaveValue("2030-12-01");
  await expect(page.getByLabel("Hasta (opcional)")).toHaveValue("2030-12-31");
});

test("Staff no ve Apariencia y una dirección directa lo devuelve al inicio", async ({ page }) => {
  const t = await tenant("marca-staff");
  await login(page, t.staff.email, t.staff.password);
  await page.goto(`/panel/${t.slug}`);
  await expect(page.getByRole("link", { name: "Apariencia", exact: true })).toHaveCount(0);
  await page.goto(`/panel/${t.slug}/apariencia`);
  await expect(page).toHaveURL(`/panel/${t.slug}`);
});

for (const state of ["read_only", "suspended"] as const) {
  test(`la cuenta ${state} muestra la configuración sin permitir cambios`, async ({ page }) => {
    const t = await tenant(`marca-${state.replaceAll("_", "-")}`, state);
    await editor(page, t);
    await expect(page.getByRole("heading", { name: "Apariencia", level: 1 })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Vino", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Guardar apariencia" })).toBeDisabled();
    await expect(page.locator('input[name="logo"]')).toBeDisabled();
    if (state === "suspended") {
      await page.goto(`/m/${t.slug}/centro`);
      await expect(page.getByText("Carta temporalmente no disponible", { exact: true })).toBeVisible();
    }
  });
}

test("rechaza un archivo con tipo fingido sin publicar un logo", async ({ page }) => {
  const t = await tenant("marca-invalida");
  await editor(page, t);
  await tab(page, "Marca");
  await page.locator('input[name="logo"]').setInputFiles({ name: "falso.png", mimeType: "image/png", buffer: Buffer.from("<svg></svg>") });
  await page.getByRole("button", { name: "Guardar logo", exact: true }).click();
  await expect(alerta(page)).toContainText("Usá un logo PNG, JPEG o WebP");
  expect((await identity(t)).logo_path).toBeNull();
});

test("el Dueño publica tipografía, forma, ambientación, datos y portada; se ven en la carta y no se mezclan los locales", async ({ page, context }) => {
  const t = await tenant("personaliza");
  const other = await tenant("personaliza-otra");
  const db = service();
  const category = (await db.from("categories").insert({ organization_id: t.orgId, name: "De la casa" }).select("id").single()).data!;
  await db.from("products").insert({ organization_id: t.orgId, category_id: category.id, name: "Plato del día", price_cents: 180000 });
  const publicPage = await context.newPage();
  await publicPage.goto(`/m/${t.slug}/centro`);
  const carta = publicPage.locator(".carta");
  await expect(carta).toHaveAttribute("data-fuente", "clasica");
  await expect(carta).toHaveAttribute("data-forma", "suave");
  await expect(carta).not.toHaveAttribute("data-ambiente", /.+/);
  await editor(page, t);
  const row = async (x: Tenant) => (await service().from("organizations").select("menu_font, menu_shape, menu_density, menu_ambient, menu_tagline, opening_hours, instagram_handle, whatsapp_number, cover_path").eq("id", x.orgId).single()).data!;
  const preview = page.getByTestId("apariencia-preview");

  // Tipografía (pestaña Estilo): la vista previa lo muestra antes de guardar y recién guardado cambia la carta pública.
  await page.locator(`input[name="ui-font"][value="bodegon"]`).check();
  await expect(preview).toHaveAttribute("data-fuente", "bodegon");
  expect((await row(t)).menu_font).toBe("clasica"); // nada se guardó todavía
  await page.getByRole("button", { name: "Guardar apariencia" }).click();
  await expect.poll(async () => (await row(t)).menu_font).toBe("bodegon");
  await publicPage.reload();
  await expect(carta).toHaveAttribute("data-fuente", "bodegon");
  await expect(publicPage.getByRole("heading", { level: 1 })).toHaveCSS("font-family", /Alfa Slab One/);
  await expect(publicPage.locator(".carta p").first()).not.toHaveCSS("font-family", /Alfa Slab One/);
  expect((await row(other)).menu_font).toBe("clasica");

  // Forma, densidad y ambientación (pestaña Detalles): se guardan juntas con el mismo botón.
  await tab(page, "Detalles");
  await page.getByRole("radio", { name: "Recta" }).check();
  await page.getByRole("radio", { name: "Compacta" }).check();
  await page.getByRole("radio", { name: "Cuadros" }).check();
  await expect(preview).toHaveAttribute("data-forma", "recta");
  await expect(preview).toHaveAttribute("data-ambiente", "cuadros");
  await page.getByRole("button", { name: "Guardar apariencia" }).click();
  await expect.poll(async () => (await row(t)).menu_shape).toBe("recta");
  expect(await row(t)).toMatchObject({ menu_density: "compacta", menu_ambient: "cuadros", menu_font: "bodegon" });
  await publicPage.reload();
  await expect(carta).toHaveAttribute("data-forma", "recta");
  await expect(carta).toHaveAttribute("data-densidad", "compacta");
  await expect(carta).toHaveAttribute("data-ambiente", "cuadros");
  await expect(carta).toHaveCSS("--ambiente-opacidad", "0.07");
  await expect(publicPage.locator(".carta-chip").first()).toHaveCSS("border-top-left-radius", "0px");
  // Con un tema de fecha vigente, el tema manda y la textura no se dibuja.
  await db.from("organizations").update({ menu_theme: "navidad" }).eq("id", t.orgId);
  await publicPage.reload();
  await expect(carta).not.toHaveAttribute("data-ambiente", /.+/);
  await expect(carta).toHaveAttribute("data-tema", "navidad");
  await db.from("organizations").update({ menu_theme: "ninguno" }).eq("id", t.orgId);

  // Datos del local (pestaña Marca): lema y redes arriba, con el logo de cada app; horarios en el pie.
  await tab(page, "Marca");
  await page.locator("#voz-lema").fill("Café de especialidad desde 2014");
  await expect(preview.getByTestId("lema")).toHaveText("Café de especialidad desde 2014"); // la vista previa lo muestra al escribir
  await page.locator("#voz-horarios").fill("Lun a sáb de 8 a 20 hs");
  await page.locator("#voz-instagram").fill("https://www.instagram.com/mi.local/");
  await page.locator("#voz-whatsapp").fill("+54 9 11 1234-5678");
  await expect(preview.getByTestId("contacto-instagram")).toHaveText("@mi.local");
  await page.getByRole("button", { name: "Guardar datos del local" }).click();
  await expect.poll(async () => (await row(t)).instagram_handle).toBe("mi.local");
  expect(await row(t)).toMatchObject({ menu_tagline: "Café de especialidad desde 2014", opening_hours: "Lun a sáb de 8 a 20 hs", whatsapp_number: "5491112345678" });
  await publicPage.reload();
  await expect(publicPage.getByTestId("lema")).toHaveText("Café de especialidad desde 2014");
  await expect(publicPage.getByTestId("contacto")).toContainText("Lun a sáb de 8 a 20 hs");
  // Instagram y WhatsApp van arriba (en la cabecera, antes de los platos) y con el logo de cada app; los horarios, en el pie.
  await expect(publicPage.locator("header").getByTestId("redes")).toBeVisible();
  await expect(publicPage.getByTestId("contacto").getByTestId("contacto-instagram")).toHaveCount(0);
  await expect(publicPage.getByTestId("contacto-instagram").locator("svg")).toBeVisible();
  await expect(publicPage.getByTestId("contacto-instagram")).toHaveText("@mi.local");
  await expect(publicPage.getByTestId("contacto-whatsapp").locator("svg")).toBeVisible();
  await expect(publicPage.getByTestId("contacto-instagram")).toHaveAttribute("href", "https://www.instagram.com/mi.local/");
  await expect(publicPage.getByTestId("contacto-whatsapp")).toHaveAttribute("href", "https://wa.me/5491112345678");
  await expect(publicPage.getByTestId("contacto-whatsapp")).toHaveAttribute("rel", /noopener/);
  // Un enlace de otro sitio se rechaza y no se guarda nada.
  await page.locator("#voz-instagram").fill("https://evil.example/x");
  await page.getByRole("button", { name: "Guardar datos del local" }).click();
  await expect(alerta(page)).toContainText("usuario de Instagram");
  expect((await row(t)).instagram_handle).toBe("mi.local");
  expect((await row(other)).menu_tagline).toBeNull();

  // Portada (pestaña Marca): la vista previa muestra la foto elegida antes de guardarla; en celular no hay desborde.
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 450;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#8a5a2b";
    ctx.fillRect(0, 0, 800, 450);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator('input[name="cover"]').setInputFiles({ name: "portada.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(preview.locator("img[alt^='Foto del ambiente']")).toBeVisible();
  expect((await row(t)).cover_path).toBeNull(); // todavía sin guardar
  await page.getByRole("button", { name: "Guardar portada" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Portada guardada." })).toBeVisible();
  expect((await row(t)).cover_path).toMatch(new RegExp(`^${t.orgId}/`));
  expect((await row(other)).cover_path).toBeNull();
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await publicPage.reload();
  const cover = publicPage.locator(`img[alt^="Foto del ambiente de"]`);
  await expect(cover).toBeVisible();
  await expect(cover).toHaveAttribute("src", /organization-logos/);
  await expectNoHorizontalOverflow(publicPage);
  // Hoja es una página de PDF: lleva el lema pero no la portada, y el panel lo avisa.
  await db.from("organizations").update({ menu_layout: "hoja" }).eq("id", t.orgId);
  await publicPage.reload();
  await expect(publicPage.getByTestId("lema")).toHaveText("Café de especialidad desde 2014");
  await expect(publicPage.locator(`img[alt^="Foto del ambiente de"]`)).toHaveCount(0);
  await expect(publicPage.getByTestId("contacto")).toContainText("Lun a sáb de 8 a 20 hs");
  await expect(publicPage.locator("header").getByTestId("contacto-whatsapp")).toBeVisible();
  await page.reload();
  await tab(page, "Marca");
  await expect(page.getByTestId("portada-hoja")).toBeVisible();
  await db.from("organizations").update({ menu_layout: "bento" }).eq("id", t.orgId);
  await page.reload();
  await tab(page, "Marca");
  await expect(page.getByTestId("portada-hoja")).toHaveCount(0);
  // Quitar la portada deja la carta como estaba.
  await page.getByRole("button", { name: "Quitar portada" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Portada quitada." })).toBeVisible();
  expect((await row(t)).cover_path).toBeNull();
  await publicPage.reload();
  await expect(publicPage.locator(`img[alt^="Foto del ambiente de"]`)).toHaveCount(0);
});

test("pestañas y looks: los cambios sin guardar se ven en la vista previa, marcan la pestaña y no se pierden al cambiar de pestaña", async ({ page }) => {
  const t = await tenant("looks");
  await editor(page, t);
  const preview = page.getByTestId("apariencia-preview");
  const estilo = page.getByRole("tab", { name: /^Estilo/ });
  await expect(page.getByRole("tab")).toHaveCount(4);
  await expect(estilo).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("looks")).toBeVisible();

  // Un look cambia a la vez paleta, estilo, tipografía, forma, densidad y ambientación de la vista previa; no guarda nada.
  await page.locator('[data-look="bar"]').click();
  await expect(page.locator('[data-look="bar"]')).toHaveAttribute("aria-pressed", "true");
  await expect(preview).toHaveAttribute("data-layout", "afiche");
  await expect(preview).toHaveAttribute("data-fuente", "nocturna");
  await expect(preview).toHaveAttribute("data-forma", "recta");
  await expect(preview).toHaveCSS("background-color", "rgb(22, 20, 18)"); // Carbón
  expect((await identity(t)).menu_palette).toBe("oliva");
  await expect(estilo).toContainText("cambios sin guardar");
  await expect(page.getByRole("tab", { name: /^Detalles/ })).toContainText("cambios sin guardar"); // comparten el mismo guardado
  await expect(page.getByRole("tab", { name: /^Marca/ })).not.toContainText("cambios sin guardar");

  // Cambiar de pestaña no pierde lo elegido; ajustar un detalle desmarca el look; «Descartar» vuelve a lo guardado.
  await tab(page, "Detalles");
  await page.getByRole("radio", { name: "Aireada" }).check();
  await expect(preview).toHaveAttribute("data-densidad", "aireada");
  await tab(page, "Fechas especiales");
  await tab(page, "Estilo");
  await expect(page.locator('[data-look="bar"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("radio", { name: "Carbón", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Descartar cambios" }).click();
  await expect(preview).toHaveAttribute("data-layout", "bento");
  await expect(page.getByRole("radio", { name: "Oliva", exact: true })).toBeChecked();
  await expect(estilo).not.toContainText("cambios sin guardar");

  // Guardar un look publica las seis opciones en una sola escritura.
  await page.locator('[data-look="bodegon"]').click();
  await page.getByRole("button", { name: "Guardar apariencia" }).click();
  await expect.poll(async () => (await service().from("organizations").select("menu_palette, menu_layout, menu_font, menu_shape, menu_density, menu_ambient").eq("id", t.orgId).single()).data).toEqual({
    menu_palette: "trattoria", menu_layout: "clasica", menu_font: "bodegon", menu_shape: "filete", menu_density: "compacta", menu_ambient: "cuadros",
  });
  await expect(page.getByRole("status").filter({ hasText: "Apariencia guardada." })).toBeVisible();
  await expect(estilo).not.toContainText("cambios sin guardar");
  await page.reload();
  await expect(page.locator('[data-look="bodegon"]')).toHaveAttribute("aria-pressed", "true");

  // La navegación por teclado de las pestañas: flechas, Inicio y Fin.
  await page.getByRole("tab", { name: /^Estilo/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /^Detalles/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Fechas especiales" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: /^Marca/ })).toHaveAttribute("aria-selected", "true");
});

test("en celular la vista previa es una hoja que se abre con un botón y no desborda la pantalla", async ({ page }) => {
  const t = await tenant("looks-celular");
  await editor(page, t, 390);
  await expect(page.getByTestId("apariencia-preview")).toBeHidden();
  await expectNoHorizontalOverflow(page);
  await page.locator('[data-look="brunch"]').click();
  await page.getByTestId("ver-vista-previa").click();
  await expect(page.getByTestId("apariencia-preview")).toBeVisible();
  await expect(page.getByTestId("apariencia-preview")).toHaveAttribute("data-fuente", "moderna");
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("apariencia-preview")).toBeHidden();
  await expect(page.getByTestId("ver-vista-previa")).toBeVisible();
});
