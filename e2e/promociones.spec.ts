import { expect, test, type Page } from "@playwright/test";
import { alerta, createTenant, expectNoHorizontalOverflow, login, service, type Estado, type Person, type Tenant } from "./support";

/**
 * Promociones (fichas panel-de-promociones, carta-con-precio-promocional e historial-de-promociones): `/panel/{slug}/promociones`
 * para el Dueño y el Staff, y la carta pública con el precio promocional en vivo, contra el build y el Supabase local, a 390 px.
 * Las promociones de estas pruebas rigen todos los días y todo el día: no dependen de la hora a la que corra la prueba.
 */

const tenants: Tenant[] = [];

async function nuevoLocal(label: string, opciones: { plan?: "basic" | "pro"; estado?: Estado } = {}) {
  const t = await createTenant(label, opciones.estado ?? "active");
  tenants.push(t);
  const db = service();
  const plan = opciones.plan ?? "pro";
  if (plan !== "basic") {
    const r = await db.from("subscriptions").update({ plan_code: plan }).eq("organization_id", t.orgId);
    if (r.error) throw new Error(r.error.message);
  }
  const category = await db.from("categories").insert({ organization_id: t.orgId, name: "Bebidas" }).select("id").single();
  if (category.error) throw new Error(category.error.message);
  const platos = await db
    .from("products")
    .insert([
      { organization_id: t.orgId, category_id: category.data.id, name: "Cerveza", price_cents: 100000 },
      { organization_id: t.orgId, category_id: category.data.id, name: "Vino", price_cents: 200000 },
    ])
    .select("id, name")
    .order("name");
  if (platos.error) throw new Error(platos.error.message);
  return { t, category: category.data.id, cerveza: platos.data[0].id, vino: platos.data[1].id };
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

async function ingresar(page: Page, persona: Person, t: Tenant, ruta = "promociones") {
  await login(page, persona.email, persona.password);
  await page.goto(`/panel/${t.slug}/${ruta}`);
}

const promo = (page: Page, nombre: string) => page.locator(`[data-testid="promocion"][data-name="${nombre}"]`);
const norm = (texto: string | null) => (texto ?? "").replace(/ /g, " ");

/** Llena y envía el formulario de alta: todos los días, todo el día, una categoría. */
async function crearPromo(page: Page, nombre: string, valor: string) {
  await page.getByLabel("Nombre de la promoción").fill(nombre);
  await page.getByLabel("Porcentaje", { exact: true }).fill(valor);
  for (const dia of ["sábado", "domingo"]) await page.getByRole("checkbox", { name: dia }).check();
  await page.getByRole("checkbox", { name: "Todo el día" }).check();
  await page.getByRole("checkbox", { name: "Bebidas" }).check();
  await page.getByRole("button", { name: "Crear promoción" }).click();
}

test.describe("el Dueño administra las promociones", () => {
  test("crea una promoción: aparece en la lista y la carta pública muestra el precio anterior tachado, el promocional y hasta cuándo", async ({ page }) => {
    const { t } = await nuevoLocal("promo-alta");
    await ingresar(page, t.owner, t);
    await expect(page.getByRole("heading", { name: "Promociones", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Promociones", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("promociones-vacio")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole("link", { name: "Nueva promoción" }).click();
    await expect(page.getByRole("heading", { name: "Nueva promoción", level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await crearPromo(page, "Happy hour", "25");

    await expect(page.getByTestId("promociones-aviso")).toHaveText("Promoción creada.");
    const fila = promo(page, "Happy hour");
    await expect(fila.getByTestId("promocion-estado")).toHaveText("Activa");
    await expect(fila).toContainText("25 % de descuento");
    await expect(fila).toContainText("Todos los días · Todo el día");
    await expect(fila).toContainText("Alcanza a: todo «Bebidas»");
    await expect(fila).toContainText("Todas las sucursales");
    await expectNoHorizontalOverflow(page);

    // La carta pública, sin sesión.
    const carta = await page.context().newPage();
    await carta.goto(`/m/${t.slug}/centro`);
    const cerveza = carta.locator("li", { hasText: "Cerveza" }).first();
    await expect(cerveza.getByTestId("precio-de-lista")).toHaveText(/\$\s?1\.000/);
    await expect(cerveza.getByTestId("precio-promocional")).toContainText(/\$\s?750/);
    await expect(cerveza.getByTestId("promocion-vigente")).toHaveText("Happy hour · Hasta la medianoche");
    await expect(carta.locator("li", { hasText: "Vino" }).first().getByTestId("precio-promocional")).toContainText(/\$\s?1\.500/);
    await expectNoHorizontalOverflow(carta);
    await carta.close();
  });

  test("pausar y reanudar cambian la carta en el acto; editar guarda; un valor fuera de rango se rechaza conservando lo escrito", async ({ page }) => {
    const { t } = await nuevoLocal("promo-edicion");
    await ingresar(page, t.owner, t, "promociones/nueva");
    await crearPromo(page, "Dos por uno", "50");
    await expect(promo(page, "Dos por uno")).toBeVisible();

    const carta = await page.context().newPage();
    const precioCerveza = async () => {
      await carta.goto(`/m/${t.slug}/centro`);
      return carta.locator("li", { hasText: "Cerveza" }).first();
    };
    await expect((await precioCerveza()).getByTestId("precio-promocional")).toContainText(/\$\s?500/);

    await promo(page, "Dos por uno").getByRole("button", { name: "Pausar Dos por uno" }).click();
    await expect(promo(page, "Dos por uno").getByTestId("promocion-estado")).toHaveText("Pausada");
    await expect((await precioCerveza()).getByTestId("precio-promocional")).toHaveCount(0);

    await promo(page, "Dos por uno").getByRole("button", { name: "Reanudar Dos por uno" }).click();
    await expect(promo(page, "Dos por uno").getByTestId("promocion-estado")).toHaveText("Activa");
    await expect((await precioCerveza()).getByTestId("precio-promocional")).toContainText(/\$\s?500/);

    // Editar: un porcentaje fuera de rango se rechaza y el campo conserva lo escrito.
    await promo(page, "Dos por uno").getByRole("link", { name: "Editar Dos por uno" }).click();
    await expect(page.getByRole("heading", { name: "Editar «Dos por uno»", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Nombre de la promoción")).toHaveValue("Dos por uno");
    await expect(page.getByRole("checkbox", { name: "Todo el día" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Bebidas" })).toBeChecked();
    await page.getByLabel("Porcentaje", { exact: true }).fill("150");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(alerta(page)).toContainText("entre 1 y 100");
    await expect(page.getByLabel("Porcentaje", { exact: true })).toHaveValue("150");
    await expect(page.getByRole("checkbox", { name: "Bebidas" })).toBeChecked(); // lo demás también se conserva

    await page.getByLabel("Porcentaje", { exact: true }).fill("20");
    await page.getByLabel("Nombre de la promoción").fill("Veinte por ciento");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByTestId("promociones-aviso")).toHaveText("Cambios guardados.");
    await expect(promo(page, "Veinte por ciento")).toContainText("20 % de descuento");
    await expect(promo(page, "Dos por uno")).toHaveCount(0);
    await expect((await precioCerveza()).getByTestId("precio-promocional")).toContainText(/\$\s?800/);
    await carta.close();
  });

  test("duplicar crea una copia pausada; dos activas que se pisan avisan; borrar pide confirmación y deja constancia", async ({ page }) => {
    const { t } = await nuevoLocal("promo-copia");
    await ingresar(page, t.owner, t, "promociones/nueva");
    await crearPromo(page, "Original", "10");

    await promo(page, "Original").getByRole("button", { name: "Duplicar Original" }).click();
    const copia = promo(page, "Original (copia)");
    await expect(copia).toBeVisible();
    await expect(copia.getByTestId("promocion-estado")).toHaveText("Pausada");
    await expect(page.getByTestId("promocion-superposicion")).toHaveCount(0); // una pausada no pisa a nadie

    await copia.getByRole("button", { name: "Reanudar Original (copia)" }).click();
    await expect(copia.getByTestId("promocion-estado")).toHaveText("Activa");
    await expect(copia.getByTestId("promocion-superposicion")).toContainText("Se superpone con «Original»");
    await expect(promo(page, "Original").getByTestId("promocion-superposicion")).toContainText("Se superpone con «Original (copia)»");
    await expectNoHorizontalOverflow(page);

    await copia.locator("summary", { hasText: "Borrar" }).click();
    await expect(copia).toContainText("Queda constancia en el historial");
    await copia.getByRole("button", { name: "Sí, borrar Original (copia)" }).click();
    await expect(promo(page, "Original (copia)")).toHaveCount(0);
    await expect(page.getByTestId("promocion-superposicion")).toHaveCount(0);

    // El historial lo cuenta.
    await page.getByRole("link", { name: "Historial de promociones" }).click();
    await expect(page.getByRole("heading", { name: "Historial de promociones", level: 1 })).toBeVisible();
    const eventos = page.getByTestId("historial-promociones-fila");
    await expect(eventos.first()).toContainText("Se borró: Original (copia)");
    await expect(eventos.first()).toContainText("Tenía 1 plato o categoría");
    await expect(page.getByTestId("historial-promociones-lista")).toContainText("Se creó: Original");
    await expect(page.getByTestId("historial-promociones-lista")).toContainText("Categoría: Bebidas");
    await expect(eventos.first()).toContainText("Vos"); // el Dueño se ve a sí mismo
    await expectNoHorizontalOverflow(page);
  });

  test("la vista previa por día y hora muestra qué platos tendrían promoción y a qué precio", async ({ page }) => {
    const { t } = await nuevoLocal("promo-previa");
    await ingresar(page, t.owner, t, "promociones/nueva");
    await crearPromo(page, "Siempre", "40");
    await expect(promo(page, "Siempre")).toBeVisible();

    await page.getByLabel("Día", { exact: true }).fill("2026-12-18");
    await page.getByLabel("Hora", { exact: true }).fill("19:30");
    await page.getByRole("button", { name: "Ver precios" }).click();
    const filas = page.getByTestId("vista-previa-fila");
    await expect(filas).toHaveCount(2);
    await expect(filas.filter({ hasText: "Cerveza" })).toContainText(/\$\s?1\.000.*\$\s?600/);
    await expect(filas.filter({ hasText: "Vino" })).toContainText(/\$\s?2\.000.*\$\s?1\.200/);
    await expect(page.getByLabel("Día", { exact: true })).toHaveValue("2026-12-18");
    await expect(page.getByLabel("Hora", { exact: true })).toHaveValue("19:30");
    await expectNoHorizontalOverflow(page);

    // Con la promoción pausada, a esa hora no hay nada.
    await promo(page, "Siempre").getByRole("button", { name: "Pausar Siempre" }).click();
    await page.getByRole("button", { name: "Ver precios" }).click();
    await expect(page.getByTestId("vista-previa-vacia")).toBeVisible();
  });
});

test.describe("quién ve qué", () => {
  test("el Staff ve las promociones y la vista previa, sin botones para cambiarlas, y la pantalla de alta lo devuelve al panel", async ({ page }) => {
    const { t, category, cerveza } = await nuevoLocal("promo-staff");
    const db = service();
    const creada = await db
      .from("promotions")
      .insert({ organization_id: t.orgId, name: "Del Dueño", discount_type: "percent", discount_value: 10, weekdays_mask: 127, start_minute: 0, end_minute: 1440 })
      .select("id")
      .single();
    if (creada.error) throw new Error(creada.error.message);
    await db.from("promotion_targets").insert({ organization_id: t.orgId, promotion_id: creada.data.id, product_id: cerveza });
    void category;

    await ingresar(page, t.staff, t);
    await expect(promo(page, "Del Dueño")).toBeVisible();
    await expect(page.getByText("Solo el Dueño puede crear o cambiar promociones.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Nueva promoción" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Pausar|Duplicar|Borrar/ })).toHaveCount(0);
    await expect(page.getByTestId("vista-previa-form")).toBeVisible();
    await page.getByRole("link", { name: "Historial de promociones" }).click();
    await expect(page.getByTestId("historial-promociones-fila").first()).toContainText("Se sumó un plato o categoría");
    await expect(page.getByTestId("historial-promociones-fila").first()).toContainText("Operación técnica");

    await page.goto(`/panel/${t.slug}/promociones/nueva`);
    await expect(page.getByRole("heading", { name: "Nueva promoción" })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/panel/${t.slug}/?$`));
  });

  test("sin la función en el plan (Básico) el Dueño ve el aviso, no puede crear y la carta no muestra promociones", async ({ page }) => {
    const { t, cerveza } = await nuevoLocal("promo-basico", { plan: "basic" });
    const db = service();
    const creada = await db
      .from("promotions")
      .insert({ organization_id: t.orgId, name: "Heredada", discount_type: "percent", discount_value: 50, weekdays_mask: 127, start_minute: 0, end_minute: 1440 })
      .select("id")
      .single();
    if (creada.error) throw new Error(creada.error.message);
    await db.from("promotion_targets").insert({ organization_id: t.orgId, promotion_id: creada.data.id, product_id: cerveza });

    await ingresar(page, t.owner, t);
    await expect(page.getByTestId("promociones-bloqueadas")).toContainText("Tu plan no incluye");
    await expect(page.getByRole("link", { name: "Nueva promoción" })).toHaveCount(0);
    await expect(promo(page, "Heredada")).toBeVisible();

    const carta = await page.context().newPage();
    await carta.goto(`/m/${t.slug}/centro`);
    await expect(carta.getByText("Cerveza").first()).toBeVisible();
    await expect(carta.getByTestId("precio-promocional")).toHaveCount(0);
    await carta.close();
  });

  test("con la cuenta en solo lectura las promociones se ven y siguen aplicándose en la carta, pero no se cambian", async ({ page }) => {
    const { t, cerveza } = await nuevoLocal("promo-lectura", { estado: "read_only" });
    const db = service();
    const creada = await db
      .from("promotions")
      .insert({ organization_id: t.orgId, name: "Vigente", discount_type: "percent", discount_value: 50, weekdays_mask: 127, start_minute: 0, end_minute: 1440 })
      .select("id")
      .single();
    if (creada.error) throw new Error(creada.error.message);
    await db.from("promotion_targets").insert({ organization_id: t.orgId, promotion_id: creada.data.id, product_id: cerveza });

    await ingresar(page, t.owner, t);
    await expect(page.getByTestId("promociones-bloqueadas")).toContainText("solo lectura");
    await expect(promo(page, "Vigente")).toBeVisible();
    await expect(page.getByRole("link", { name: "Nueva promoción" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pausar Vigente" })).toBeDisabled();

    const carta = await page.context().newPage();
    await carta.goto(`/m/${t.slug}/centro`);
    await expect(carta.locator("li", { hasText: "Cerveza" }).first().getByTestId("precio-promocional")).toContainText(/\$\s?500/);
    expect(norm(await carta.locator("li", { hasText: "Cerveza" }).first().getByTestId("precio-de-lista").textContent())).toMatch(/\$ 1\.000/);
    await carta.close();
  });
});
