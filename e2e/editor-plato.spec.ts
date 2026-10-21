import { expect, test } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, FOTO_PNG, login, service, type Tenant } from "./support";

const tenants: Tenant[] = [];
test.afterAll(async () => { for (const tenant of tenants) await tenant.cleanup(); });

for (const width of [390, 1024, 1440]) {
  test(`editor a ${width}px: conserva borradores entre pestañas y permite guardar`, async ({ page }, testInfo) => {
    const tenant = await createTenant(`editor-${width}`);
    tenants.push(tenant);
    const db = service();
    const category = await db.from("categories").insert({ organization_id: tenant.orgId, name: "Platos" }).select("id").single();
    expect(category.error).toBeNull();
    const product = await db.from("products").insert({ organization_id: tenant.orgId, category_id: category.data!.id, name: "Plato de prueba", price_cents: 250000 }).select("id").single();
    expect(product.error).toBeNull();
    await page.setViewportSize({ width, height: 900 });
    await login(page, tenant.owner.email, tenant.owner.password);
    await page.goto(`/panel/${tenant.slug}/carta/platos/${product.data!.id}`);
    const general = page.getByRole("tab", { name: "Datos y foto", exact: true });
    const variants = page.getByRole("tab", { name: "Variantes", exact: true });
    const branches = page.getByRole("tab", { name: "Sucursales", exact: true });
    await expect(general).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    const tabBoxes = await Promise.all([general, variants, branches].map((tab) => tab.boundingBox()));
    expect(Math.max(...tabBoxes.map((box) => box!.y)) - Math.min(...tabBoxes.map((box) => box!.y))).toBeLessThan(2);
    const data = page.getByRole("region", { name: "Datos del plato", exact: true });
    const photo = page.getByRole("region", { name: "Foto", exact: true });
    const dataBox = await data.boundingBox();
    const photoBox = await photo.boundingBox();
    if (width >= 1280) {
      expect(Math.abs(dataBox!.y - photoBox!.y)).toBeLessThan(2);
      expect(photoBox!.x).toBeGreaterThan(dataBox!.x + dataBox!.width);
    } else {
      expect(photoBox!.y).toBeGreaterThan(dataBox!.y + dataBox!.height);
    }

    await page.getByLabel("Nombre", { exact: true }).fill("Nombre sin guardar");
    await page.getByLabel("Elegir una foto").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: FOTO_PNG });
    await expect(page.getByAltText("Vista previa de la foto elegida")).toBeVisible();
    await variants.click();
    await expect(page.getByRole("region", { name: "Variantes y adicionales", exact: true })).toBeVisible();
    await page.getByLabel("Nombre del grupo", { exact: true }).fill("Grupo sin guardar");
    await branches.click();
    await expect(page.getByTestId("disponibilidad-sucursal")).toBeVisible();
    await variants.click();
    await expect(page.getByLabel("Nombre del grupo", { exact: true })).toHaveValue("Grupo sin guardar");
    await general.click();
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Nombre sin guardar");
    await expect(page.getByAltText("Vista previa de la foto elegida")).toBeVisible();
    await expect(page.getByLabel("Elegir una foto")).toHaveValue(/foto\.png$/);
    await page.getByLabel("Elegir una foto").setInputFiles([]);
    await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nombre sin guardar");

    await general.focus();
    await general.press("ArrowRight");
    await expect(variants).toBeFocused();
    await expect(variants).toHaveAttribute("aria-selected", "true");
    await variants.press("End");
    await expect(branches).toBeFocused();
    await branches.press("Home");
    await expect(general).toBeFocused();
    await general.press("ArrowLeft");
    await expect(branches).toBeFocused();
    await branches.press("Tab");
    await expect(page.getByRole("tabpanel")).toBeFocused();
    await general.click();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`editor-${width}.png`), fullPage: true });
  });
}
