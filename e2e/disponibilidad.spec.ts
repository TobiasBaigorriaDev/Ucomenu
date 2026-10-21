import { expect, test } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Estado, type Tenant } from "./support";

const tenants: Tenant[] = [];
test.afterAll(async () => { for (const t of tenants) await t.cleanup(); });
async function setup(label: string, state: Estado = "active") {
  const t = await createTenant(label, state);
  tenants.push(t);
  const db = service();
  const c = await db.from("categories").insert({ organization_id: t.orgId, name: "Platos" }).select("id").single();
  if (c.error) throw c.error;
  const p = await db.from("products").insert({ organization_id: t.orgId, category_id: c.data.id, name: "Milanesa", description: "Con papas", price_cents: 950000, dietary_tags: ["gluten_free"] }).select("id").single();
  if (p.error) throw p.error;
  return { t, product: p.data.id, path: `/panel/${t.slug}/carta/platos/${p.data.id}` };
}

test("Dueño y Staff cambian disponibilidad sin afectar otra sucursal; carta, QR, búsqueda y detalle concuerdan", async ({ page }, testInfo) => {
  const { t, path, product } = await setup("agotado");
  const db = service();
  const plan = await db.from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
  if (plan.error) throw plan.error;
  const branch = await db.from("branches").insert({ organization_id: t.orgId, slug: "norte", name: "Norte" }).select("id").single();
  if (branch.error) throw branch.error;
  const center = await db.from("branches").select("id").eq("organization_id", t.orgId).eq("slug", "centro").single();
  if (center.error) throw center.error;
  const table = await db.from("tables").insert({ organization_id: t.orgId, branch_id: center.data.id, label: "Mesa agotado" }).select("qr_token").single();
  if (table.error) throw table.error;
  const menu = `/m/${t.slug}/centro`, other = `/m/${t.slug}/norte`;
  // Ceba el catálogo compartido antes del cambio.
  for (const url of [menu, other]) { await page.goto(url); await expect(page.getByText("Agotado", { exact: true })).toHaveCount(0); }
  await login(page, t.owner.email, t.owner.password);
  await page.goto(path);
  await page.getByRole("tab", { name: "Sucursales", exact: true }).click();
  const centerRow = page.locator(`[data-branch="${center.data.id}"]`);
  const northRow = page.locator(`[data-branch="${branch.data.id}"]`);
  await centerRow.getByRole("button", { name: "Marcar agotado" }).click();
  await expect(centerRow.getByText("Agotado", { exact: true })).toBeVisible();
  await expect(centerRow.getByRole("status")).toContainText("agotado");
  await expect(northRow.getByText("Disponible", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("disponibilidad-panel-mobile.png"), fullPage: true });
  for (const url of [menu, `/t/${table.data.qr_token}`]) {
    await page.goto(url);
    await page.getByRole("searchbox").fill("milanesa");
    await page.getByRole("button", { name: "Sin TACC", exact: true }).click();
    await expect(page.getByText("Agotado", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Ver detalle de Milanesa" }).click();
    await expect(page.getByRole("dialog")).toContainText("Agotado en esta sucursal");
    await expectNoHorizontalOverflow(page);
    if (url === menu) await page.screenshot({ path: testInfo.outputPath("agotado-detalle-mobile.png") });
    await page.getByRole("button", { name: "Volver a la carta" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.goto(other);
  await expect(page.getByRole("heading", { name: "Milanesa", exact: true })).toBeVisible();
  await expect(page.getByText("Agotado", { exact: true })).toHaveCount(0);
  await page.context().clearCookies(); // Cambia de persona; /login con una sesión vigente redirige al panel.
  await login(page, t.staff.email, t.staff.password);
  await page.goto(path);
  await page.getByRole("tab", { name: "Sucursales", exact: true }).click();
  await centerRow.getByRole("button", { name: "Marcar disponible" }).click();
  await expect(centerRow.getByText("Disponible", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Sucursales", exact: true }).click();
  await expect(centerRow.getByText("Disponible", { exact: true })).toBeVisible();
  await northRow.getByRole("button", { name: "Marcar agotado" }).click();
  await expect(northRow.getByText("Agotado", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("disponibilidad-panel-desktop.png"), fullPage: true });
  await page.goto(menu);
  await expect(page.getByText("Agotado", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Ver detalle de Milanesa" }).click();
  await page.screenshot({ path: testInfo.outputPath("disponible-detalle-desktop.png") });
  // Cambia directo por la API, sin invalidar ninguna etiqueta de Next: la disponibilidad debe leerse en vivo.
  await page.goto(other);
  await expect(page.getByText("Agotado", { exact: true })).toBeVisible();
  const restored = await db.from("product_availability").update({ is_available: true }).eq("branch_id", branch.data.id).eq("product_id", product);
  if (restored.error) throw restored.error;
  await page.reload();
  await expect(page.getByText("Agotado", { exact: true })).toHaveCount(0);
});

for (const state of ["read_only", "suspended"] as const) {
  test(`cuenta ${state}: Staff consulta disponibilidad con controles deshabilitados`, async ({ page }) => {
    const { t, path } = await setup(`agotado-${state.replace("_", "-")}`, state);
    await login(page, t.staff.email, t.staff.password);
    await page.goto(path);
    await page.getByRole("tab", { name: "Sucursales", exact: true }).click();
    await expect(page.getByRole("button", { name: "Marcar agotado" })).toBeDisabled();
    await expect(page.getByTestId("carta-bloqueada")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
