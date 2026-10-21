import { expect, test, type Page } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";

/**
 * Carta central con precio, disponibilidad y visibilidad por sucursal (ficha carta-por-sucursal, ADR 0035), de punta a punta:
 * el panel escribe los ajustes de UNA sucursal y la carta pública (QR de mesa y enlace de la sucursal) los muestra al instante
 * sin tocar a la otra.
 */

const tenants: Tenant[] = [];
test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

async function setup(label: string) {
  const t = await createTenant(label);
  tenants.push(t);
  const db = service();
  const plan = await db.from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
  if (plan.error) throw plan.error;
  const norte = await db.from("branches").insert({ organization_id: t.orgId, slug: "norte", name: "Norte" }).select("id").single();
  if (norte.error) throw norte.error;
  const centro = await db.from("branches").select("id").eq("organization_id", t.orgId).eq("slug", "centro").single();
  if (centro.error) throw centro.error;
  const categories = await db
    .from("categories")
    .insert([
      { organization_id: t.orgId, name: "Platos", sort_order: 1 },
      { organization_id: t.orgId, name: "Postres", sort_order: 2 },
    ])
    .select("id, name");
  if (categories.error) throw categories.error;
  const cat = (name: string) => categories.data.find((c) => c.name === name)!.id;
  const products = await db
    .from("products")
    .insert([
      { organization_id: t.orgId, category_id: cat("Platos"), name: "Milanesa", price_cents: 950000 },
      { organization_id: t.orgId, category_id: cat("Postres"), name: "Flan", price_cents: 400000 },
    ])
    .select("id, name");
  if (products.error) throw products.error;
  const product = (name: string) => products.data.find((p) => p.name === name)!.id;
  const table = await db.from("tables").insert({ organization_id: t.orgId, branch_id: norte.data.id, label: "Mesa 1" }).select("qr_token").single();
  if (table.error) throw table.error;
  return {
    t,
    centro: centro.data.id,
    norte: norte.data.id,
    milanesa: product("Milanesa"),
    flan: product("Flan"),
    qrNorte: table.data.qr_token,
    menuCentro: `/m/${t.slug}/centro`,
    menuNorte: `/m/${t.slug}/norte`,
  };
}

const fila = (page: Page, branch: string) => page.locator(`[data-branch="${branch}"]`);

test("precio propio, oculto y agotado de una sucursal se ven en su carta y no en la otra; volver al precio general", async ({ page }, testInfo) => {
  const e = await setup("cps");
  const platoPanel = `/panel/${e.t.slug}/carta/platos/${e.milanesa}`;

  // Ceba el catálogo compartido (caché de 60 s) antes de cambiar nada.
  for (const url of [e.menuCentro, e.menuNorte]) {
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Milanesa", exact: true })).toBeVisible();
    await expect(page.getByText(/9\.500/)).toBeVisible();
  }

  await login(page, e.t.owner.email, e.t.owner.password);
  await page.goto(platoPanel);
  await page.getByRole("tab", { name: "Sucursales", exact: true }).click();
  await expectNoHorizontalOverflow(page);

  // Precio propio de Norte. El de Centro no cambia.
  const norte = fila(page, e.norte);
  await norte.getByLabel("Precio propio en pesos").fill("12000");
  await norte.getByRole("button", { name: "Guardar precio" }).click();
  await expect(norte.getByRole("status")).toContainText("Precio de la sucursal guardado");
  await expect(norte.getByTestId("estado-sucursal")).toContainText("Precio propio");
  await expect(fila(page, e.centro).getByTestId("estado-sucursal")).toContainText("Precio general");

  await page.goto(e.menuNorte);
  await expect(page.getByText(/12\.000/)).toBeVisible();
  await expect(page.getByText(/9\.500/)).toHaveCount(0);
  await page.goto(`/t/${e.qrNorte}`); // el QR de mesa de Norte ve lo mismo
  await expect(page.getByText(/12\.000/)).toBeVisible();
  await page.goto(e.menuCentro);
  await expect(page.getByText(/9\.500/)).toBeVisible();
  await expect(page.getByText(/12\.000/)).toHaveCount(0);

  // Cambiar el precio base no toca a Norte (tiene propio) y sí a Centro (hereda).
  await service().from("products").update({ price_cents: 1000000 }).eq("id", e.milanesa);
  await page.goto(e.menuNorte);
  await expect(page.getByText(/12\.000/)).toBeVisible();

  // Ocultar el plato en Norte: ni listado, ni búsqueda, ni detalle.
  await page.goto(platoPanel);
  await page.getByRole("tab", { name: "Sucursales", exact: true }).click();
  await fila(page, e.norte).getByRole("button", { name: "Ocultar en esta sucursal" }).click();
  await expect(fila(page, e.norte).getByTestId("estado-sucursal")).toContainText("Oculto");
  await page.goto(e.menuNorte);
  await expect(page.getByRole("heading", { name: "Milanesa", exact: true })).toHaveCount(0);
  await page.getByRole("searchbox").fill("milanesa");
  await expect(page.getByRole("heading", { name: "Milanesa", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ver detalle de Milanesa" })).toHaveCount(0);
  await page.goto(e.menuCentro);
  await expect(page.getByRole("heading", { name: "Milanesa", exact: true })).toBeVisible();

  // Una sucursal sin platos visibles en una categoría no la muestra: Flan oculto en Norte vacía «Postres».
  await page.goto(`/panel/${e.t.slug}/carta/platos/${e.flan}`);
  await page.getByRole("tab", { name: "Sucursales", exact: true }).click();
  await fila(page, e.norte).getByRole("button", { name: "Ocultar en esta sucursal" }).click();
  await expect(fila(page, e.norte).getByTestId("estado-sucursal")).toContainText("Oculto");
  await page.goto(e.menuNorte);
  await expect(page.getByRole("heading", { name: "Postres", exact: true })).toHaveCount(0);
  await page.goto(e.menuCentro);
  await expect(page.getByRole("heading", { name: "Postres", exact: true })).toBeVisible();

  // El listado del panel avisa qué tiene cada plato.
  await page.goto(`/panel/${e.t.slug}/carta`);
  await expect(page.getByText("Oculto en Norte").first()).toBeVisible();
  await expect(page.getByText("Precio propio en Norte")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("carta-listado-ajustes.png"), fullPage: true });

  // Mostrar de nuevo + «Usar precio general».
  await page.goto(platoPanel);
  await page.getByRole("tab", { name: "Sucursales", exact: true }).click();
  await fila(page, e.norte).getByRole("button", { name: "Mostrar en esta sucursal" }).click();
  await expect(fila(page, e.norte).getByTestId("estado-sucursal")).toContainText("Se muestra");
  await fila(page, e.norte).getByRole("button", { name: "Usar precio general" }).click();
  await expect(fila(page, e.norte).getByTestId("estado-sucursal")).toContainText("Precio general");
  await page.screenshot({ path: testInfo.outputPath("plato-sucursales-mobile.png"), fullPage: true });
  await page.goto(e.menuNorte);
  await expect(page.getByText(/10\.000/)).toBeVisible(); // ya hereda el base vigente

  // El historial distingue el precio general del de la sucursal.
  await page.goto(`/panel/${e.t.slug}/carta/platos/${e.milanesa}/historial`);
  await expect(page.getByTestId("historial-alcance").filter({ hasText: "Sucursal Norte" }).first()).toBeVisible();
  await expect(page.getByTestId("historial-alcance").filter({ hasText: "Precio general" }).first()).toBeVisible();
});

test("precio propio de cero se muestra como $ 0; un precio inválido no se guarda", async ({ page }) => {
  const e = await setup("cero");
  await login(page, e.t.staff.email, e.t.staff.password);
  await page.goto(`/panel/${e.t.slug}/carta/platos/${e.milanesa}`);
  await page.getByRole("tab", { name: "Sucursales", exact: true }).click();
  const norte = fila(page, e.norte);

  await norte.getByLabel("Precio propio en pesos").fill("abc");
  await norte.getByRole("button", { name: "Guardar precio" }).click();
  await expect(norte.getByRole("alert")).toBeVisible();
  expect((await service().from("product_availability").select("price_cents").eq("product_id", e.milanesa)).data).toEqual([]);

  await norte.getByLabel("Precio propio en pesos").fill("0");
  await norte.getByRole("button", { name: "Guardar precio" }).click();
  await expect(norte.getByTestId("estado-sucursal")).toContainText("Precio propio ($");
  expect((await service().from("product_availability").select("price_cents").eq("product_id", e.milanesa).eq("branch_id", e.norte)).data).toEqual([{ price_cents: 0 }]);
  await page.goto(e.menuNorte);
  await expect(page.getByRole("heading", { name: "Milanesa", exact: true })).toBeVisible();
  await expect(page.getByText(/9\.500/)).toHaveCount(0);
});

test("el alta de un plato elige en qué sucursales se muestra; con una sola sucursal no pregunta", async ({ page }) => {
  const e = await setup("alta");
  await login(page, e.t.owner.email, e.t.owner.password);
  await page.goto(`/panel/${e.t.slug}/carta/platos/nuevo`);
  await expect(page.getByTestId("alta-sucursales")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByLabel("Nombre").fill("Sopa del día");
  await page.getByLabel("Precio").fill("2500");
  await page.getByTestId("alta-sucursales").getByLabel("Norte").uncheck();
  await page.getByRole("button", { name: "Crear plato" }).click();
  await page.waitForURL(/\/carta\/platos\/[0-9a-f-]{36}\?nuevo=1/);

  await page.goto(e.menuCentro);
  await expect(page.getByRole("heading", { name: "Sopa del día", exact: true })).toBeVisible();
  await page.goto(e.menuNorte);
  await expect(page.getByRole("heading", { name: "Sopa del día", exact: true })).toHaveCount(0);

  // Con una sola sucursal activa, ni el alta pregunta ni la pantalla del plato muestra ocultar/precio propio.
  await service().from("branches").update({ is_active: false }).eq("id", e.norte);
  await page.goto(`/panel/${e.t.slug}/carta/platos/nuevo`);
  await expect(page.getByTestId("alta-sucursales")).toHaveCount(0);
  await page.goto(`/panel/${e.t.slug}/carta/platos/${e.milanesa}`);
  await page.getByRole("tab", { name: "Sucursales", exact: true }).click();
  await expect(page.getByRole("button", { name: "Marcar agotado" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ocultar en esta sucursal" })).toHaveCount(0);
  await expect(page.getByLabel("Precio propio en pesos")).toHaveCount(0);
});

test("al quedar una sola sucursal activa, los ajustes que ya tenía un plato siguen a la vista y se pueden deshacer", async ({ page }) => {
  const e = await setup("unica");
  const db = service();
  await db.from("product_availability").insert({ organization_id: e.t.orgId, branch_id: e.centro, product_id: e.milanesa, is_visible: false, price_cents: 1200000 });
  await db.from("branches").update({ is_active: false }).eq("id", e.norte);
  await login(page, e.t.owner.email, e.t.owner.password);

  await page.goto(`/panel/${e.t.slug}/carta`);
  await expect(page.getByText("Oculto en Centro")).toBeVisible();
  await page.goto(`/panel/${e.t.slug}/carta/platos/${e.milanesa}`);
  await page.getByRole("tab", { name: "Sucursales", exact: true }).click();
  const centro = fila(page, e.centro);
  await expect(centro.getByTestId("estado-sucursal")).toContainText("Oculto");
  await centro.getByRole("button", { name: "Mostrar en esta sucursal" }).click();
  await expect(centro.getByTestId("estado-sucursal")).toContainText("Se muestra");
  await centro.getByRole("button", { name: "Usar precio general" }).click();
  await expect(page.getByLabel("Precio propio en pesos")).toHaveCount(0); // sin ajustes, vuelve la pantalla de una sola sucursal
  await page.goto(e.menuCentro);
  await expect(page.getByText(/9\.500/)).toBeVisible();
  // Sin ajustes, la pantalla vuelve a ser la de siempre.
  await page.goto(`/panel/${e.t.slug}/carta/platos/${e.milanesa}`);
  await page.getByRole("tab", { name: "Sucursales", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ocultar en esta sucursal" })).toHaveCount(0);
});

test("una cuenta en solo lectura ve los ajustes pero no puede cambiarlos", async ({ page }) => {
  const e = await setup("lectura");
  await service().from("subscriptions").update({ current_period_end: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(), trial_ends_at: null }).eq("organization_id", e.t.orgId);
  await login(page, e.t.owner.email, e.t.owner.password);
  await page.goto(`/panel/${e.t.slug}/carta/platos/${e.milanesa}`);
  await page.getByRole("tab", { name: "Sucursales", exact: true }).click();
  await expect(fila(page, e.norte).getByRole("button", { name: "Ocultar en esta sucursal" })).toBeDisabled();
  await expect(fila(page, e.norte).getByRole("button", { name: "Guardar precio" })).toBeDisabled();
});
