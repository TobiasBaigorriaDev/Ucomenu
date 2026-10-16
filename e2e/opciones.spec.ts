import { expect, test, type Locator, type Page } from "@playwright/test";
import { alerta, createTenant, expectNoHorizontalOverflow, login, service, type Estado, type Tenant } from "./support";

/**
 * Variantes y adicionales (ficha variantes-y-adicionales): del panel a la carta pública, a 390 px. Cada prueba trabaja
 * sobre un local propio y lo borra al terminar.
 */

const tenants: Tenant[] = [];

async function nuevoLocal(label: string, estado: Estado = "active") {
  const t = await createTenant(label, estado);
  tenants.push(t);
  return t;
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

/** Una categoría con un plato (con la clave de servicio: no es lo que se prueba). */
async function sembrar(t: Tenant, plato = "Café con leche", precio = 350000) {
  const db = service();
  const cat = await db.from("categories").insert({ organization_id: t.orgId, name: "Cafetería", sort_order: 0 }).select("id").single();
  if (cat.error) throw new Error(cat.error.message);
  const p = await db
    .from("products")
    .insert({ organization_id: t.orgId, category_id: cat.data.id, name: plato, price_cents: precio })
    .select("id")
    .single();
  if (p.error) throw new Error(p.error.message);
  return p.data.id;
}

const rutaPlato = (t: Tenant, productId: string) => `/panel/${t.slug}/carta/platos/${productId}`;
const grupo = (page: Page, nombre: string) => page.locator(`[data-testid="grupo"][data-name="${nombre}"]`);
const opcion = (g: Locator, nombre: string) => g.locator(`[data-testid="opcion"][data-name="${nombre}"]`);
const formNuevoGrupo = (page: Page) =>
  page.locator('[data-testid="opciones"] form').filter({ has: page.getByRole("button", { name: "Crear grupo" }) });
const estado = (page: Page) => page.locator("form").getByRole("status");

async function crearGrupo(page: Page, nombre: string, min: string, max: string) {
  const form = formNuevoGrupo(page);
  await form.getByLabel("Nombre del grupo").fill(nombre);
  await form.getByLabel("Mínimo a elegir").fill(min);
  await form.getByLabel("Máximo a elegir").fill(max);
  await form.getByRole("button", { name: "Crear grupo" }).click();
  await expect(grupo(page, nombre)).toBeVisible();
}

async function agregarOpcion(page: Page, nombreGrupo: string, nombre: string, diferencia = "") {
  const g = grupo(page, nombreGrupo);
  const form = g.locator("form").filter({ has: page.getByRole("button", { name: "Crear opción" }) });
  // El desplegable queda abierto después de agregar una opción (para cargar varias seguidas): solo se abre si está cerrado.
  if (!(await form.getByLabel("Nombre de la opción").isVisible())) await g.getByText("Agregar opción").click();
  await form.getByLabel("Nombre de la opción").fill(nombre);
  await form.getByLabel(/Diferencia de precio/).fill(diferencia);
  await form.getByRole("button", { name: "Crear opción" }).click();
  await expect(opcion(g, nombre)).toBeVisible();
}

/** La carta pública como la ve un comensal: el bloque de opciones del plato, o null si no tiene. */
async function publica(page: Page, t: Tenant, plato: string) {
  await page.goto(`/m/${t.slug}/centro`);
  return page.locator("li").filter({ has: page.getByRole("heading", { level: 3, name: plato }) });
}

test("el Dueño arma una variante y adicionales con las plantillas y la carta pública los muestra al instante, a 390 px", async ({ page }) => {
  const t = await nuevoLocal("opc-flujo");
  const productId = await sembrar(t);

  // La carta pública se mira ANTES: queda en caché sin opciones. Lo que se vea después prueba la invalidación.
  const antes = await publica(page, t, "Café con leche");
  await expect(antes).toContainText("$ 3.500");
  await expect(antes.getByTestId("opciones-plato")).toHaveCount(0);

  await login(page, t.owner.email, t.owner.password);
  await page.goto(rutaPlato(t, productId));
  await expect(page.getByTestId("sin-grupos")).toBeVisible();

  // Plantilla «Variante»: rellena nombre, mínimo y máximo, y se puede editar antes de guardar.
  const form = formNuevoGrupo(page);
  await page.getByTestId("plantilla-variant").click();
  await expect(form.getByLabel("Nombre del grupo")).toHaveValue("Tamaño");
  await expect(form.getByLabel("Mínimo a elegir")).toHaveValue("1");
  await expect(form.getByLabel("Máximo a elegir")).toHaveValue("1");
  await form.getByRole("button", { name: "Crear grupo" }).click();
  await expect(grupo(page, "Tamaño")).toBeVisible();
  await expect(grupo(page, "Tamaño").getByTestId("regla")).toHaveText("Elegí 1");
  await expect(grupo(page, "Tamaño")).toContainText("Variante");

  await agregarOpcion(page, "Tamaño", "Chico");
  await agregarOpcion(page, "Tamaño", "Grande", "600");
  await expect(opcion(grupo(page, "Tamaño"), "Grande")).toContainText("+ $ 600");
  await expect(opcion(grupo(page, "Tamaño"), "Chico")).toContainText("Sin diferencia");

  // Plantilla «Adicionales».
  await page.getByTestId("plantilla-extras").click();
  await expect(form.getByLabel("Nombre del grupo")).toHaveValue("Adicionales");
  await expect(form.getByLabel("Mínimo a elegir")).toHaveValue("0");
  await form.getByLabel("Máximo a elegir").fill("2");
  await form.getByRole("button", { name: "Crear grupo" }).click();
  await expect(grupo(page, "Adicionales")).toBeVisible();
  await expect(grupo(page, "Adicionales").getByTestId("regla")).toHaveText("Opcional · hasta 2");
  await agregarOpcion(page, "Adicionales", "Leche de almendras", "300");
  await agregarOpcion(page, "Adicionales", "Crema", "1.250,50");

  // Carta pública: el precio principal sigue siendo el base y las opciones muestran su diferencia.
  const plato = await publica(page, t, "Café con leche");
  await expect(plato.getByTestId("grupo-opciones")).toHaveCount(2);
  await expect(plato).toContainText("$ 3.500");
  const tam = plato.getByTestId("grupo-opciones").filter({ hasText: "Tamaño" });
  await expect(tam).toContainText("Elegí 1");
  await expect(tam).toContainText("Chico");
  await expect(tam).toContainText(/\+\s\$\s600/);
  const ext = plato.getByTestId("grupo-opciones").filter({ hasText: "Adicionales" });
  await expect(ext).toContainText("Opcional · hasta 2");
  await expect(ext).toContainText(/\+\s\$\s300/);
  await expect(ext).toContainText(/\+\s\$\s1\.250,50/);
  // Chico no tiene diferencia: no se muestra «+ $ 0».
  await expect(tam).not.toContainText(/\+\s\$\s0/);
  // Contrato de la carta: h2 = categorías, h3 = platos; los grupos no agregan títulos.
  await expect(page.getByRole("heading", { level: 3 })).toHaveCount(1);
  await expectNoHorizontalOverflow(page);

  // Desactivar una opción y un grupo desde el panel los saca de la carta al instante.
  await page.goto(rutaPlato(t, productId));
  await grupo(page, "Tamaño").getByRole("button", { name: "Desactivar Grande" }).click();
  await expect(opcion(grupo(page, "Tamaño"), "Grande")).toContainText("Inactiva");
  await publica(page, t, "Café con leche");
  await expect(page.getByTestId("grupo-opciones").filter({ hasText: "Tamaño" })).not.toContainText("Grande");
  await expect(page.getByTestId("grupo-opciones").filter({ hasText: "Tamaño" })).toContainText("Chico");

  await page.goto(rutaPlato(t, productId));
  await grupo(page, "Adicionales").getByRole("button", { name: "Desactivar Adicionales" }).click();
  await expect(grupo(page, "Adicionales")).toContainText("Inactivo");
  await publica(page, t, "Café con leche");
  await expect(page.getByTestId("grupo-opciones")).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText("Leche de almendras");
});

test("el Staff también gestiona variantes y adicionales; editar y ordenar se ven en el panel y en la carta", async ({ page }) => {
  const t = await nuevoLocal("opc-staff");
  const productId = await sembrar(t, "Tostado");

  await login(page, t.staff.email, t.staff.password);
  await page.goto(rutaPlato(t, productId));
  await crearGrupo(page, "Pan", "1", "1");
  await agregarOpcion(page, "Pan", "Blanco");
  await agregarOpcion(page, "Pan", "Integral", "150");
  await crearGrupo(page, "Extras", "0", "3");

  // Ordenar: bajar «Pan» lo deja después de «Extras».
  await grupo(page, "Pan").getByRole("button", { name: "Bajar Pan" }).click();
  await expect(estado(page).first()).toBeVisible();
  await expect.poll(async () => page.locator('[data-testid="grupo"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-name")))).toEqual(["Extras", "Pan"]);

  // Editar una opción: nombre y diferencia persisten.
  const g = grupo(page, "Pan");
  await opcion(g, "Integral").getByText("Editar", { exact: true }).click();
  const form = opcion(g, "Integral").locator("form").filter({ has: page.getByRole("button", { name: "Guardar opción" }) });
  await form.getByLabel("Nombre de la opción").fill("Integral de semillas");
  await form.getByLabel(/Diferencia de precio/).fill("225,50");
  await form.getByRole("button", { name: "Guardar opción" }).click();
  await expect(opcion(g, "Integral de semillas")).toContainText(/\+\s\$\s225,50/);

  const plato = await publica(page, t, "Tostado");
  await expect(plato.getByTestId("grupo-opciones")).toHaveCount(1); // «Extras» no tiene opciones: no se muestra
  await expect(plato).toContainText("Integral de semillas");
  await expect(plato).toContainText(/\+\s\$\s225,50/);
});

test("los errores se explican con lo escrito conservado, sin guardar nada", async ({ page }) => {
  const t = await nuevoLocal("opc-errores");
  const productId = await sembrar(t);
  await login(page, t.owner.email, t.owner.password);
  await page.goto(rutaPlato(t, productId));

  const form = formNuevoGrupo(page);
  await form.getByLabel("Nombre del grupo").fill("Salsas");
  await form.getByLabel("Mínimo a elegir").fill("3");
  await form.getByLabel("Máximo a elegir").fill("2");
  await form.getByRole("button", { name: "Crear grupo" }).click();
  await expect(alerta(page)).toContainText("El mínimo no puede ser mayor que el máximo");
  await expect(form.getByLabel("Nombre del grupo")).toHaveValue("Salsas");
  await expect(form.getByLabel("Mínimo a elegir")).toHaveValue("3");

  await form.getByLabel("Mínimo a elegir").fill("uno");
  await form.getByRole("button", { name: "Crear grupo" }).click();
  await expect(alerta(page)).toContainText("números enteros");

  await form.getByLabel("Mínimo a elegir").fill("0");
  await form.getByLabel("Máximo a elegir").fill("2");
  await form.getByRole("button", { name: "Crear grupo" }).click();
  await expect(grupo(page, "Salsas")).toBeVisible();

  // Una opción con diferencia inválida.
  const g = grupo(page, "Salsas");
  await g.getByText("Agregar opción").click();
  const opt = g.locator("form").filter({ has: page.getByRole("button", { name: "Crear opción" }) });
  await opt.getByLabel("Nombre de la opción").fill("Picante");
  await opt.getByLabel(/Diferencia de precio/).fill("-5");
  await opt.getByRole("button", { name: "Crear opción" }).click();
  await expect(alerta(page)).toContainText("El precio no es válido");
  await expect(opt.getByLabel("Nombre de la opción")).toHaveValue("Picante");
  await expect(g.getByTestId("opcion")).toHaveCount(0);

  // Corregida la diferencia, la opción se crea.
  await opt.getByLabel(/Diferencia de precio/).fill("");
  await opt.getByRole("button", { name: "Crear opción" }).click();
  await expect(opcion(g, "Picante")).toBeVisible();
});

test("nombres larguísimos no desbordan a 390 px, ni en el panel ni en la carta", async ({ page }) => {
  const t = await nuevoLocal("opc-largos");
  const productId = await sembrar(t);
  const largoGrupo = "G".repeat(80);
  const largoOpcion = "O".repeat(80);

  await login(page, t.owner.email, t.owner.password);
  await page.goto(rutaPlato(t, productId));
  await crearGrupo(page, largoGrupo, "1", "1");
  await expectNoHorizontalOverflow(page);
  await agregarOpcion(page, largoGrupo, largoOpcion, "10.000.000");
  await expectNoHorizontalOverflow(page);

  await publica(page, t, "Café con leche");
  await expect(page.locator("body")).toContainText(largoOpcion);
  await expectNoHorizontalOverflow(page);
});

test("otro local: el plato ajeno es un 404 y nada se escribe en él", async ({ page }) => {
  const a = await nuevoLocal("opc-a");
  const b = await nuevoLocal("opc-b");
  const productB = await sembrar(b, "Plato de B");

  await login(page, a.owner.email, a.owner.password);
  const respuesta = await page.goto(rutaPlato(a, productB));
  expect(respuesta?.status()).toBe(404);
  // Y tampoco por la ruta del otro local (no es miembro).
  const ajena = await page.goto(rutaPlato(b, productB));
  expect(ajena?.status()).toBe(404);

  const { data } = await service().from("option_groups").select("id").eq("organization_id", b.orgId);
  expect(data).toEqual([]);
});

for (const [rotulo, cuenta] of [
  ["solo lectura", "read_only"],
  ["suspendida", "suspended"],
] as const) {
  test(`cuenta ${rotulo}: se ve todo pero los controles están deshabilitados`, async ({ page }) => {
    const t = await nuevoLocal(`opc-${cuenta.replace("_", "-")}`, cuenta);
    const productId = await sembrar(t);
    const db = service();
    const g = await db
      .from("option_groups")
      .insert({ organization_id: t.orgId, product_id: productId, name: "Tamaño", min_choices: 1, max_choices: 1 })
      .select("id")
      .single();
    await db.from("options").insert({ organization_id: t.orgId, group_id: g.data!.id, name: "Grande", price_delta_cents: 60000 });

    for (const persona of [t.owner, t.staff]) {
      await login(page, persona.email, persona.password);
      await page.goto(rutaPlato(t, productId));
      await expect(page.getByTestId("carta-bloqueada")).toBeVisible();
      await expect(grupo(page, "Tamaño")).toBeVisible();
      await expect(grupo(page, "Tamaño").getByRole("button", { name: "Desactivar Tamaño" })).toBeDisabled();
      await expect(grupo(page, "Tamaño").getByRole("button", { name: "Desactivar Grande" })).toBeDisabled();
      await expect(formNuevoGrupo(page).getByRole("button", { name: "Crear grupo" })).toBeDisabled();
      await expectNoHorizontalOverflow(page);
      await page.context().clearCookies();
    }
    const intactas = await db.from("options").select("is_active").eq("group_id", g.data!.id);
    expect(intactas.data).toEqual([{ is_active: true }]);
  });
}

test("la carta de ejemplo (seed) muestra las variantes y adicionales activos y ninguno oculto", async ({ page }) => {
  await page.goto("/m/cafe-ejemplo/centro");
  const espresso = page.locator("li").filter({ has: page.getByRole("heading", { level: 3, name: "Espresso" }) });
  await expect(espresso.getByTestId("grupo-opciones")).toHaveCount(2);
  await expect(espresso).toContainText("Tamaño");
  await expect(espresso).toContainText("Doble");
  await expect(espresso).toContainText(/\+\s\$\s600/);
  await expect(espresso).toContainText("Leche de almendras");
  await expect(page.locator("body")).not.toContainText("Triple");
  await expect(page.locator("body")).not.toContainText("Grupo oculto");
  await expect(page.locator("body")).not.toContainText("plato inactivo");
  await expectNoHorizontalOverflow(page);
});
