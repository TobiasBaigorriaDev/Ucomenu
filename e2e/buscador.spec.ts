import { expect, test } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";

const tenants: Tenant[] = [];
test.afterAll(async () => { for (const tenant of tenants) await tenant.cleanup(); });

test("Staff declara etiquetas; búsqueda combinada y detalle conservan el contexto de carta y QR", async ({ page }, testInfo) => {
  const t = await createTenant("buscador");
  tenants.push(t);
  const db = service();
  const category = await db.from("categories").insert({ organization_id: t.orgId, name: "Bebidas" }).select("id").single();
  if (category.error) throw category.error;
  const products = await db.from("products").insert([
    { organization_id: t.orgId, category_id: category.data.id, name: "Café frío", description: "Con almendras", price_cents: 350000 },
    { organization_id: t.orgId, category_id: category.data.id, name: "Té", price_cents: 200000 },
  ]).select("id, name");
  if (products.error) throw products.error;
  const product = products.data.find((p) => p.name === "Café frío")!;
  const menu = `/m/${t.slug}/centro`;
  await page.goto(menu); // Ceba la caché sin etiquetas: el guardado debe invalidarla.
  await login(page, t.staff.email, t.staff.password);
  await page.goto(`/panel/${t.slug}/carta/platos/${product.id}`);
  await page.getByLabel("Vegano", { exact: true }).check();
  await page.getByLabel("Sin TACC", { exact: true }).check();
  await page.getByLabel("Precio en pesos").fill("no es un precio");
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Vegano", { exact: true })).toBeChecked();
  await page.getByLabel("Precio en pesos").fill("3500");
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page.locator("form").getByRole("status")).toContainText("Cambios guardados");
  await page.reload();
  await expect(page.getByLabel("Vegano", { exact: true })).toBeChecked();

  const branch = await db.from("branches").select("id").eq("organization_id", t.orgId).single();
  if (branch.error) throw branch.error;
  const table = await db.from("tables").insert({ organization_id: t.orgId, branch_id: branch.data.id, label: "Mesa buscador" }).select("qr_token").single();
  if (table.error) throw table.error;
  for (const route of [menu, `/t/${table.data.qr_token}`]) {
    await page.goto(route);
    await page.getByRole("searchbox", { name: "Buscar platos" }).fill("CAFE almendras");
    await page.getByRole("button", { name: "Vegano", exact: true }).click();
    await page.getByRole("button", { name: "Sin TACC", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("1 plato encontrado");
    const trigger = page.getByRole("button", { name: "Ver detalle de Café frío" });
    await trigger.click();
    const detail = page.getByRole("dialog", { name: "Café frío" });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("Con almendras");
    await expect(detail).toContainText("Sin TACC");
    await page.keyboard.press("Escape");
    await expect(detail).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(page.getByRole("searchbox")).toHaveValue("CAFE almendras");
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Vegetariano", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No encontramos platos con esa búsqueda." })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Categorías de la carta" })).toHaveCount(0);
    await page.getByRole("button", { name: "Limpiar búsqueda y filtros" }).click();
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(2);
    if (route.startsWith("/t/")) await expect(page.getByText("Mesa buscador", { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath("buscador-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("buscador-desktop.png"), fullPage: true });
});
