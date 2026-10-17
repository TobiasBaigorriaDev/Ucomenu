import { expect, test, type Page } from "@playwright/test";
import { alerta, createTenant, expectNoHorizontalOverflow, login, service, type Estado, type Person, type Tenant } from "./support";

/**
 * Gestión de sucursales (ficha gestion-de-sucursales): `/panel/{slug}/sucursales`, solo para el Dueño, contra el build y
 * el Supabase local, a 390 px. Cada prueba usa un local propio (`createTenant` deja una sucursal «Centro»).
 */

const tenants: Tenant[] = [];

async function nuevoLocal(label: string, opciones: { estado?: Estado; plan?: "basic" | "pro" | "premium" } = {}) {
  const t = await createTenant(label, opciones.estado ?? "active");
  tenants.push(t);
  const plan = opciones.plan ?? "pro";
  if (plan !== "basic") {
    const r = await service().from("subscriptions").update({ plan_code: plan }).eq("organization_id", t.orgId);
    if (r.error) throw new Error(r.error.message);
  }
  return t;
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

async function ingresar(page: Page, persona: Person, t: Tenant) {
  await login(page, persona.email, persona.password);
  await page.goto(`/panel/${t.slug}/sucursales`);
}

const sucursal = (page: Page, nombre: string) => page.locator(`[data-testid="sucursal"][data-name="${nombre}"]`);
const filasDe = async (orgId: string) =>
  (await service().from("branches").select("slug, name").eq("organization_id", orgId).order("slug")).data ?? [];

async function crear(page: Page, nombre: string, slug?: string) {
  await page.getByLabel("Nombre de la sucursal").fill(nombre);
  if (slug !== undefined) await page.getByLabel(/Identificador/).fill(slug);
  await page.getByRole("button", { name: "Crear sucursal" }).click();
}

test.describe("el Dueño administra sus sucursales", () => {
  test("crea una sucursal: el identificador se propone del nombre, aparece en la lista y su carta pública abre", async ({ page }) => {
    const t = await nuevoLocal("suc-alta");
    await ingresar(page, t.owner, t);
    await expect(page.getByRole("heading", { name: "Sucursales", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sucursales" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("sucursales-uso")).toContainText("1 de 2");
    await expectNoHorizontalOverflow(page);

    await page.getByLabel("Nombre de la sucursal").fill("Palermo Soho");
    await expect(page.getByLabel(/Identificador/)).toHaveValue("palermo-soho"); // propuesto
    await page.getByRole("button", { name: "Crear sucursal" }).click();

    await expect(page.locator("form").getByRole("status")).toContainText("Sucursal creada");
    await expect(sucursal(page, "Palermo Soho")).toContainText("/m/" + t.slug + "/palermo-soho");
    await expect(sucursal(page, "Palermo Soho")).toContainText("0 mesas activas");
    await expect(page.getByTestId("sucursales-uso")).toContainText("2 de 2");
    expect(await filasDe(t.orgId)).toEqual([
      { slug: "centro", name: "Centro" },
      { slug: "palermo-soho", name: "Palermo Soho" },
    ]);

    // Con el tope alcanzado ya no se ofrece el alta y se explica.
    await expect(page.getByTestId("aviso-tope")).toContainText("Tu plan incluye 2 sucursales y ya las usás");
    await expect(page.getByRole("button", { name: "Crear sucursal" })).toHaveCount(0);

    // La carta pública de la sucursal nueva existe.
    const carta = await page.goto(`/m/${t.slug}/palermo-soho`);
    expect(carta?.status()).toBe(200);
  });

  test("si la persona edita el identificador, deja de seguir al nombre; lo que escribe se conserva ante un error", async ({ page }) => {
    const t = await nuevoLocal("suc-slug");
    await ingresar(page, t.owner, t);

    await page.getByLabel("Nombre de la sucursal").fill("Norte");
    await page.getByLabel(/Identificador/).fill("zona-norte");
    await page.getByLabel("Nombre de la sucursal").fill("Norte y Sur");
    await expect(page.getByLabel(/Identificador/)).toHaveValue("zona-norte");

    // Identificador con mayúsculas y espacios: la base lo rechaza, no se arregla en silencio.
    await page.getByLabel(/Identificador/).fill("Zona Norte");
    await page.getByRole("button", { name: "Crear sucursal" }).click();
    await expect(alerta(page)).toContainText("letras minúsculas sin acentos");
    await expect(page.getByLabel("Nombre de la sucursal")).toHaveValue("Norte y Sur");
    await expect(page.getByLabel(/Identificador/)).toHaveValue("Zona Norte");

    // Repetido en el local.
    await page.getByLabel(/Identificador/).fill("centro");
    await page.getByRole("button", { name: "Crear sucursal" }).click();
    await expect(alerta(page)).toContainText("Ya hay una sucursal con ese identificador");

    // Nombre en blanco (el navegador exige el campo; se fuerza solo espacios).
    await page.getByLabel("Nombre de la sucursal").fill("   ");
    await page.getByLabel(/Identificador/).fill("otra");
    await page.getByRole("button", { name: "Crear sucursal" }).click();
    await expect(alerta(page)).toContainText("Ingresá un nombre");
    expect(await filasDe(t.orgId)).toEqual([{ slug: "centro", name: "Centro" }]);
  });

  test("renombra una sucursal: el nombre persiste y el identificador no cambia", async ({ page }) => {
    const t = await nuevoLocal("suc-renombrar");
    await ingresar(page, t.owner, t);

    await sucursal(page, "Centro").locator("summary", { hasText: "Renombrar" }).click();
    await sucursal(page, "Centro").getByLabel("Nombre nuevo").fill("Casa central");
    await sucursal(page, "Centro").getByRole("button", { name: "Guardar nombre" }).click();
    await expect(sucursal(page, "Casa central").getByRole("status")).toContainText("Nombre guardado"); // el aviso sigue ahí tras refrescar

    await page.reload();
    await expect(sucursal(page, "Casa central")).toContainText("/m/" + t.slug + "/centro");
    expect(await filasDe(t.orgId)).toEqual([{ slug: "centro", name: "Casa central" }]);
    // Se puede renombrar aun con el tope de sucursales alcanzado (Básico).
  });

  test("con varias sucursales, las demás pantallas siguen coherentes: mesas y llamados se agrupan por sucursal", async ({ page }) => {
    const t = await nuevoLocal("suc-varias");
    await service().from("branches").insert({ organization_id: t.orgId, slug: "norte", name: "Norte" });
    await login(page, t.owner.email, t.owner.password);

    for (const ruta of ["mesas", "llamados"]) {
      await page.goto(`/panel/${t.slug}/${ruta}`);
      await expect(page.getByTestId("sucursal")).toHaveCount(2);
      await expect(page.getByRole("heading", { name: "Centro", level: 2 })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Norte", level: 2 })).toBeVisible();
    }
    await page.goto(`/panel/${t.slug}`);
    await expect(page.getByRole("link", { name: /Ver la carta/ })).toHaveCount(2);
  });
});

test.describe("tope de sucursales del plan", () => {
  test("Básico: 1 de 1, sin formulario y con el aviso; renombrar sigue funcionando", async ({ page }) => {
    const t = await nuevoLocal("suc-basico", { plan: "basic" });
    await ingresar(page, t.owner, t);

    await expect(page.getByTestId("sucursales-uso")).toContainText("1 de 1");
    await expect(page.getByTestId("aviso-tope")).toContainText("Tu plan incluye 1 sucursal y ya las usás");
    await expect(page.getByTestId("aviso-tope")).toContainText("contactá a UcoMenu");
    await expect(page.getByRole("button", { name: "Crear sucursal" })).toHaveCount(0);

    await sucursal(page, "Centro").locator("summary", { hasText: "Renombrar" }).click();
    await sucursal(page, "Centro").getByLabel("Nombre nuevo").fill("Única");
    await sucursal(page, "Centro").getByRole("button", { name: "Guardar nombre" }).click();
    await expect(sucursal(page, "Única").getByRole("status")).toContainText("Nombre guardado");
  });

  test("si el cupo se ocupa mientras la pantalla está abierta, la base lo rechaza y la pantalla muestra el tope", async ({ page }) => {
    const t = await nuevoLocal("suc-carrera"); // Pro: 2
    await ingresar(page, t.owner, t);
    await page.getByLabel("Nombre de la sucursal").fill("Tardía");

    // Alguien más ocupa el último cupo antes de enviar.
    const otra = await service().from("branches").insert({ organization_id: t.orgId, slug: "primera", name: "Primera" });
    expect(otra.error).toBeNull();
    await page.getByRole("button", { name: "Crear sucursal" }).click();

    await expect(alerta(page)).toContainText("Tu plan incluye 2 sucursales y ya las usás");
    expect((await filasDe(t.orgId)).map((f) => f.slug)).toEqual(["centro", "primera"]);
  });

  test("Premium no tiene tope: se muestra «sin tope» y se sigue pudiendo crear", async ({ page }) => {
    const t = await nuevoLocal("suc-premium", { plan: "premium" });
    await ingresar(page, t.owner, t);

    await expect(page.getByTestId("sucursales-uso")).toContainText("1, sin tope");
    for (const nombre of ["Dos", "Tres"]) {
      await crear(page, nombre);
      await expect(sucursal(page, nombre)).toBeVisible();
    }
    await expect(page.getByTestId("sucursales-uso")).toContainText("3, sin tope");
  });
});

test.describe("quién entra", () => {
  test("el Staff no ve «Sucursales» en el menú y la dirección lo devuelve al panel", async ({ page }) => {
    const t = await nuevoLocal("suc-staff");
    await login(page, t.staff.email, t.staff.password);
    await page.goto(`/panel/${t.slug}`);
    await expect(page.getByRole("link", { name: "Mesas" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sucursales" })).toHaveCount(0);

    await page.goto(`/panel/${t.slug}/sucursales`);
    await expect(page).toHaveURL(new RegExp(`/panel/${t.slug}$`));
    await expect(page.getByRole("heading", { name: "Sucursales", level: 1 })).toHaveCount(0);
  });

  test("sin sesión pide ingresar y vuelve a la pantalla", async ({ page }) => {
    const t = await nuevoLocal("suc-sin-sesion");
    await page.goto(`/panel/${t.slug}/sucursales`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel("Email").fill(t.owner.email);
    await page.getByLabel("Contraseña").fill(t.owner.password);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByRole("heading", { name: "Sucursales", level: 1 })).toBeVisible();
  });

  test("un formulario manipulado (local ajeno, sucursal ajena) no escribe en el otro local", async ({ page }) => {
    const a = await nuevoLocal("suc-manip-a");
    const b = await nuevoLocal("suc-manip-b");
    const branchB = (await service().from("branches").select("id").eq("organization_id", b.orgId).single()).data!.id;
    const antesB = JSON.stringify(await filasDe(b.orgId));
    await ingresar(page, a.owner, a);

    // 1) Cambia el campo oculto «org» por el local ajeno: para quien no es su Dueño es el 404 de siempre.
    await page.locator('form:has(#sucursal-nombre) input[name="org"]').evaluate((el: HTMLInputElement, slug) => (el.value = slug), b.slug);
    await crear(page, "Intrusa", "intrusa");
    await expect(page.getByRole("heading", { name: "No encontramos esta carta" })).toBeVisible();

    // 2) En mi local, el id de una sucursal del otro.
    await page.goto(`/panel/${a.slug}/sucursales`);
    await sucursal(page, "Centro").locator("summary", { hasText: "Renombrar" }).click();
    await sucursal(page, "Centro").locator('input[name="id"]').evaluate((el: HTMLInputElement, id) => (el.value = id), branchB);
    await sucursal(page, "Centro").getByLabel("Nombre nuevo").fill("Robada");
    await sucursal(page, "Centro").getByRole("button", { name: "Guardar nombre" }).click();
    await expect(sucursal(page, "Centro").getByRole("alert")).toContainText("No encontramos esa sucursal");

    // 3) Quien es Dueño de un local y solo Personal de otro: el formulario del primero apuntado al segundo no escribe.
    const c = await nuevoLocal("suc-manip-c", { plan: "premium" });
    const membresia = await service().from("memberships").insert({ user_id: a.owner.id, organization_id: c.orgId, role: "staff" });
    expect(membresia.error).toBeNull();
    await page.goto(`/panel/${a.slug}/sucursales`);
    await page.locator('form:has(#sucursal-nombre) input[name="org"]').evaluate((el: HTMLInputElement, slug) => (el.value = slug), c.slug);
    await crear(page, "Cruzada", "cruzada");
    await expect(page).toHaveURL(new RegExp(`/panel/${c.slug}$`)); // requireOwner devuelve al Personal a su inicio
    expect(await filasDe(c.orgId)).toEqual([{ slug: "centro", name: "Centro" }]);

    expect(JSON.stringify(await filasDe(b.orgId))).toBe(antesB);
    expect(await filasDe(a.orgId)).toEqual([{ slug: "centro", name: "Centro" }]);
  });
});

test.describe("cuenta en pausa", () => {
  for (const estado of ["read_only", "suspended"] as const) {
    test(`${estado === "read_only" ? "solo lectura" : "suspendida"}: se ve la lista con el aviso, sin poder crear ni renombrar`, async ({ page }) => {
      const t = await nuevoLocal(`suc-${estado.replace("_", "-")}`, { estado, plan: "premium" });
      await ingresar(page, t.owner, t);

      await expect(page.getByTestId("sucursales-bloqueadas")).toContainText(estado === "read_only" ? "solo lectura" : "suspendida");
      await expect(sucursal(page, "Centro")).toBeVisible();
      await expect(page.getByLabel("Nombre de la sucursal")).toBeDisabled();
      await expect(page.getByRole("button", { name: "Crear sucursal" })).toBeDisabled();
      await sucursal(page, "Centro").locator("summary", { hasText: "Renombrar" }).click();
      await expect(sucursal(page, "Centro").getByRole("button", { name: "Guardar nombre" })).toBeDisabled();
      await expectNoHorizontalOverflow(page);

      // Una acción forzada (controles reactivados a mano) tampoco guarda ni da un éxito falso.
      await page.locator("fieldset").last().evaluate((el: HTMLFieldSetElement) => (el.disabled = false));
      await page.getByLabel("Nombre de la sucursal").fill("Forzada");
      await page.getByLabel(/Identificador/).fill("forzada");
      await page.getByRole("button", { name: "Crear sucursal" }).click();
      await expect(alerta(page)).toContainText(estado === "read_only" ? "solo lectura" : "suspendida");
      await expect(page.locator("form").getByRole("status")).toHaveCount(0);
      expect(await filasDe(t.orgId)).toEqual([{ slug: "centro", name: "Centro" }]);
    });
  }

  test("en gracia se edita con normalidad", async ({ page }) => {
    const t = await nuevoLocal("suc-gracia", { estado: "grace" });
    await ingresar(page, t.owner, t);
    await crear(page, "En gracia");
    await expect(sucursal(page, "En gracia")).toBeVisible();
  });
});

test.describe("local sin sucursales y diseño móvil", () => {
  test("el Resumen del Dueño ofrece crear la primera sucursal; el Staff solo ve el aviso", async ({ page, browser }) => {
    const t = await nuevoLocal("suc-primera");
    await service().from("branches").delete().eq("organization_id", t.orgId);
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}`);
    await expect(page.getByText("Este local todavía no tiene sucursales.")).toBeVisible();
    await page.getByRole("link", { name: "Crear la primera sucursal" }).click();
    await expect(page).toHaveURL(new RegExp(`/panel/${t.slug}/sucursales$`));
    await expect(page.getByText(/sin una, la carta no se puede abrir/)).toBeVisible();
    await crear(page, "Principal");
    await expect(sucursal(page, "Principal")).toBeVisible();

    await service().from("branches").delete().eq("organization_id", t.orgId);
    const otro = await browser.newPage();
    await login(otro, t.staff.email, t.staff.password);
    await otro.goto(`/panel/${t.slug}`);
    await expect(otro.getByText("Este local todavía no tiene sucursales.")).toBeVisible();
    await expect(otro.getByRole("link", { name: "Crear la primera sucursal" })).toHaveCount(0);
    await otro.close();
  });

  test("a 390 px no desborda, con nombres largos, y los objetivos táctiles miden al menos 44 px", async ({ page }) => {
    const t = await nuevoLocal("suc-movil");
    const largo = "Sucursal con un nombre larguísimo que ocupa mucho espacio en la pantalla";
    await service().from("branches").insert({ organization_id: t.orgId, slug: "a".repeat(60), name: largo });
    // El nombre del local (sin espacios, 80 caracteres) va en la cabecera del marco: tampoco debe ensanchar la página.
    await service().from("organizations").update({ name: "N".repeat(80) }).eq("id", t.orgId);
    await ingresar(page, t.owner, t);
    await sucursal(page, "Centro").locator("summary", { hasText: "Renombrar" }).click();
    await expectNoHorizontalOverflow(page);

    const controles = [
      page.getByRole("link", { name: "Ver la carta de Centro" }),
      page.getByRole("link", { name: "Mesas de Centro" }),
      sucursal(page, "Centro").locator("summary", { hasText: "Renombrar" }),
      sucursal(page, "Centro").getByRole("button", { name: "Guardar nombre" }),
      sucursal(page, "Centro").getByLabel("Nombre nuevo"),
      page.getByRole("link", { name: "Sucursales" }),
    ];
    for (const control of controles) {
      const caja = await control.boundingBox();
      expect(caja!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
