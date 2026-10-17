import { expect, test } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, SEED_PASSWORD, service, type Tenant } from "./support";

const tenants: Tenant[] = [];
test.afterAll(async () => { for (const t of tenants) await t.cleanup(); });
async function scenario(label: string) {
  const t = await createTenant(`slug-${label}`);
  tenants.push(t);
  const db = service();
  const plan = await db.from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
  if (plan.error) throw plan.error;
  const other = await db.from("branches").insert({ organization_id: t.orgId, slug: "norte", name: "Norte" }).select("id").single();
  const branch = await db.from("branches").select("id").eq("organization_id", t.orgId).eq("slug", "centro").single();
  if (other.error || branch.error) throw other.error ?? branch.error;
  const cat = await db.from("categories").insert({ organization_id: t.orgId, name: "Bebidas" }).select("id").single();
  if (cat.error) throw cat.error;
  const product = await db.from("products").insert({ organization_id: t.orgId, category_id: cat.data.id, name: "Limonada", price_cents: 250000 });
  if (product.error) throw product.error;
  const table = await db.from("tables").insert({ organization_id: t.orgId, branch_id: branch.data.id, label: "Mesa de siempre" }).select("qr_token").single();
  if (table.error) throw table.error;
  return { t, branch: branch.data.id, other: other.data.id, token: table.data.qr_token, admin: `/admin/organizaciones/${t.slug}` };
}

test("SuperAdmin corrige, conserva todas las direcciones y QR; una pantalla vieja no pisa el cambio", async ({ page }, testInfo) => {
  const s = await scenario("flow");
  const menu = (slug: string) => `/m/${s.t.slug}/${slug}`;
  await page.goto(menu("centro")); // Ruta y catálogo ya consultados antes del cambio.
  await expect(page.getByRole("heading", { level: 3, name: "Limonada", exact: true })).toBeVisible();
  await login(page, "admin@ucomenu.test", SEED_PASSWORD, s.admin);
  const stale = await page.context().newPage();
  await stale.goto(s.admin);
  const row = page.locator(`[data-branch="${s.branch}"]`);
  async function correct(next: string) {
    await row.getByLabel("Nuevo identificador de la sucursal").fill(next);
    await row.getByRole("button", { name: "Corregir identificador" }).click();
    await expect(row.getByRole("status")).toContainText("Identificador corregido");
    await expect(row.getByRole("link")).toHaveAttribute("href", menu(next));
  }
  await correct("central");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("slug-mobile.png"), fullPage: true });

  const staleRow = stale.locator(`[data-branch="${s.branch}"]`);
  await expect(staleRow.locator('input[name="expectedSlug"]')).toHaveValue("centro");
  await staleRow.getByLabel("Nuevo identificador de la sucursal").fill("pantalla-vieja");
  await staleRow.getByRole("button", { name: "Corregir identificador" }).click();
  await expect(staleRow.getByRole("alert")).toContainText("recargá");
  await stale.close();
  await correct("matriz");
  for (const old of ["centro", "central"]) {
    const redirected = await page.request.get(menu(old), { maxRedirects: 0 });
    expect(redirected.status()).toBe(308);
    expect(redirected.headers().location).toBe(menu("matriz"));
  }
  await page.goto(menu("centro"));
  await expect(page).toHaveURL(new RegExp(`${menu("matriz")}$`));
  await expect(page.getByRole("heading", { level: 3, name: "Limonada", exact: true })).toBeVisible();
  await page.goto(`/t/${s.token}`);
  await expect(page.getByText("Mesa de siempre", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Limonada", exact: true })).toBeVisible();
  await page.goto(s.admin);
  await correct("centro"); // Un identificador propio se puede recuperar, sin ciclos.
  const redirected = await page.request.get(menu("matriz"), { maxRedirects: 0 });
  expect(redirected.headers().location).toBe(menu("centro"));
  expect((await page.request.get(menu("centro"), { maxRedirects: 0 })).status()).toBe(200);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("slug-desktop.png"), fullPage: true });
});

test("errores claros, bloqueo para otros roles y publicación de cuentas suspendidas/inactivas", async ({ page }) => {
  const s = await scenario("errors");
  await login(page, "admin@ucomenu.test", SEED_PASSWORD, s.admin);
  const row = page.locator(`[data-branch="${s.branch}"]`);
  for (const [slug, message] of [["con espacio", "minúsculas"], ["norte", "ya pertenece"], ["centro", "no hay cambios"]]) {
    await row.getByLabel("Nuevo identificador de la sucursal").fill(slug);
    await row.getByRole("button", { name: "Corregir identificador" }).click();
    await expect(row.getByRole("alert")).toContainText(message);
    await expect(row.getByLabel("Nuevo identificador de la sucursal")).toHaveValue(slug);
  }
  await row.getByLabel("Nuevo identificador de la sucursal").fill("central");
  await row.getByRole("button", { name: "Corregir identificador" }).click();
  await expect(row.getByRole("status")).toBeVisible();
  const other = page.locator(`[data-branch="${s.other}"]`);
  await other.getByLabel("Nuevo identificador de la sucursal").fill("centro");
  await other.getByRole("button", { name: "Corregir identificador" }).click();
  await expect(other.getByRole("alert")).toContainText("dirección anterior");
  for (const person of [s.t.owner, s.t.staff]) {
    await page.context().clearCookies();
    await login(page, person.email, person.password, "/panel");
    expect((await page.goto(s.admin))?.status()).toBe(404);
    await expect(page.getByRole("button", { name: "Corregir identificador" })).toHaveCount(0);
  }
  const paused = await service().from("subscriptions").update({ current_period_end: new Date(Date.now() - 20 * 86400000).toISOString(), trial_ends_at: null }).eq("organization_id", s.t.orgId);
  if (paused.error) throw paused.error;
  await page.goto(`/m/${s.t.slug}/centro`);
  await expect(page.getByText("Carta temporalmente no disponible")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Limonada" })).toHaveCount(0);
  expect((await page.goto(`/m/${s.t.slug}/inventada`))?.status()).toBe(404);
  await service().from("organizations").update({ is_active: false }).eq("id", s.t.orgId);
  expect((await page.goto(`/m/${s.t.slug}/centro`))?.status()).toBe(404);
});
