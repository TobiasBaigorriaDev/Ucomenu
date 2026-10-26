import { expect, test, type Page } from "@playwright/test";
import { alerta, createTenant, expectNoHorizontalOverflow, login, service, type Estado, type Tenant } from "./support";

/**
 * Carta en varios idiomas (ficha carta-en-varios-idiomas, ADR 0023): el Dueño traduce desde el panel, la carta pública ofrece
 * el idioma, el comensal elige (o el navegador lo elige por él) y todo cae al español donde falta una traducción. A 390 px.
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

/** Una categoría con un plato (con descripción), un grupo y una opción, con la clave de servicio: no es lo que se prueba. */
async function sembrar(t: Tenant) {
  const db = service();
  const cat = await db.from("categories").insert({ organization_id: t.orgId, name: "Cafetería", sort_order: 0 }).select("id").single();
  if (cat.error) throw new Error(cat.error.message);
  const plato = await db
    .from("products")
    .insert({ organization_id: t.orgId, category_id: cat.data.id, name: "Café con leche", description: "Con leche entera", price_cents: 350000 })
    .select("id")
    .single();
  if (plato.error) throw new Error(plato.error.message);
  const grupo = await db
    .from("option_groups")
    .insert({ organization_id: t.orgId, product_id: plato.data.id, name: "Tamaño", min_choices: 1, max_choices: 1 })
    .select("id")
    .single();
  if (grupo.error) throw new Error(grupo.error.message);
  const opcion = await db
    .from("options")
    .insert({ organization_id: t.orgId, group_id: grupo.data.id, name: "Grande", price_delta_cents: 60000 })
    .select("id")
    .single();
  if (opcion.error) throw new Error(opcion.error.message);
  return { category: cat.data.id, product: plato.data.id, group: grupo.data.id, option: opcion.data.id };
}

type Ids = Awaited<ReturnType<typeof sembrar>>;

/** Traducciones al inglés cargadas directo en la base (para las pruebas que no son del panel). */
async function traducirAlIngles(ids: Ids) {
  const db = service();
  await Promise.all([
    db.from("categories").update({ translations: { en: { name: "Coffee" } } }).eq("id", ids.category),
    db.from("products").update({ translations: { en: { name: "Coffee with milk", description: "Made with whole milk" } } }).eq("id", ids.product),
    db.from("option_groups").update({ translations: { en: { name: "Size" } } }).eq("id", ids.group),
    db.from("options").update({ translations: { en: { name: "Large" } } }).eq("id", ids.option),
  ]);
}

const selector = (page: Page) => page.getByTestId("selector-idioma");
const carta = (page: Page) => page.locator(".carta");

test("el Dueño traduce desde el panel y la carta ofrece el idioma, en inglés y de vuelta al español, a 390 px", async ({ page }) => {
  const t = await nuevoLocal("idi-flujo");
  await sembrar(t);

  // Sin traducciones la carta no ofrece nada: ni selector, ni cambio de idioma por el navegador.
  await page.goto(`/m/${t.slug}/centro`);
  await expect(page.getByRole("heading", { level: 3, name: "Café con leche" })).toBeVisible();
  await expect(selector(page)).toHaveCount(0);

  await login(page, t.owner.email, t.owner.password);
  await page.goto(`/panel/${t.slug}/carta`);
  await page.getByTestId("ver-traducciones").click();
  await expect(page.getByRole("heading", { level: 1, name: "Traducciones de la carta" })).toBeVisible();
  await expect(page.getByTestId("progreso-traduccion")).toContainText("0 de 5");
  await expectNoHorizontalOverflow(page);

  await page.getByLabel("Traducción al English de Cafetería").fill("Coffee");
  await page.getByLabel("Traducción al English de Café con leche").fill("Coffee with milk");
  await page.getByLabel("Traducción al English de Con leche entera").fill("Made with whole milk");
  await page.getByLabel("Traducción al English de Tamaño").fill("Size");
  await page.getByLabel("Traducción al English de Grande").fill("Large");
  await page.getByRole("button", { name: "Guardar traducciones al English" }).click();
  await expect(page.locator("form").getByRole("status")).toHaveText("Se guardaron 4 cambios.");
  await expect(page.getByTestId("progreso-traduccion")).toContainText("5 de 5");

  // Guardar de nuevo sin tocar nada no reescribe nada.
  await page.getByRole("button", { name: "Guardar traducciones al English" }).click();
  await expect(page.locator("form").getByRole("status")).toHaveText("No había cambios para guardar.");

  // La carta pública, al instante (caché invalidada): el selector ofrece Español y English, no Português.
  await page.goto(`/m/${t.slug}/centro?lang=en`);
  await expect(carta(page)).toHaveAttribute("lang", "en");
  await expect(selector(page).getByRole("link", { name: "English" })).toHaveAttribute("aria-current", "true");
  await expect(selector(page).getByRole("link", { name: "Español" })).toBeVisible();
  await expect(selector(page).getByRole("link", { name: "Português" })).toHaveCount(0);
  const plato = page.locator("li").filter({ has: page.getByRole("heading", { level: 3, name: "Coffee with milk" }) });
  await expect(plato).toContainText("$ 3.500");
  await expect(plato).toContainText("Made with whole milk");
  await expect(plato).toContainText("Size");
  await expect(plato).toContainText("Choose 1");
  await expect(plato).toContainText("Large");
  await expect(plato).toContainText("+ $ 600");
  await expect(page.getByRole("navigation", { name: "Menu categories" }).getByRole("link", { name: /Coffee/ })).toBeVisible();
  await expect(page.getByLabel("Search dishes")).toBeVisible();
  await expect(page.getByText("1 dish on the menu")).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Café con leche" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  // El detalle del plato y la búsqueda hablan inglés; la búsqueda usa los nombres en inglés.
  await page.getByRole("button", { name: "View details of Coffee with milk" }).click();
  const detalle = page.getByRole("dialog");
  await expect(detalle).toContainText("Back to the menu");
  await expect(detalle).toContainText("Made with whole milk");
  await detalle.getByRole("button", { name: "Back to the menu" }).click();
  await page.getByLabel("Search dishes").fill("whole milk");
  await expect(page.getByText("1 dish found")).toBeVisible();
  await page.getByLabel("Search dishes").fill("leche entera");
  await expect(page.getByText("We couldn't find dishes matching that search.")).toBeVisible();

  // Volver al español con el selector.
  await selector(page).getByRole("link", { name: "Español" }).click();
  await expect(page).toHaveURL(/lang=es/);
  await expect(page.getByRole("heading", { level: 3, name: "Café con leche" })).toBeVisible();
  await expect(carta(page)).toHaveAttribute("lang", "es");

  // Un idioma que el local no ofrece se ve en español, sin error.
  await page.goto(`/m/${t.slug}/centro?lang=pt`);
  await expect(page.getByRole("heading", { level: 3, name: "Café con leche" })).toBeVisible();

  // Vaciar un campo quita esa traducción: ese texto vuelve a verse en español, el resto sigue en inglés.
  await page.goto(`/panel/${t.slug}/carta/traducciones?idioma=en`);
  await page.getByLabel("Traducción al English de Con leche entera").fill("");
  await page.getByRole("button", { name: "Guardar traducciones al English" }).click();
  await expect(page.locator("form").getByRole("status")).toHaveText("Se guardó 1 cambio.");
  await page.goto(`/m/${t.slug}/centro?lang=en`);
  const mismo = page.locator("li").filter({ has: page.getByRole("heading", { level: 3, name: "Coffee with milk" }) });
  await expect(mismo).toContainText("Con leche entera");
  await expect(mismo).not.toContainText("Made with whole milk");
});

test("el navegador del comensal elige el idioma entre los que ofrece el local", async ({ browser }) => {
  const t = await nuevoLocal("idi-navegador");
  await traducirAlIngles(await sembrar(t));

  const abrir = async (locale: string, ruta = `/m/${t.slug}/centro`) => {
    const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(ruta);
    return { page, context };
  };

  const en = await abrir("en-US");
  await expect(en.page.getByRole("heading", { level: 3, name: "Coffee with milk" })).toBeVisible();
  await expect(en.page).toHaveTitle(/^Local idi-navegador menu/);
  // El pedido explícito manda sobre el navegador.
  await en.page.goto(`/m/${t.slug}/centro?lang=es`);
  await expect(en.page.getByRole("heading", { level: 3, name: "Café con leche" })).toBeVisible();
  // Y no se guarda nada en el dispositivo: sin el parámetro, vuelve a elegir el navegador.
  await en.page.goto(`/m/${t.slug}/centro`);
  await expect(en.page.getByRole("heading", { level: 3, name: "Coffee with milk" })).toBeVisible();
  expect(await en.context.cookies()).toEqual([]);
  expect(await en.page.evaluate(() => window.localStorage.length + window.sessionStorage.length)).toBe(0);
  await en.context.close();

  const es = await abrir("es-AR");
  await expect(es.page.getByRole("heading", { level: 3, name: "Café con leche" })).toBeVisible();
  await es.context.close();

  // Portugués: el local no lo ofrece, queda el español.
  const pt = await abrir("pt-BR");
  await expect(pt.page.getByRole("heading", { level: 3, name: "Café con leche" })).toBeVisible();
  await expect(pt.page).toHaveTitle(/^Carta de Local idi-navegador/);
  await pt.context.close();
});

test("portugués: el selector ofrece los tres idiomas y los textos fijos cambian", async ({ page }) => {
  const t = await nuevoLocal("idi-pt");
  const ids = await sembrar(t);
  await traducirAlIngles(ids);
  await service().from("products").update({ translations: { en: { name: "Coffee with milk" }, pt: { name: "Café com leite" } } }).eq("id", ids.product);

  await page.goto(`/m/${t.slug}/centro`);
  await expect(selector(page).getByRole("link")).toHaveText(["Español", "English", "Português"]);
  await selector(page).getByRole("link", { name: "Português" }).click();
  await expect(page).toHaveURL(/lang=pt/);
  await expect(page.getByRole("heading", { level: 3, name: "Café com leite" })).toBeVisible();
  await expect(page.getByLabel("Buscar pratos")).toBeVisible();
  await expect(page.getByText("1 prato no cardápio")).toBeVisible();
  // Lo que falta traducir queda en español (la categoría y la descripción no tienen versión en portugués).
  await expect(page.getByRole("heading", { level: 2, name: "Cafetería" })).toBeVisible();
  await expect(page.getByText("Feito com UcoMenu")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("desde la mesa: los botones del llamado y su respuesta salen en el idioma elegido", async ({ page }) => {
  const t = await nuevoLocal("idi-mesa");
  await traducirAlIngles(await sembrar(t));
  const db = service();
  await db.from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
  const branch = await db.from("branches").select("id").eq("organization_id", t.orgId).single();
  const mesa = await db
    .from("tables")
    .insert({ organization_id: t.orgId, branch_id: branch.data!.id, label: "Mesa 1" })
    .select("qr_token")
    .single();
  if (mesa.error) throw new Error(mesa.error.message);

  await page.goto(`/t/${mesa.data.qr_token}?lang=en`);
  const barra = page.getByTestId("barra-llamado");
  await expect(barra).toBeVisible();
  await expect(barra.getByRole("button", { name: "Call the waiter" })).toBeVisible();
  await expect(barra.getByRole("button", { name: "Ask for the check" })).toBeVisible();
  await expect(page.getByTestId("mesa")).toHaveText("Mesa 1");

  await barra.getByRole("button", { name: "Call the waiter" }).click();
  await expect(page.getByTestId("mensaje-llamado")).toContainText("We've notified the staff.");

  // Cambiar de idioma con la barra puesta no pierde la mesa ni el llamado.
  await page.getByTestId("selector-idioma").getByRole("link", { name: "Español" }).click();
  await expect(page.getByTestId("barra-llamado").getByRole("button", { name: "Llamar al mozo" })).toBeVisible();
  await page.getByTestId("barra-llamado").getByRole("button", { name: "Pedir la cuenta" }).click();
  await expect(page.getByTestId("mensaje-llamado")).toContainText("Pedimos tu cuenta");
  await expectNoHorizontalOverflow(page);
});

test("una cuenta en solo lectura ve las traducciones pero no las edita", async ({ page }) => {
  const t = await nuevoLocal("idi-solo-lectura", "read_only");
  await sembrar(t);
  await login(page, t.owner.email, t.owner.password);
  await page.goto(`/panel/${t.slug}/carta/traducciones`);
  await expect(page.getByTestId("carta-bloqueada")).toContainText("solo lectura");
  await expect(page.getByLabel("Traducción al English de Cafetería")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Guardar traducciones al English" })).toBeDisabled();
});

test("el Staff también traduce, un texto largo se rechaza sin guardar y otro local no ve este panel", async ({ page }) => {
  const t = await nuevoLocal("idi-staff");
  await sembrar(t);
  const otro = await nuevoLocal("idi-otro");

  await login(page, t.staff.email, t.staff.password);
  await page.goto(`/panel/${t.slug}/carta/traducciones?idioma=pt`);
  await expect(page.getByTestId("progreso-traduccion")).toContainText("0 de 5");
  await page.getByLabel("Traducción al Português de Cafetería").fill("Cafeteria");
  await page.getByRole("button", { name: "Guardar traducciones al Português" }).click();
  await expect(page.locator("form").getByRole("status")).toHaveText("Se guardó 1 cambio.");

  // El campo limita el largo; un envío forzado más largo lo rechaza el servidor y conserva lo escrito.
  const nombre = page.getByLabel("Traducción al Português de Café con leche");
  await nombre.evaluate((el) => el.removeAttribute("maxlength"));
  await nombre.fill("a".repeat(81));
  await page.getByRole("button", { name: "Guardar traducciones al Português" }).click();
  await expect(alerta(page)).toContainText("hasta 80 caracteres");
  await expect(nombre).toHaveValue("a".repeat(81));
  await page.goto(`/m/${t.slug}/centro?lang=pt`);
  await expect(page.getByRole("heading", { level: 3, name: "Café con leche" })).toBeVisible();

  // Una persona de otro local no entra al panel de este.
  await page.context().clearCookies();
  await login(page, otro.owner.email, otro.owner.password);
  const respuesta = await page.goto(`/panel/${t.slug}/carta/traducciones`);
  expect(respuesta?.status()).not.toBe(200);
});

test("el resultado del guardado se ve junto al botón fijo, desde donde se guarda una carta larga, y se anuncia una sola vez", async ({ page }) => {
  const t = await nuevoLocal("idi-resultado");
  await sembrar(t);
  // Una carta larga: el final de la página queda muy lejos del botón fijo.
  const db = service();
  const extra = Array.from({ length: 40 }, (_, i) => ({ organization_id: t.orgId, name: `Categoría larga ${String(i).padStart(2, "0")}`, sort_order: 10 + i }));
  expect((await db.from("categories").insert(extra)).error).toBeNull();
  await login(page, t.owner.email, t.owner.password);
  await page.goto(`/panel/${t.slug}/carta/traducciones?idioma=en`);

  const guardar = page.getByRole("button", { name: "Guardar traducciones al English" });
  const barra = guardar.locator("xpath=ancestor::div[contains(@class,'sticky')]");
  const altoPagina = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(altoPagina).toBeGreaterThan(3 * 844);

  // Éxito: desde arriba de la lista (el final está a varias pantallas) el aviso se ve junto al botón, y es el único.
  await page.getByLabel("Traducción al English de Categoría larga 00").fill("Long category 00");
  await guardar.click();
  const exito = barra.getByRole("status");
  await expect(exito).toHaveText("Se guardó 1 cambio.");
  await expect(exito).toBeInViewport();
  await expect(page.locator("form").getByRole("status")).toHaveCount(1);

  // Error: el servidor rechaza un texto largo; el aviso también se ve ahí, conserva lo escrito y no se repite.
  const largo = page.getByLabel("Traducción al English de Categoría larga 01");
  await largo.evaluate((el) => el.removeAttribute("maxlength"));
  await largo.fill("a".repeat(81));
  await guardar.click();
  const error = barra.getByRole("alert");
  await expect(error).toContainText("hasta 80 caracteres");
  await expect(error).toBeInViewport();
  await expect(alerta(page)).toHaveCount(1);
  await expect(largo).toHaveValue("a".repeat(81));
  await expectNoHorizontalOverflow(page);
});

test("«Sugerir con IA» completa solo los campos vacíos, resalta lo sugerido y no guarda hasta que el local pulsa Guardar", async ({ page }) => {
  const t = await nuevoLocal("idi-sugerir");
  await sembrar(t);
  await login(page, t.owner.email, t.owner.password);
  await page.goto(`/panel/${t.slug}/carta/traducciones`);

  // Lo que el local ya escribió no se pisa.
  const categoria = page.getByLabel("Traducción al English de Cafetería");
  await categoria.fill("Coffee shop");
  await page.getByRole("button", { name: "Sugerir con IA lo que falta en English" }).click();
  await expect(page.getByTestId("sugerencia-resultado")).toContainText("Se completaron 4 campos");
  await expect(categoria).toHaveValue("Coffee shop");
  await expect(categoria).not.toHaveAttribute("data-sugerido", "true");
  const plato = page.getByLabel("Traducción al English de Café con leche");
  await expect(plato).toHaveValue("EN: Café con leche");
  await expect(plato).toHaveAttribute("data-sugerido", "true");
  await expect(page.getByLabel("Traducción al English de Con leche entera")).toHaveValue("EN: Con leche entera");
  await expectNoHorizontalOverflow(page);

  // Todavía no se guardó nada: ni en el progreso ni en la carta pública.
  await page.goto(`/panel/${t.slug}/carta/traducciones`);
  await expect(page.getByTestId("progreso-traduccion")).toContainText("0 de 5");
  await expect(page.getByLabel("Traducción al English de Café con leche")).toHaveValue("");

  // Sugerir, corregir una y guardar: queda lo que el local revisó.
  await page.getByRole("button", { name: "Sugerir con IA lo que falta en English" }).click();
  await expect(page.getByTestId("sugerencia-resultado")).toContainText("Se completaron 5 campos");
  await page.getByLabel("Traducción al English de Café con leche").fill("Latte");
  await expect(page.getByLabel("Traducción al English de Café con leche")).not.toHaveAttribute("data-sugerido", "true");
  await page.getByRole("button", { name: "Guardar traducciones al English" }).click();
  // Cuatro filas (la categoría, el plato con nombre y descripción, el grupo y la opción), cinco textos.
  await expect(page.locator("form").getByRole("status")).toHaveText("Se guardaron 4 cambios.");
  await expect(page.locator("[data-sugerido]")).toHaveCount(0);
  await expect(page.getByTestId("progreso-traduccion")).toContainText("5 de 5");

  await page.goto(`/m/${t.slug}/centro?lang=en`);
  await expect(page.getByRole("heading", { level: 3, name: "Latte" })).toBeVisible();
  await expect(page.getByText("EN: Con leche entera")).toBeVisible();

  // Con todo completo, no hay nada que sugerir.
  await page.goto(`/panel/${t.slug}/carta/traducciones`);
  await page.getByRole("button", { name: "Sugerir con IA lo que falta en English" }).click();
  await expect(alerta(page)).toContainText("No hay textos vacíos");
});

test("«Sugerir con IA» está deshabilitado en una cuenta en solo lectura", async ({ page }) => {
  const t = await nuevoLocal("idi-sugerir-ro", "read_only");
  await sembrar(t);
  await login(page, t.owner.email, t.owner.password);
  await page.goto(`/panel/${t.slug}/carta/traducciones`);
  await expect(page.getByRole("button", { name: "Sugerir con IA lo que falta en English" })).toBeDisabled();
});
