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
  await login(page, t.owner.email, t.owner.password);
  await page.goto(`/panel/${t.slug}/apariencia`);
}
const identity = async (t: Tenant) => (await service().from("organizations").select("menu_palette, logo_path").eq("id", t.orgId).single()).data!;

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
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(241, 244, 240)");
  await page.reload();
  await expect(page.getByRole("radio", { name: "Vino", exact: true })).toBeChecked();
  expect((await identity(other)).menu_palette).toBe("oliva");

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
