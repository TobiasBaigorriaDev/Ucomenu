import { expect, test, type Page } from "@playwright/test";
import { purgeAuditLogWhere } from "../tests/rls/purge-price-history";
import { SEED, SEED_PASSWORD, TEST_PASSWORD, alerta, createTenant, deleteAccountsByEmail, expectNoHorizontalOverflow, login, service } from "./support";
import { sql } from "../tests/rls/helpers"; // después de ./support: este carga las variables de entorno

/**
 * SuperAdmin (nivel C, ficha superadmin-alta-de-organizaciones): quién entra a /admin y el alta de una organización con su
 * Dueño y su plan, contra el build y el Supabase local. A 390 px, el teléfono de referencia.
 * El SuperAdmin de ejemplo (admin@ucomenu.test) lo crea el seed; lo que se da de alta lo limpia cada prueba.
 */

const ADMIN_EMAIL = "admin@ucomenu.test";
const rand = () => Math.random().toString(36).slice(2, 8);

async function limpiar(slug: string, emails: string[]) {
  const db = service();
  const org = await db.from("organizations").select("id").eq("slug", slug).maybeSingle();
  purgeAuditLogWhere(`after->>'slug' = '${slug}'`);
  if (org.data) await db.from("organizations").delete().eq("id", org.data.id);
  await deleteAccountsByEmail(emails);
}

async function llenarAlta(
  page: Page,
  datos: {
    name: string;
    slug: string;
    email: string;
    password: string;
    sucursal?: string;
    plan?: string;
    ciclo?: string;
    hasta?: string;
  },
) {
  await page.goto("/admin/nueva");
  await page.getByLabel("Nombre de la organización").fill(datos.name);
  await page.getByLabel("Identificador (slug)").fill(datos.slug);
  await page.getByLabel("Nombre de la primera sucursal").fill(datos.sucursal ?? "Casa central");
  await page.getByLabel("Email del Dueño").fill(datos.email);
  await page.getByLabel("Contraseña temporal del Dueño").fill(datos.password);
  if (datos.plan) await page.getByLabel("Plan", { exact: true }).selectOption(datos.plan);
  if (datos.ciclo) await page.getByLabel("Facturación").selectOption(datos.ciclo);
  if (datos.hasta) await page.getByLabel("Vigente hasta").fill(datos.hasta);
}

test.describe("quién entra a /admin", () => {
  test("sin sesión pide ingresar y vuelve a /admin después", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
    await expect(page.getByRole("heading", { name: "Ingresá a tu cuenta" })).toBeVisible();
  });

  for (const [rol, email] of [
    ["un Dueño", SEED.duenoCafe],
    ["el personal de un local", SEED.mozoCafe],
  ] as const) {
    test(`${rol} recibe un 404 sin marco de SuperAdmin, en /admin y en /admin/nueva`, async ({ page }) => {
      await login(page, email, SEED_PASSWORD, "/admin");
      for (const ruta of ["/admin", "/admin/nueva"]) {
        const respuesta = await page.goto(ruta);
        expect(respuesta?.status(), ruta).toBe(404);
        await expect(page.getByText("SuperAdmin"), ruta).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Nueva organización" }), ruta).toHaveCount(0);
        await expect(page.getByText("Café Ejemplo")).toHaveCount(0);
      }
    });
  }

  test("al iniciar sesión sin next, el SuperAdmin aterriza en /admin, también al abrir /login con sesión", async ({ page }) => {
    await login(page, ADMIN_EMAIL, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Organizaciones" })).toBeVisible();
    // Con sesión abierta, /login no muestra el formulario y lleva al mismo destino.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("un next válido manda también para el SuperAdmin; uno inválido cae al destino por defecto", async ({ page }) => {
    await login(page, ADMIN_EMAIL, SEED_PASSWORD, "/panel/cafe-ejemplo");
    await expect(page).toHaveURL(/\/panel\/cafe-ejemplo/);
    await page.goto("/login?next=%2F%2Fevil.test");
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("el Dueño que inicia sesión sin next sigue yendo a /panel", async ({ page }) => {
    await login(page, SEED.duenoCafe, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/panel/);
    await expect(page).not.toHaveURL(/\/admin/);
  });

  test("el SuperAdmin entra, ve las organizaciones y la auditoría, y navega entre las dos pantallas", async ({ page }) => {
    await login(page, ADMIN_EMAIL, SEED_PASSWORD, "/admin");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Organizaciones" })).toBeVisible();
    await expect(page.getByTestId("organizacion").filter({ hasText: "cafe-ejemplo" })).toContainText("dueno@cafe-ejemplo.test");
    await expect(page.getByRole("heading", { name: "Últimos movimientos" })).toBeVisible();

    await page.getByRole("navigation", { name: "Secciones de SuperAdmin" }).getByRole("link", { name: "Nueva organización" }).click();
    await expect(page).toHaveURL(/\/admin\/nueva$/);
    await expect(page.getByRole("heading", { name: "Nueva organización" })).toBeVisible();
  });
});

test.describe("alta de una organización", () => {
  test("crea la organización con su Dueño y su plan, queda en la auditoría y el Dueño puede entrar", async ({ page }) => {
    const slug = `e2e-adm-${rand()}`;
    const email = `e2e-adm-${rand()}@example.test`;
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, "/admin/nueva");
      await llenarAlta(page, { name: "Café del Test", slug, email, password: TEST_PASSWORD, plan: "pro", ciclo: "yearly" });
      // Por defecto propone 14 días de vigencia.
      await expect(page.getByLabel("Vigente hasta")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
      await page.getByRole("button", { name: "Crear organización" }).click();

      await expect(page.locator("form").getByRole("status")).toContainText(`«${slug}» está creada`);
      await expect(page.locator("form").getByRole("status")).toContainText(`/m/${slug}/principal`);
      await expect(alerta(page)).toHaveCount(0);

      // La carta pública de la sucursal inicial ya se abre (antes daba 404 hasta crear la sucursal por script).
      const carta = await page.goto(`/m/${slug}/principal`);
      expect(carta?.status()).toBe(200);
      await expect(page.getByText("Casa central").first()).toBeVisible();
      await page.goto("/admin");

      // El listado la muestra con su plan, su vencimiento y su Dueño; la auditoría, con quién la hizo.
      await page.goto("/admin");
      const org = page.getByTestId("organizacion").filter({ hasText: `(${slug})` });
      await expect(org).toContainText("Café del Test");
      await expect(org).toContainText("Pro, anual");
      await expect(org).toContainText("vigente hasta el");
      await expect(org).toContainText(email);
      const movimiento = page.getByTestId("auditoria").filter({ hasText: slug });
      await expect(movimiento).toContainText("Alta de organización");
      await expect(movimiento).toContainText(`por ${ADMIN_EMAIL}`);

      // El Dueño nuevo entra con su contraseña temporal y ve el plan que se le asignó.
      await page.getByRole("button", { name: "Salir" }).click();
      await expect(page).toHaveURL(/\/login$/);
      await login(page, email, TEST_PASSWORD, `/panel/${slug}/suscripcion`);
      await expect(page).toHaveURL(new RegExp(`/panel/${slug}/suscripcion$`));
      await expect(page.getByRole("heading", { name: "Suscripción" })).toBeVisible();
      await expect(page.getByText("Pro", { exact: true })).toBeVisible();
      await expect(page.getByText("Anual", { exact: true })).toBeVisible();
      await expect(page.getByText("Al día")).toBeVisible();

      // Y no tiene acceso a /admin.
      expect((await page.goto("/admin"))?.status()).toBe(404);
    } finally {
      await limpiar(slug, [email]);
    }
  });

  test("el identificador de la sucursal propone «principal» y uno inválido se rechaza sin crear nada", async ({ page }) => {
    const slug = `e2e-adm-${rand()}`;
    const email = `e2e-adm-${rand()}@example.test`;
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, "/admin/nueva");
      await expect(page.getByLabel("Identificador de la sucursal (slug)")).toHaveValue("principal");

      await llenarAlta(page, { name: "Sucursal mala", slug, email, password: TEST_PASSWORD });
      await page.getByLabel("Identificador de la sucursal (slug)").fill("Casa Central");
      await page.getByRole("button", { name: "Crear organización" }).click();
      await expect(alerta(page)).toContainText("identificador de la sucursal");
      // Lo escrito se conserva, incluida la sucursal.
      await expect(page.getByLabel("Nombre de la primera sucursal")).toHaveValue("Casa central");

      expect((await service().from("organizations").select("id").eq("slug", slug)).data).toEqual([]);
      const cuentas = (await service().auth.admin.listUsers({ perPage: 1000 })).data.users;
      expect(cuentas.some((u) => u.email === email)).toBe(false);
    } finally {
      await limpiar(slug, [email]);
    }
  });

  test("un identificador ya usado se rechaza con un mensaje claro y no crea nada", async ({ page }) => {
    const email = `e2e-adm-${rand()}@example.test`;
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, "/admin/nueva");
      await llenarAlta(page, { name: "Repetida", slug: "cafe-ejemplo", email, password: TEST_PASSWORD });
      await page.getByRole("button", { name: "Crear organización" }).click();

      await expect(alerta(page)).toContainText("Ya existe una organización con ese identificador.");
      // Lo escrito se conserva (menos la contraseña).
      await expect(page.getByLabel("Email del Dueño")).toHaveValue(email);
      // La organización existente no se tocó y no apareció otra con ese nombre.
      const existente = await service().from("organizations").select("name").eq("slug", "cafe-ejemplo").single();
      expect(existente.data?.name).toBe("Café Ejemplo");
      expect((await service().from("organizations").select("id").eq("name", "Repetida")).data).toEqual([]);
      const cuentas = (await service().auth.admin.listUsers({ perPage: 1000 })).data.users;
      expect(cuentas.some((u) => u.email === email)).toBe(false);
    } finally {
      await deleteAccountsByEmail([email]);
    }
  });

  test("un email que ya tiene cuenta se rechaza sin tocar esa cuenta ni crear la organización", async ({ page }) => {
    const slug = `e2e-adm-${rand()}`;
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, "/admin/nueva");
      await llenarAlta(page, { name: "Con cuenta", slug, email: SEED.mozoCafe, password: "una-contrasena-distinta-123" });
      await page.getByRole("button", { name: "Crear organización" }).click();

      await expect(alerta(page)).toContainText("Ese email ya tiene una cuenta");
      expect((await service().from("organizations").select("id").eq("slug", slug)).data).toEqual([]);
      // La cuenta existente conserva su contraseña.
      await page.getByRole("button", { name: "Salir" }).click();
      await expect(page).toHaveURL(/\/login/); // sin esto, /login se abre con la sesión del SuperAdmin aún viva
      await login(page, SEED.mozoCafe, SEED_PASSWORD);
      await expect(page).toHaveURL(/\/panel\/cafe-ejemplo$/);
    } finally {
      await limpiar(slug, []);
    }
  });

  test("datos inválidos (contraseña corta, fecha vencida) se rechazan sin crear nada", async ({ page }) => {
    const slug = `e2e-adm-${rand()}`;
    const email = `e2e-adm-${rand()}@example.test`;
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, "/admin/nueva");

      await llenarAlta(page, { name: "Inválida", slug, email, password: "corta" });
      // El navegador ya exige 10 caracteres (minLength): se lo saca para comprobar también la validación del servidor.
      await page.getByLabel("Contraseña temporal del Dueño").evaluate((el: HTMLInputElement) => el.removeAttribute("minlength"));
      await page.getByRole("button", { name: "Crear organización" }).click();
      await expect(alerta(page)).toContainText("al menos 10 caracteres");

      await page.getByLabel("Contraseña temporal del Dueño").fill(TEST_PASSWORD);
      await page.getByLabel("Vigente hasta").fill("2020-01-01");
      await page.getByRole("button", { name: "Crear organización" }).click();
      await expect(alerta(page)).toContainText("fecha futura");

      expect((await service().from("organizations").select("id").eq("slug", slug)).data).toEqual([]);
      const cuentas = (await service().auth.admin.listUsers({ perPage: 1000 })).data.users;
      expect(cuentas.some((u) => u.email === email)).toBe(false);
    } finally {
      await limpiar(slug, [email]);
    }
  });

  test("una pantalla abierta de alguien que ya no es SuperAdmin no puede ejecutar el alta", async ({ page }) => {
    const slug = `e2e-adm-${rand()}`;
    const email = `e2e-adm-${rand()}@example.test`;
    const adminEmail = `e2e-adm-baja-${rand()}@example.test`;
    const db = service();
    const creada = await db.auth.admin.createUser({ email: adminEmail, password: TEST_PASSWORD, email_confirm: true });
    if (creada.error || !creada.data.user) throw new Error("No se pudo crear el SuperAdmin de prueba");
    try {
      sql(`insert into public.platform_admins (user_id) values ('${creada.data.user.id}')`);
      await login(page, adminEmail, TEST_PASSWORD, "/admin/nueva");
      await llenarAlta(page, { name: "Sin permiso", slug, email, password: TEST_PASSWORD });
      await expect(page.getByRole("button", { name: "Crear organización" })).toBeVisible();

      // Con la pantalla ya abierta, le quitan el rol.
      sql(`delete from public.platform_admins where user_id = '${creada.data.user.id}'`);
      await page.getByRole("button", { name: "Crear organización" }).click();
      await page.waitForTimeout(1500);

      expect((await db.from("organizations").select("id").eq("slug", slug)).data).toEqual([]);
      const cuentas = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users;
      expect(cuentas.some((u) => u.email === email)).toBe(false);
      await expect(page.locator("form").getByRole("status")).toHaveCount(0);
      expect((await page.goto("/admin"))?.status()).toBe(404);
    } finally {
      await limpiar(slug, [email, adminEmail]);
    }
  });

  test("el formulario y el listado caben en 390 px", async ({ page }) => {
    await login(page, ADMIN_EMAIL, SEED_PASSWORD, "/admin/nueva");
    await expect(page.getByRole("heading", { name: "Nueva organización" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Organizaciones" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("un identificador de 64 caracteres sin guiones y el estado de la cuenta se ven bien en 390 px", async ({ page }) => {
    const slug = `e2e-adm-${rand()}${"x".repeat(64)}`.slice(0, 64);
    const nombre = "N".repeat(80);
    const email = `e2e-adm-${rand()}@example.test`;
    expect(slug).toHaveLength(64);
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, "/admin/nueva");
      await llenarAlta(page, { name: nombre, slug, email, password: TEST_PASSWORD, plan: "premium", ciclo: "yearly" });
      await page.getByRole("button", { name: "Crear organización" }).click();
      await expect(page.locator("form").getByRole("status")).toContainText("está creada");

      // Al día: el listado y la auditoría muestran el slug largo sin desbordar.
      await page.goto("/admin");
      const org = page.getByTestId("organizacion").filter({ hasText: slug });
      await expect(org).toContainText("Al día");
      await expect(org).toContainText("vigente hasta el");
      await expect(page.getByTestId("auditoria").filter({ hasText: slug })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Vencida hace 10 días: el listado dice el estado, no solo «venció el».
      const db = service();
      const fila = await db.from("organizations").select("id").eq("slug", slug).single();
      await db
        .from("subscriptions")
        .update({ current_period_end: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), trial_ends_at: null })
        .eq("organization_id", fila.data!.id);
      await page.goto("/admin");
      await expect(org).toContainText("Vencida, en solo lectura");
      await expect(org).toContainText("venció el");
      await expect(org).not.toContainText("Al día");
      await expectNoHorizontalOverflow(page);
    } finally {
      await limpiar(slug, [email]);
    }
  });
});

test.describe("Mi cuenta (/cuenta) según quién entra", () => {
  test("el SuperAdmin ve el marco y el regreso de /admin, y sigue pudiendo cambiar su contraseña acá (móvil y escritorio)", async ({ page }) => {
    await login(page, ADMIN_EMAIL, SEED_PASSWORD, "/cuenta");
    await expect(page).toHaveURL(/\/cuenta$/);
    await expect(page.getByRole("heading", { name: "Cambiar mi contraseña" })).toBeVisible();
    await expect(page.getByText("SuperAdmin", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Volver a la administración" })).toHaveAttribute("href", "/admin");
    await expect(page.getByRole("link", { name: "Volver al panel" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    // Escritorio: el riel lateral es el de la administración.
    await page.setViewportSize({ width: 1280, height: 800 });
    const secciones = page.getByRole("navigation", { name: "Secciones de SuperAdmin" });
    await expect(secciones.getByRole("link", { name: "Organizaciones" })).toBeVisible();
    await expect(secciones.getByRole("link", { name: "Nueva organización" })).toBeVisible();
    await page.getByRole("link", { name: "Volver a la administración" }).click();
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("un SuperAdmin que además trabaja en un local conserva el enlace a su panel", async ({ page }) => {
    const t = await createTenant("cuenta-admin");
    try {
      sql(`insert into public.platform_admins (user_id) values ('${t.owner.id}')`);
      await login(page, t.owner.email, t.owner.password, "/cuenta");
      await expect(page).toHaveURL(/\/cuenta$/);
      await expect(page.getByRole("link", { name: "Volver a la administración" })).toHaveAttribute("href", "/admin");
      await expect(page.getByRole("link", { name: "Ir al panel de mi local" })).toHaveAttribute("href", `/panel/${t.slug}`);
    } finally {
      await t.cleanup();
    }
  });

  test("el Dueño de un local vuelve a su panel y el de varios locales, al selector; ninguno ve el marco de SuperAdmin", async ({ page }) => {
    await login(page, SEED.duenoCafe, SEED_PASSWORD, "/cuenta");
    await expect(page.getByRole("link", { name: "Volver al panel" })).toHaveAttribute("href", "/panel/cafe-ejemplo");
    await expect(page.getByText("SuperAdmin", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Volver a la administración" })).toHaveCount(0);

    await page.context().clearCookies();
    await login(page, SEED.multi, SEED_PASSWORD, "/cuenta");
    await expect(page.getByRole("link", { name: "Volver al panel" })).toHaveAttribute("href", "/panel");
    await expect(page.getByText("SuperAdmin", { exact: true })).toHaveCount(0);
  });
});
