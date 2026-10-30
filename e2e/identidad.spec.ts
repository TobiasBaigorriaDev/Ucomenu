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
async function editor(page: Page, t: Tenant) {
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
  await page.getByRole("button", { name: "Guardar colores" }).click();
  await expect(page.getByRole("status")).toContainText("Colores guardados.");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(246, 245, 240)");
  await page.reload();
  await expect(page.getByRole("radio", { name: "Vino", exact: true })).toBeChecked();
  expect((await identity(other)).menu_palette).toBe("oliva");

  // Una paleta oscura: la carta pública se oscurece, el texto sobre el acento pasa a oscuro y el panel del Dueño sigue claro.
  await page.getByRole("radio", { name: "Carbón", exact: true }).check();
  await expect(page.getByTestId("apariencia-preview")).toHaveCSS("background-color", "rgb(22, 20, 18)");
  await page.getByRole("button", { name: "Guardar colores" }).click();
  await expect(page.getByRole("status")).toContainText("Colores guardados.");
  await expect(page.locator(".panel").first()).toHaveCSS("background-color", "rgb(245, 241, 234)");
  await publicPage.reload();
  await expect(publicPage.locator(".carta")).toHaveCSS("background-color", "rgb(22, 20, 18)");
  await expect(publicPage.locator(".carta")).toHaveCSS("--on-accent", "#161412");
  await page.getByRole("radio", { name: "Vino", exact: true }).check();
  await page.getByRole("button", { name: "Guardar colores" }).click();
  await expect(page.getByRole("status")).toContainText("Colores guardados.");

  // Estilo de carta: la clásica no tiene mosaico, lista los platos con su precio y la barra de categorías es siempre visible.
  await expect(publicPage.locator(".carta")).toHaveAttribute("data-layout", "bento");
  await page.getByRole("radio", { name: "Clásica" }).check();
  await expect(page.getByTestId("apariencia-preview-estilo").locator("nav")).toHaveCount(0); // sin mosaico
  await page.getByRole("button", { name: "Guardar estilo" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Estilo guardado." })).toBeVisible();
  expect((await identity(t)).menu_layout).toBe("clasica");
  expect((await identity(other)).menu_layout).toBe("bento");
  await publicPage.reload();
  await expect(publicPage.locator(".carta")).toHaveAttribute("data-layout", "clasica");
  await expect(publicPage.getByRole("navigation", { name: "Categorías de la carta" })).toHaveCount(0);
  await expect(publicPage.getByRole("navigation", { name: "Cambiar de categoría" })).toBeVisible();
  await expect(publicPage.getByRole("button", { name: "Ver detalle de Plato del día" })).toBeVisible();
  await page.getByRole("radio", { name: "Minimal" }).check();
  await page.getByRole("button", { name: "Guardar estilo" }).click();
  await expect.poll(async () => (await identity(t)).menu_layout).toBe("minimal");
  await expect(page.getByRole("button", { name: "Guardar estilo" })).toBeEnabled(); // terminó: el aviso ya está en pantalla y no mueve el resto // el aviso de la vez anterior sigue en pantalla
  await publicPage.reload();
  await expect(publicPage.locator(".carta")).toHaveAttribute("data-layout", "minimal");
  // Afiche: sin mosaico, título de categoría en la condensada, platos numerados y la fila entera abre el detalle.
  await page.getByRole("radio", { name: "Afiche" }).check();
  await expect(page.getByTestId("apariencia-preview-estilo")).toHaveAttribute("data-layout", "afiche");
  await page.getByRole("button", { name: "Guardar estilo" }).click();
  await expect.poll(async () => (await identity(t)).menu_layout).toBe("afiche");
  await expect(page.getByRole("button", { name: "Guardar estilo" })).toBeEnabled();
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
  // PDF (clave hoja): página de columnas, solo texto (nunca fotos de plato) y sin detalle de plato.
  await page.getByRole("radio", { name: "PDF" }).check();
  await expect(page.getByTestId("apariencia-preview-estilo")).toHaveAttribute("data-layout", "hoja");
  await page.getByRole("button", { name: "Guardar estilo" }).click();
  await expect.poll(async () => (await identity(t)).menu_layout).toBe("hoja");
  await expect(page.getByRole("button", { name: "Guardar estilo" })).toBeEnabled();
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
  await page.getByRole("button", { name: "Guardar estilo" }).click();
  await expect.poll(async () => (await identity(t)).menu_layout).toBe("bento");
  await expect(page.getByRole("button", { name: "Guardar estilo" })).toBeEnabled(); // terminó: el aviso ya está en pantalla y no mueve el resto

  // Fecha especial: dentro de la ventana la carta lleva el tema (saludo y patrón); vencida o apagada, vuelve a la normal.
  const today = new Date();
  const day = (offset: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(today.getTime() + offset * 86_400_000));
  await expect(publicPage.locator(".carta")).not.toHaveAttribute("data-tema", /.+/);
  await page.getByRole("radio", { name: "Navidad" }).check();
  await expect(page.getByTestId("apariencia-preview-tema")).toHaveAttribute("data-tema", "navidad");
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
  await page.getByRole("button", { name: "Guardar colores" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Colores guardados." })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Vino", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: "Carbón", exact: true }).check();
  await page.getByRole("button", { name: "Guardar colores" }).click();
  await expect.poll(async () => (await identity(t)).menu_palette).toBe("carbon");
  await expect(page.getByRole("button", { name: "Guardar colores" })).toBeEnabled();
  await expect(page.getByRole("radio", { name: "Carbón", exact: true })).toBeChecked();

  await page.getByRole("radio", { name: "Clásica" }).check();
  await page.getByRole("button", { name: "Guardar estilo" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Estilo guardado." })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Clásica" })).toBeChecked();

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
    await expect(page.getByRole("button", { name: "Guardar colores" })).toBeDisabled();
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
  await page.locator('input[name="logo"]').setInputFiles({ name: "falso.png", mimeType: "image/png", buffer: Buffer.from("<svg></svg>") });
  await page.getByRole("button", { name: "Guardar logo", exact: true }).click();
  await expect(alerta(page)).toContainText("Usá un logo PNG, JPEG o WebP");
  expect((await identity(t)).logo_path).toBeNull();
});
