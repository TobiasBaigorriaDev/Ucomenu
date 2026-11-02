import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, service } from "./support";

/**
 * Registro autoservicio (nivel C, ficha registro-autoservicio, ADR 0053) de punta a punta, contra el build, el Supabase local y su buzón
 * de prueba (Mailpit), a 390 px. Google y Turnstile no se prueban acá: necesitan cuentas reales y se comprueban en staging.
 */

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const CLAVE = "contrasena-nueva-1234";
const pendientes = { orgs: [] as string[], emails: [] as string[] };

const emailNuevo = (etiqueta: string) => {
  const email = `e2e-${etiqueta}-${randomUUID().slice(0, 8)}@example.test`;
  pendientes.emails.push(email);
  return email;
};

/** El camino del último correo a esa dirección, sin el origen: las plantillas usan el `site_url` de Auth y las pruebas otro puerto. */
async function enlaceDelCorreo(email: string, despuesDe = 0): Promise<string> {
  let ruta: string | null = null;
  await expect
    .poll(
      async () => {
        const buscar = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
        const { messages } = (await buscar.json()) as { messages: { ID: string }[] };
        if (messages.length <= despuesDe) return false;
        const mensaje = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { HTML: string };
        const href = /href="([^"]*\/auth\/confirmar[^"]*)"/.exec(mensaje.HTML)?.[1].replaceAll("&amp;", "&");
        if (!href) return false;
        const url = new URL(href);
        ruta = `${url.pathname}${url.search}`;
        return true;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return ruta!;
}

async function pedirRegistro(page: Page, email: string) {
  await page.goto("/registro");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Enviarme el enlace" }).click();
  await expect(page.getByRole("status")).toContainText(email);
}

async function crearLocal(page: Page, nombre: string, slug: string, conClave = true) {
  await expect(page).toHaveURL(/\/crear-local$/);
  await page.getByLabel("Nombre del local").fill(nombre);
  await page.getByLabel("Dirección de tu carta").fill(slug);
  if (conClave) await page.getByLabel("Elegí una contraseña").fill(CLAVE);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Crear mi local" }).click();
}

const orgDe = async (slug: string) => {
  const { data } = await service().from("organizations").select("id").eq("slug", slug).single();
  pendientes.orgs.push(data!.id);
  return data!.id;
};

test.afterAll(async () => {
  const db = service();
  for (const id of pendientes.orgs) await db.from("organizations").delete().eq("id", id);
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data.users) {
    if (user.email && pendientes.emails.includes(user.email)) await db.auth.admin.deleteUser(user.id);
  }
});

test("una persona se registra sola y termina en su panel con Pro por 14 días", async ({ page }) => {
  const email = emailNuevo("alta");
  const slug = `e2e-local-${randomUUID().slice(0, 8)}`;

  await page.goto("/");
  await page.getByRole("link", { name: /Probalo 14 días gratis/ }).first().click();
  await expect(page).toHaveURL(/\/registro$/);
  await expectNoHorizontalOverflow(page);
  await pedirRegistro(page, email);

  await page.goto(await enlaceDelCorreo(email));
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Confirmar" }).click();

  await expectNoHorizontalOverflow(page);
  await crearLocal(page, "Mi Local de Prueba", slug);
  await expect(page).toHaveURL(new RegExp(`/panel/${slug}$`));

  const orgId = await orgDe(slug);
  const sub = (await service().from("subscriptions").select("plan_code, trial_ends_at").eq("organization_id", orgId).single()).data!;
  expect(sub.plan_code).toBe("pro");
  expect(new Date(sub.trial_ends_at!).getTime()).toBeGreaterThan(Date.now() + 13 * 24 * 60 * 60 * 1000);

  // La carta queda pública y la contraseña elegida sirve para volver.
  const carta = await page.request.get(`/m/${slug}/principal`);
  expect(carta.status()).toBe(200);
  await page.getByRole("button", { name: "Salir" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(CLAVE);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(new RegExp(`/panel/${slug}$`));
});

test("abrir el enlace no lo gasta: solo el botón confirma", async ({ page, request }) => {
  const email = emailNuevo("antivirus");
  await pedirRegistro(page, email);
  const enlace = await enlaceDelCorreo(email);

  // Lo que hace un antivirus de correo: pide la página, sin cookies ni clics.
  expect((await request.get(enlace)).status()).toBe(200);

  await page.goto(enlace);
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page).toHaveURL(/\/crear-local$/);
});

test("una contraseña cargada por la API con un email ajeno deja de valer al confirmar el correo", async ({ page, request }) => {
  const email = emailNuevo("ajena");
  const slug = `e2e-local-${randomUUID().slice(0, 8)}`;
  const claveAjena = "contrasena-del-intruso-1";
  const headers = { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", "Content-Type": "application/json" };
  const auth = process.env.NEXT_PUBLIC_SUPABASE_URL;
  expect((await request.post(`${auth}/auth/v1/signup`, { headers, data: { email, password: claveAjena } })).ok()).toBe(true);

  // La dueña real del correo confirma y crea su local.
  await page.goto(await enlaceDelCorreo(email));
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page).toHaveURL(/\/crear-local$/);

  // Recién confirmado, todavía sin local: la contraseña ajena ya no entra. No hay ventana.
  const ingresar = () => request.post(`${auth}/auth/v1/token?grant_type=password`, { headers, data: { email, password: claveAjena } });
  expect((await ingresar()).status()).toBe(400);

  await crearLocal(page, "Local con intruso", slug);
  await expect(page).toHaveURL(new RegExp(`/panel/${slug}$`));
  await orgDe(slug);
  expect((await ingresar()).status()).toBe(400);
});

test("recuperar la contraseña: responde igual exista o no la cuenta y deja elegir una nueva", async ({ page }) => {
  const email = emailNuevo("recupero");
  const creada = await service().auth.admin.createUser({ email, password: "contrasena-vieja-1234", email_confirm: true });
  expect(creada.error).toBeNull();

  const pedir = async (direccion: string) => {
    await page.goto("/recuperar");
    await page.getByLabel("Email").fill(direccion);
    await page.getByRole("button", { name: "Enviarme el enlace" }).click();
    return page.getByRole("status").innerText();
  };
  expect(await pedir(`nadie-${randomUUID().slice(0, 8)}@example.test`)).toBe(await pedir(email));

  await page.goto(await enlaceDelCorreo(email));
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/cuenta\/nueva-contrasena$/);
  await expectNoHorizontalOverflow(page);
  await page.getByLabel("Contraseña nueva").fill(CLAVE);
  await page.getByLabel("Repetí la contraseña").fill(CLAVE);
  await page.getByRole("button", { name: "Guardar y entrar" }).click();
  await expect(page).toHaveURL(/\/crear-local$/);

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill("contrasena-vieja-1234");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByText("Email o contraseña incorrectos.")).toBeVisible();
  await page.getByLabel("Contraseña").fill(CLAVE);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/crear-local$/);
});

test("un enlace usado o manipulado no inicia sesión", async ({ page }) => {
  const email = emailNuevo("usado");
  await pedirRegistro(page, email);
  const enlace = await enlaceDelCorreo(email);
  await page.goto(enlace);
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page).toHaveURL(/\/crear-local$/);

  await page.context().clearCookies();
  await page.goto(enlace);
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText("Este enlace venció o ya se usó.")).toBeVisible();

  await page.goto("/auth/confirmar?token_hash=corto&type=email");
  await expect(page.getByText("Este enlace no es válido.")).toBeVisible();
});

test("quien ya es Dueño no ve el alta y su enlace lo lleva a su panel", async ({ page }) => {
  const email = emailNuevo("dueno");
  const slug = `e2e-local-${randomUUID().slice(0, 8)}`;
  await pedirRegistro(page, email);
  await page.goto(await enlaceDelCorreo(email));
  await page.getByRole("button", { name: "Confirmar" }).click();
  await crearLocal(page, "Primer local", slug);
  await expect(page).toHaveURL(new RegExp(`/panel/${slug}$`));
  await orgDe(slug);

  await page.goto("/crear-local");
  await expect(page).toHaveURL(new RegExp(`/panel/${slug}$`));

  await page.context().clearCookies();
  await page.waitForTimeout(1500); // `max_frequency` local: 1 s entre correos a la misma dirección.
  await pedirRegistro(page, email);
  await page.goto(await enlaceDelCorreo(email, 1));
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page).toHaveURL(new RegExp(`/panel/${slug}$`));
});
