import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { createTenant, deleteAccountsByEmail, login, service, TEST_PASSWORD, type Tenant } from "./support";

/**
 * Cuentas que crea un Dueño (nivel C, ficha cuentas-creadas-por-duenos) de punta a punta contra el build, el Supabase local y su buzón de
 * prueba (Mailpit): entrar con la contraseña del Dueño no prueba el correo; entrar por el enlace del correo reemplaza esa contraseña y deja
 * a la persona elegir la suya. Google no se prueba acá (necesita una cuenta real): se comprueba en staging.
 */

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const NUEVA = "la-clave-de-la-persona-2026";
const emails: string[] = [];
let tenant: Tenant;

const anon = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const puedeEntrar = async (email: string, password: string) => (await anon().auth.signInWithPassword({ email, password })).error === null;

/** Lo que hace `createMember`: cuenta con el email «confirmado», la contraseña del Dueño y la marca. */
async function cuentaDelDueno() {
  const email = `e2e-cd-${randomUUID().slice(0, 8)}@example.test`;
  emails.push(email);
  const creada = await service().auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    app_metadata: { mailbox: "unverified" },
  });
  if (creada.error || !creada.data.user) throw new Error(`No se pudo crear ${email}: ${creada.error?.message}`);
  const membresia = await service().from("memberships").insert({ user_id: creada.data.user.id, organization_id: tenant.orgId, role: "staff" });
  if (membresia.error) throw new Error(membresia.error.message);
  return { id: creada.data.user.id, email };
}

const marca = async (id: string) => ((await service().auth.admin.getUserById(id)).data.user?.app_metadata as { mailbox?: string }).mailbox;

async function enlaceDelCorreo(email: string): Promise<string> {
  let ruta: string | null = null;
  await expect
    .poll(
      async () => {
        const buscar = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
        const { messages } = (await buscar.json()) as { messages: { ID: string }[] };
        if (messages.length === 0) return false;
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

test.beforeAll(async () => {
  tenant = await createTenant("cd");
});

test.afterAll(async () => {
  await deleteAccountsByEmail(emails);
  await tenant.cleanup();
});

test("entrar con la contraseña del Dueño no prueba el correo: la marca y la contraseña siguen", async ({ page }) => {
  const cuenta = await cuentaDelDueno();
  await login(page, cuenta.email, TEST_PASSWORD);
  await expect(page).not.toHaveURL(/\/login/);
  expect(await marca(cuenta.id)).toBe("unverified");
  expect(await puedeEntrar(cuenta.email, TEST_PASSWORD)).toBe(true);
});

test("la persona que prueba su correo con un enlace reemplaza la contraseña del Dueño y elige la suya", async ({ page }) => {
  const cuenta = await cuentaDelDueno();
  expect(await puedeEntrar(cuenta.email, TEST_PASSWORD)).toBe(true); // antes: la sabe el Dueño

  await page.goto("/registro");
  await page.getByLabel("Email").fill(cuenta.email);
  await page.getByRole("button", { name: "Enviarme el enlace" }).click();
  await expect(page.getByRole("status")).toContainText(cuenta.email);

  await page.goto(await enlaceDelCorreo(cuenta.email));
  await page.getByRole("button", { name: "Confirmar" }).click();

  // Probó su correo: va a elegir su contraseña y la del Dueño ya no sirve.
  await expect(page).toHaveURL(/\/cuenta\/nueva-contrasena$/);
  expect(await marca(cuenta.id)).toBe("verified");
  expect(await puedeEntrar(cuenta.email, TEST_PASSWORD)).toBe(false);

  await page.getByLabel("Contraseña nueva").fill(NUEVA);
  await page.getByLabel("Repetí la contraseña").fill(NUEVA);
  await page.getByRole("button", { name: "Guardar y entrar" }).click();
  await expect(page).not.toHaveURL(/nueva-contrasena/);
  expect(await puedeEntrar(cuenta.email, NUEVA)).toBe(true);
  expect(await puedeEntrar(cuenta.email, TEST_PASSWORD)).toBe(false);
});
