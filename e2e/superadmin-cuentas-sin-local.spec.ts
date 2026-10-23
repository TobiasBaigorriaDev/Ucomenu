import { expect, test, type Page } from "@playwright/test";
import { purgeAuditLogWhere } from "../tests/rls/purge-price-history";
import { SEED_PASSWORD, alerta, expectNoHorizontalOverflow, login, service } from "./support";
import { sql } from "../tests/rls/helpers"; // después de ./support: este carga las variables de entorno

/**
 * SuperAdmin: cuentas de Auth sin ningún local (nivel C, ficha cuentas-sin-local), contra el build y el Supabase local, a 390 px.
 * La cuenta de prueba se crea sin local y se envejece (la lista deja afuera las de menos de una hora).
 */

const ADMIN_EMAIL = "admin@ucomenu.test";
const MOTIVO = "tt-csl-e2e limpieza";
const item = (page: Page, email: string) => page.getByTestId("cuenta-sin-local").filter({ hasText: email });

async function cuentaSinLocal(label: string) {
  const email = `csl-e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@ucomenu.test`;
  const { data, error } = await service().auth.admin.createUser({ email, password: "contrasena-de-prueba-123", email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear la cuenta de prueba: ${error?.message}`);
  sql(`update auth.users set created_at = now() - interval '2 hours' where id = '${data.user.id}'`);
  return { id: data.user.id, email };
}

test.afterAll(() => {
  purgeAuditLogWhere(`action = 'account.deleted' and after->>'reason' like 'tt-csl-e2e%'`);
});

test.describe("cuentas sin local", () => {
  test("la lista muestra la cuenta, pide el email y el motivo, y al confirmar la borra y lo deja en los movimientos", async ({ page }) => {
    const cuenta = await cuentaSinLocal("borrar");
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, "/admin");
      await page.getByRole("link", { name: "Cuentas sin local" }).click();
      await expect(page).toHaveURL(/\/admin\/cuentas$/);
      await expectNoHorizontalOverflow(page);

      const fila = item(page, cuenta.email);
      await expect(fila).toBeVisible();
      await fila.getByText("Borrar esta cuenta").click();
      const form = fila.locator("form");
      await expectNoHorizontalOverflow(page);

      // El email equivocado no borra nada y conserva lo escrito.
      await form.getByLabel(/Escribí el email/).fill("otra@ucomenu.test");
      await form.getByLabel("Motivo del borrado").fill(MOTIVO);
      await form.getByRole("checkbox").check();
      await form.getByRole("button", { name: "Borrar la cuenta" }).click();
      await expect(alerta(page)).toContainText("no coincide con el de la cuenta");
      await expect(form.getByLabel("Motivo del borrado")).toHaveValue(MOTIVO);
      expect((await service().auth.admin.getUserById(cuenta.id)).data.user).not.toBeNull();

      // Con el email correcto se borra, vuelve a la lista con el aviso y la cuenta ya no está.
      await form.getByLabel(/Escribí el email/).fill(cuenta.email);
      await form.getByRole("checkbox").check();
      await form.getByRole("button", { name: "Borrar la cuenta" }).click();
      await expect(page.getByTestId("aviso-cuenta-borrada")).toContainText("la cuenta se borró");
      await expect(item(page, cuenta.email)).toHaveCount(0);
      expect((await service().auth.admin.getUserById(cuenta.id)).data.user).toBeNull();

      // Quedó en los movimientos, con el id y sin el email.
      await page.goto("/admin");
      const movimiento = page.getByTestId("auditoria").filter({ hasText: "Cuenta sin local borrada" }).first();
      await expect(movimiento).toContainText(`cuenta ${cuenta.id}`);
      await expect(movimiento).toContainText(MOTIVO);
      await expect(page.getByTestId("auditoria").filter({ hasText: cuenta.email })).toHaveCount(0);
    } finally {
      await service().auth.admin.deleteUser(cuenta.id);
    }
  });

  test("las cuentas de menos de una hora y las que tienen local no aparecen", async ({ page }) => {
    const nueva = await cuentaSinLocal("nueva");
    sql(`update auth.users set created_at = now() where id = '${nueva.id}'`);
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, "/admin/cuentas");
      await expect(page.getByRole("heading", { name: "Cuentas sin local" })).toBeVisible();
      await expect(item(page, nueva.email)).toHaveCount(0);
      // El Dueño sembrado tiene local: nunca figura como cuenta sin local.
      await expect(item(page, "dueno@cafe-ejemplo.test")).toHaveCount(0);
    } finally {
      await service().auth.admin.deleteUser(nueva.id);
    }
  });

  test("quien no es SuperAdmin no entra a la pantalla", async ({ page }) => {
    await login(page, "dueno@cafe-ejemplo.test", SEED_PASSWORD);
    const respuesta = await page.goto("/admin/cuentas");
    expect(respuesta?.status()).toBe(404);
  });
});
