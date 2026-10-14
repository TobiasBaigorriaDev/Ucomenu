import { expect, test } from "@playwright/test";
import {
  SEED,
  alerta,
  SEED_PASSWORD,
  TEST_PASSWORD,
  createTenant,
  deleteAccountsByEmail,
  expectNoHorizontalOverflow,
  login,
  service,
  type Tenant,
} from "./support";

/**
 * Acceso del personal (nivel C): sesión, rutas por rol, aviso de mora y gestión del personal,
 * contra el build y el Supabase local. A 390 px, el teléfono de referencia.
 */

const NUEVA = "otra-contrasena-123";

test.describe("sin sesión", () => {
  for (const ruta of ["/panel", "/panel/cafe-ejemplo", "/panel/cafe-ejemplo/personal", "/panel/cafe-ejemplo/suscripcion", "/sala", "/sala/cafe-ejemplo", "/cuenta"]) {
    test(`${ruta} pide ingresar y vuelve a la ruta después`, async ({ page }) => {
      await page.goto(ruta);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(ruta).replace(/%/g, "%")}`));
      await expect(page.getByRole("heading", { name: "Ingresá a tu cuenta" })).toBeVisible();
      // No se filtra nada del panel.
      await expect(page.getByText("Café Ejemplo")).toHaveCount(0);
    });
  }

  test("el login muestra el mismo mensaje para cuenta inexistente y para contraseña errónea", async ({ page }) => {
    await login(page, "no-existe@example.test", "cualquier-cosa-123");
    const inexistente = await alerta(page).innerText();

    await login(page, SEED.duenoCafe, "contrasena-equivocada");
    const equivocada = await alerta(page).innerText();

    expect(inexistente).toBe("Email o contraseña incorrectos.");
    expect(equivocada).toBe(inexistente);
    await expect(page).toHaveURL(/\/login/);
  });

  test("un destino externo o malformado en next se ignora", async ({ page }) => {
    for (const next of ["https://evil.test", "//evil.test", "/admin", "/panel/../admin"]) {
      await login(page, SEED.duenoCafe, SEED_PASSWORD, next);
      await expect(page).toHaveURL(/\/panel\/cafe-ejemplo$/);
      await page.getByRole("button", { name: "Salir" }).click();
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test("no hay registro público", async ({ request }) => {
    const respuesta = await request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", "Content-Type": "application/json" },
      data: { email: `intruso-${Date.now()}@example.test`, password: "contrasena-larga-123" },
    });
    expect(respuesta.status()).toBe(422);
    expect((await respuesta.json()).error_code).toBe("signup_disabled");
  });
});

test.describe("el Dueño", () => {
  test("ingresa, entra directo a su local, ve todas las secciones y la cookie de sesión es httpOnly", async ({ page, context }) => {
    await login(page, SEED.duenoCafe, SEED_PASSWORD);

    await expect(page).toHaveURL(/\/panel\/cafe-ejemplo$/);
    await expect(page.getByRole("link", { name: "Café Ejemplo" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Secciones del panel" });
    for (const seccion of ["Resumen", "Suscripción", "Personal", "Sala en vivo"]) {
      await expect(nav.getByRole("link", { name: seccion })).toBeVisible();
    }
    await expect(page.getByTestId("mora-banner")).toHaveCount(0);

    const cookies = (await context.cookies()).filter((c) => c.name.startsWith("sb-"));
    expect(cookies.length).toBeGreaterThan(0);
    for (const c of cookies) expect(c.httpOnly, c.name).toBe(true);

    // Suscripción: plan y estado visibles solo al Dueño.
    await nav.getByRole("link", { name: "Suscripción" }).click();
    await expect(page.getByRole("heading", { name: "Suscripción" })).toBeVisible();
    await expect(page.getByText("Básico")).toBeVisible();
    await expect(page.getByText("Al día")).toBeVisible();
  });

  test("vuelve al destino que pidió antes de ingresar", async ({ page }) => {
    await login(page, SEED.duenoCafe, SEED_PASSWORD, "/panel/cafe-ejemplo/personal");
    await expect(page).toHaveURL(/\/panel\/cafe-ejemplo\/personal$/);
    await expect(page.getByRole("heading", { name: "Tu equipo" })).toBeVisible();
  });

  test("cerrar sesión corta el acceso", async ({ page }) => {
    await login(page, SEED.duenoCafe, SEED_PASSWORD);
    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/panel/cafe-ejemplo");
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("a 390 px el panel, el personal y el login no desbordan", async ({ page }) => {
    await page.goto("/login");
    await expectNoHorizontalOverflow(page);
    await login(page, SEED.duenoCafe, SEED_PASSWORD);
    await expectNoHorizontalOverflow(page);
    await page.goto("/panel/cafe-ejemplo/personal");
    await expectNoHorizontalOverflow(page);
    await page.goto("/cuenta");
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("el Staff", () => {
  test("ve el panel y la sala pero no Suscripción ni Personal; las URL lo devuelven al inicio", async ({ page }) => {
    await login(page, SEED.mozoCafe, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/panel\/cafe-ejemplo$/);

    const nav = page.getByRole("navigation", { name: "Secciones del panel" });
    await expect(nav.getByRole("link", { name: "Resumen" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Sala en vivo" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Suscripción" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Personal" })).toHaveCount(0);
    await expect(page.getByText("Uso del plan")).toHaveCount(0);

    for (const ruta of ["/panel/cafe-ejemplo/personal", "/panel/cafe-ejemplo/suscripcion"]) {
      await page.goto(ruta);
      await expect(page).toHaveURL(/\/panel\/cafe-ejemplo$/);
      await expect(page.getByText("Tu equipo")).toHaveCount(0);
      await expect(page.getByText("Plan", { exact: true })).toHaveCount(0);
    }

    await page.goto("/sala/cafe-ejemplo");
    await expect(page.getByRole("heading", { name: "Sala en vivo" })).toBeVisible();
  });

  test("otro local o uno inexistente responden 404 idéntico", async ({ page }) => {
    await login(page, SEED.mozoCafe, SEED_PASSWORD);

    const ajeno = await page.goto("/panel/parrilla-demo");
    const textoAjeno = await page.locator("body").innerText();
    const inexistente = await page.goto("/panel/no-existe-este-local");
    const textoInexistente = await page.locator("body").innerText();

    expect(ajeno?.status()).toBe(404);
    expect(inexistente?.status()).toBe(404);
    expect(textoAjeno).toBe(textoInexistente);
    expect(textoAjeno).not.toContain("Parrilla Demo");

    for (const ruta of ["/panel/parrilla-demo/personal", "/sala/parrilla-demo"]) {
      expect((await page.goto(ruta))?.status(), ruta).toBe(404);
    }
  });
});

test.describe("varios locales", () => {
  test("selector al entrar, cambio desde la cabecera y roles distintos por local", async ({ page }) => {
    await login(page, SEED.multi, SEED_PASSWORD);

    await expect(page).toHaveURL(/\/panel$/);
    await expect(page.getByRole("heading", { name: "¿A qué local entrás?" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Café Ejemplo.*Dueño/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Parrilla Demo.*Personal/ })).toBeVisible();

    await page.getByRole("link", { name: /Parrilla Demo/ }).click();
    await expect(page).toHaveURL(/\/panel\/parrilla-demo$/);
    const nav = page.getByRole("navigation", { name: "Secciones del panel" });
    await expect(nav.getByRole("link", { name: "Personal" })).toHaveCount(0); // staff en este local
    expect((await page.goto("/panel/parrilla-demo/personal").then(() => page.url()))).toMatch(/\/panel\/parrilla-demo$/);

    await page.getByRole("link", { name: "Cambiar de local" }).click();
    await expect(page).toHaveURL(/\/panel$/);
    await page.getByRole("link", { name: /Café Ejemplo/ }).click();
    await expect(page.getByRole("navigation", { name: "Secciones del panel" }).getByRole("link", { name: "Personal" })).toBeVisible();
    await expect(page.getByText("Parrilla Demo")).toHaveCount(0);
  });
});

test.describe("aviso de mora", () => {
  const casos: { estado: "grace" | "read_only" | "suspended"; dueno: RegExp; staff: RegExp; tono: string }[] = [
    { estado: "grace", dueno: /Tu suscripción venció hace 3 días/, staff: /El pago de la suscripción está vencido/, tono: "grace" },
    { estado: "read_only", dueno: /Tu cuenta está en solo lectura/, staff: /La cuenta está en solo lectura/, tono: "read_only" },
    { estado: "suspended", dueno: /Tu cuenta está suspendida/, staff: /La cuenta está suspendida/, tono: "suspended" },
  ];

  for (const caso of casos) {
    test(`${caso.estado}: el Dueño ve fechas, el Staff solo el estado`, async ({ page, browser }) => {
      const t = await createTenant(`mora-${caso.estado.replace("_", "-")}`, caso.estado);
      try {
        await login(page, t.owner.email, t.owner.password);
        await expect(page).toHaveURL(new RegExp(`/panel/${t.slug}$`));
        const bannerDueno = page.getByTestId("mora-banner");
        await expect(bannerDueno).toBeVisible();
        await expect(bannerDueno).toHaveAttribute("data-tone", caso.tono);
        await expect(bannerDueno).toContainText(caso.dueno);
        await expect(bannerDueno).toContainText(/Contactá a UcoMenu/);

        const ctxStaff = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const pageStaff = await ctxStaff.newPage();
        await login(pageStaff, t.staff.email, t.staff.password);
        const bannerStaff = pageStaff.getByTestId("mora-banner");
        await expect(bannerStaff).toContainText(caso.staff);
        await expect(bannerStaff).toContainText(/dueño/);
        expect(await bannerStaff.innerText()).not.toMatch(/\d/); // sin días ni fechas
        await ctxStaff.close();
      } finally {
        await t.cleanup();
      }
    });
  }

  test("el aviso aparece también en la sala y en las otras secciones", async ({ page }) => {
    await login(page, SEED.duenoMoroso, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/panel\/resto-moroso$/);
    await expect(page.getByTestId("mora-banner")).toContainText("Tu cuenta está suspendida");
    await page.goto("/panel/resto-moroso/personal");
    await expect(page.getByTestId("mora-banner")).toBeVisible();
    await page.goto("/sala/resto-moroso");
    await expect(page.getByTestId("mora-banner")).toBeVisible();
  });
});

test.describe("sesión", () => {
  test("una cuenta borrada pierde el acceso aunque conserve la cookie", async ({ page }) => {
    const t = await createTenant("borrada");
    try {
      await login(page, t.staff.email, t.staff.password);
      await expect(page).toHaveURL(new RegExp(`/panel/${t.slug}$`));

      await service().auth.admin.deleteUser(t.staff.id);

      await page.reload();
      await expect(page).toHaveURL(/\/login/);
    } finally {
      await t.cleanup();
    }
  });

  test("quitar la membresía corta el acceso al local en el siguiente pedido", async ({ page }) => {
    const t = await createTenant("sin-membresia");
    try {
      await login(page, t.staff.email, t.staff.password);
      await expect(page).toHaveURL(new RegExp(`/panel/${t.slug}$`));

      await service().from("memberships").delete().eq("user_id", t.staff.id);

      const respuesta = await page.goto(`/panel/${t.slug}`);
      expect(respuesta?.status()).toBe(404);
    } finally {
      await t.cleanup();
    }
  });
});

test.describe("gestión del personal", () => {
  let t: Tenant;
  const emails: string[] = [];

  test.beforeEach(async () => {
    t = await createTenant("personal");
  });

  test.afterEach(async () => {
    await t.cleanup();
    await deleteAccountsByEmail(emails.splice(0));
  });

  test("el Dueño suma a un Staff, la persona ingresa, se le cambia la contraseña y se la quita", async ({ page, browser }) => {
    const email = `e2e-nuevo-${Date.now()}@example.test`;
    emails.push(email);

    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/personal`);

    // Alta
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña inicial").fill(TEST_PASSWORD);
    await page.getByLabel("Rol").selectOption("staff");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByRole("status").filter({ hasText: "ya puede ingresar" })).toBeVisible();
    const fila = page.getByTestId("member-row").filter({ hasText: email });
    await expect(fila).toBeVisible();
    await expect(fila).toContainText("Personal");

    // La persona ingresa y ve lo del Staff.
    const ctxNuevo = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const paginaNueva = await ctxNuevo.newPage();
    await login(paginaNueva, email, TEST_PASSWORD);
    await expect(paginaNueva).toHaveURL(new RegExp(`/panel/${t.slug}$`));
    await expect(paginaNueva.getByRole("navigation", { name: "Secciones del panel" }).getByRole("link", { name: "Personal" })).toHaveCount(0);

    // Restablecer su contraseña
    await fila.getByText("Cambiar contraseña").click();
    await fila.getByLabel("Contraseña nueva").fill(NUEVA);
    await fila.getByRole("button", { name: "Guardar contraseña" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Contraseña cambiada" })).toBeVisible();

    const ctxViejo = await browser.newContext();
    const paginaVieja = await ctxViejo.newPage();
    await login(paginaVieja, email, TEST_PASSWORD);
    await expect(alerta(paginaVieja)).toHaveText("Email o contraseña incorrectos.");
    await login(paginaVieja, email, NUEVA);
    await expect(paginaVieja).toHaveURL(new RegExp(`/panel/${t.slug}$`));
    await ctxViejo.close();

    // Quitarla
    await fila.getByText("Quitar", { exact: true }).click();
    await fila.getByRole("button", { name: "Sí, quitar" }).click();
    await expect(page.getByTestId("member-row").filter({ hasText: email })).toHaveCount(0);

    // Con la sesión que tenía abierta ya no entra al local.
    expect((await paginaNueva.goto(`/panel/${t.slug}`))?.status() === 404 || /\/login/.test(paginaNueva.url())).toBe(true);
    const ctxFinal = await browser.newContext();
    const paginaFinal = await ctxFinal.newPage();
    await login(paginaFinal, email, NUEVA);
    await expect(alerta(paginaFinal)).toBeVisible();
    await ctxFinal.close();
    await ctxNuevo.close();
  });

  test("un email ya registrado da un error genérico y no toca la cuenta existente", async ({ page }) => {
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/personal`);

    await page.getByLabel("Email").fill(SEED.mozoParrilla);
    await page.getByLabel("Contraseña inicial").fill(NUEVA);
    await page.getByRole("button", { name: "Crear cuenta" }).click();

    await expect(alerta(page)).toHaveText("No se pudo crear la cuenta con ese email.");
    await expect(page.getByTestId("member-row").filter({ hasText: SEED.mozoParrilla })).toHaveCount(0);
  });

  test("con una contraseña corta se avisa y se conserva el email escrito", async ({ page }) => {
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/personal`);
    const email = `e2e-corta-${Date.now()}@example.test`;

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña inicial").fill("corta");
    // minlength del navegador: se salta para probar la validación del servidor.
    await page.getByLabel("Contraseña inicial").evaluate((el: HTMLInputElement) => el.removeAttribute("minlength"));
    await page.getByRole("button", { name: "Crear cuenta" }).click();

    await expect(alerta(page)).toHaveText("La contraseña tiene que tener al menos 10 caracteres.");
    await expect(page.getByLabel("Email")).toHaveValue(email);
  });

  test("el único Dueño no puede quitarse ni bajarse; otro Dueño sí puede cambiar roles", async ({ page }) => {
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/personal`);

    const propia = page.getByTestId("member-row").filter({ hasText: t.owner.email });
    await expect(propia).toContainText("Esta es tu cuenta");
    await expect(propia.getByText("Quitar", { exact: true })).toHaveCount(0);
    await expect(propia.getByRole("button", { name: "Pasar a personal" })).toHaveCount(0);

    // Subir al Staff a Dueño y volver a bajarlo.
    const staff = page.getByTestId("member-row").filter({ hasText: t.staff.email });
    await staff.getByRole("button", { name: "Hacer dueño" }).click();
    await expect(staff).toContainText("Dueño");
    await staff.getByRole("button", { name: "Pasar a personal" }).click();
    await expect(staff).toContainText("Personal");
  });

  test("una pantalla abierta de alguien que ya no es Dueño no puede ejecutar acciones", async ({ page }) => {
    const email = `e2e-vieja-${Date.now()}@example.test`;
    emails.push(email);
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/personal`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña inicial").fill(TEST_PASSWORD);

    // Mientras la pantalla sigue abierta, otro Dueño lo baja a Staff (y deja a un tercero como Dueño).
    const db = service();
    await db.from("memberships").update({ role: "owner" }).eq("user_id", t.staff.id);
    const bajada = await db.from("memberships").update({ role: "staff" }).eq("user_id", t.owner.id);
    expect(bajada.error).toBeNull();

    await page.getByRole("button", { name: "Crear cuenta" }).click();

    // El servidor lo devuelve al inicio y no crea nada.
    await expect(page).toHaveURL(new RegExp(`/panel/${t.slug}$`));
    const creado = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.some((u) => u.email === email);
    expect(creado).toBe(false);
  });
});

test.describe("mi cuenta", () => {
  test("cambiar la propia contraseña pide la actual", async ({ page, browser }) => {
    const t = await createTenant("cuenta");
    try {
      await login(page, t.staff.email, t.staff.password);
      await page.goto("/cuenta");
      await expect(page.getByText(t.staff.email)).toBeVisible();

      await page.getByLabel("Contraseña actual").fill("no-es-esta-contrasena");
      await page.getByLabel("Contraseña nueva", { exact: true }).fill(NUEVA);
      await page.getByLabel("Repetí la contraseña nueva").fill(NUEVA);
      await page.getByRole("button", { name: "Cambiar contraseña" }).click();
      await expect(alerta(page)).toHaveText("La contraseña actual no es correcta.");

      await page.getByLabel("Contraseña actual").fill(t.staff.password);
      await page.getByLabel("Contraseña nueva", { exact: true }).fill(NUEVA);
      await page.getByLabel("Repetí la contraseña nueva").fill("otra-distinta-12345");
      await page.getByRole("button", { name: "Cambiar contraseña" }).click();
      await expect(alerta(page)).toHaveText("La contraseña nueva y su repetición no coinciden.");

      await page.getByLabel("Contraseña actual").fill(t.staff.password);
      await page.getByLabel("Contraseña nueva", { exact: true }).fill(NUEVA);
      await page.getByLabel("Repetí la contraseña nueva").fill(NUEVA);
      await page.getByRole("button", { name: "Cambiar contraseña" }).click();
      await expect(page.getByRole("status").filter({ hasText: "cambiaste tu contraseña" })).toBeVisible();

      const otro = await browser.newContext();
      const paginaOtro = await otro.newPage();
      await login(paginaOtro, t.staff.email, NUEVA);
      await expect(paginaOtro).toHaveURL(new RegExp(`/panel/${t.slug}$`));
      await otro.close();
    } finally {
      await t.cleanup();
    }
  });
});
