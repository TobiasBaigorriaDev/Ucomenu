import { expect, test, type Locator, type Page } from "@playwright/test";
import { purgeAuditLogWhere } from "../tests/rls/purge-price-history";
import { SEED_PASSWORD, createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";

/**
 * SuperAdmin suma una cuenta existente como Dueño (nivel C, ficha dueno-existente), contra el build y el Supabase local,
 * a 390 px. Cada prueba arma dos locales propios (`createTenant`): la cuenta viene del primero y se suma al segundo.
 */

const ADMIN_EMAIL = "admin@ucomenu.test";
const detalle = (slug: string) => `/admin/organizaciones/${slug}`;
const tenants: Tenant[] = [];

test.afterAll(async () => {
  for (const t of tenants) purgeAuditLogWhere(`organization_id = '${t.orgId}'`);
  for (const t of tenants) await t.cleanup();
});

async function dosLocales(label: string) {
  const a = await createTenant(`${label}-a`);
  const b = await createTenant(`${label}-b`);
  tenants.push(a, b);
  return { a, b };
}

const membresia = async (orgId: string, userId: string) =>
  (await service().from("memberships").select("role").eq("organization_id", orgId).eq("user_id", userId).maybeSingle()).data?.role ?? null;

/** La sección «Sumar un Dueño» (el formulario del email). */
const formulario = (page: Page) => page.locator("form").filter({ has: page.getByLabel("Email de la cuenta") });

test.describe("sumar un Dueño existente", () => {
  test("busca la cuenta, muestra dónde trabaja, pide confirmar y recién entonces la suma", async ({ page }) => {
    const { a, b } = await dosLocales("dex-flujo");
    await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(b.slug));
    await expect(page.getByRole("heading", { name: "Sumar un Dueño", level: 2 })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const form = formulario(page);
    await form.getByLabel("Email de la cuenta").fill(a.owner.email);
    await form.getByRole("button", { name: "Buscar cuenta" }).click();

    // Paso 2: dónde trabaja la cuenta, el aviso y la casilla. Todavía no se escribió nada.
    await expect(form.getByRole("status")).toContainText(`Encontramos la cuenta ${a.owner.email}`);
    await expect(form.getByRole("status")).toContainText(`«${a.name}» (Dueño)`);
    await expect(form.getByTestId("aviso-dueno-existente")).toContainText("Confirmá solo si es la misma persona");
    await expect(form.getByLabel("Email de la cuenta")).toHaveAttribute("readonly", "");
    expect(await membresia(b.orgId, a.owner.id)).toBeNull();
    await expectNoHorizontalOverflow(page);

    // Sin la casilla el navegador no deja enviar.
    await form.getByRole("button", { name: "Sumar como Dueño" }).click();
    expect(await membresia(b.orgId, a.owner.id)).toBeNull();

    await form.getByRole("checkbox").check();
    await form.getByRole("button", { name: "Sumar como Dueño" }).click();
    await expect(form.getByRole("status")).toContainText("ahora es Dueño de esta organización");

    expect(await membresia(b.orgId, a.owner.id)).toBe("owner");
    expect(await membresia(a.orgId, a.owner.id)).toBe("owner");

    // Queda en los movimientos y el encabezado lista al Dueño nuevo.
    await page.reload();
    await expect(page.getByTestId("auditoria").filter({ hasText: "Dueño sumado" })).toHaveCount(1);
    const encabezado = page.locator("p", { hasText: "Dueño:" }).first();
    await expect(encabezado).toContainText(b.owner.email);
    await expect(encabezado).toContainText(a.owner.email);
    await expectNoHorizontalOverflow(page);
  });

  test("el hallazgo se ve ANTES de la casilla y del botón que confirma; «Cancelar» vuelve a buscar sin escribir nada ni recargar", async ({ page }) => {
    const { a, b } = await dosLocales("dex-cancelar");
    const otra = await createTenant("dex-cancelar-c");
    tenants.push(otra);
    await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(b.slug));
    const form = formulario(page);
    const antes = (await service().from("audit_log").select("id").eq("organization_id", b.orgId)).data?.length ?? 0;

    await form.getByLabel("Email de la cuenta").fill(a.owner.email);
    await form.getByRole("button", { name: "Buscar cuenta" }).click();

    // La cuenta y dónde trabaja están arriba de la casilla y del botón de confirmar (orden de lectura y visual).
    const hallazgo = form.getByTestId("cuenta-encontrada");
    await expect(hallazgo).toContainText(`Encontramos la cuenta ${a.owner.email}`);
    await expect(hallazgo).toContainText(`«${a.name}» (Dueño)`);
    const casilla = form.getByRole("checkbox");
    const confirmar = form.getByRole("button", { name: "Sumar como Dueño" });
    const y = async (l: Locator) => (await l.boundingBox())!.y;
    expect(await y(hallazgo)).toBeLessThan(await y(casilla));
    expect(await y(casilla)).toBeLessThan(await y(confirmar));
    await expect(form.getByRole("status")).toHaveCount(1); // un solo anuncio

    // Cancelar: no hay ninguna llamada al servidor ni recarga; el email se puede cambiar y la casilla desaparece.
    const marca = await page.evaluate(() => ((window as unknown as { __marca?: number }).__marca = Date.now()));
    await form.getByRole("button", { name: "Cancelar y cambiar el email" }).click();
    await expect(casilla).toHaveCount(0);
    await expect(hallazgo).toHaveCount(0);
    await expect(form.getByRole("button", { name: "Buscar cuenta" })).toBeVisible();
    const email = form.getByLabel("Email de la cuenta");
    await expect(email).not.toHaveAttribute("readonly", "");
    await expect(email).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as { __marca?: number }).__marca)).toBe(marca); // misma página, sin recargar
    expect(await membresia(b.orgId, a.owner.id)).toBeNull();
    expect((await service().from("audit_log").select("id").eq("organization_id", b.orgId)).data?.length ?? 0).toBe(antes);

    // Cambiar el email y buscar otra cuenta: el hallazgo es de la nueva, y confirmar suma a ESA cuenta.
    await email.fill(otra.owner.email);
    await form.getByRole("button", { name: "Buscar cuenta" }).click();
    await expect(form.getByTestId("cuenta-encontrada")).toContainText(`Encontramos la cuenta ${otra.owner.email}`);
    await expect(form.getByTestId("cuenta-encontrada")).not.toContainText(a.owner.email);
    await form.getByRole("checkbox").check();
    await form.getByRole("button", { name: "Sumar como Dueño" }).click();
    await expect(form.getByRole("status")).toContainText("ahora es Dueño de esta organización");
    expect(await membresia(b.orgId, otra.owner.id)).toBe("owner");
    expect(await membresia(b.orgId, a.owner.id)).toBeNull();
  });

  test("una cuenta que no existe se dice con claridad y no crea nada", async ({ page }) => {
    const { b } = await dosLocales("dex-sin-cuenta");
    await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(b.slug));
    const form = formulario(page);
    await form.getByLabel("Email de la cuenta").fill(`no-existe-${Date.now()}@example.test`);
    await form.getByRole("button", { name: "Buscar cuenta" }).click();
    await expect(form.getByRole("alert")).toContainText("No hay ninguna cuenta con ese email");
    await expect(form.getByRole("checkbox")).toHaveCount(0);
  });

  test("si la cuenta ya es Dueño de esa organización, lo dice y no cambia nada", async ({ page }) => {
    const { b } = await dosLocales("dex-ya-dueno");
    await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(b.slug));
    const form = formulario(page);
    await form.getByLabel("Email de la cuenta").fill(b.owner.email);
    await form.getByRole("button", { name: "Buscar cuenta" }).click();
    await expect(form.getByRole("alert")).toContainText("ya es Dueño de esta organización");
  });

  test("el Personal de la propia organización se asciende a Dueño", async ({ page }) => {
    const { b } = await dosLocales("dex-ascenso");
    await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(b.slug));
    const form = formulario(page);
    await form.getByLabel("Email de la cuenta").fill(b.staff.email);
    await form.getByRole("button", { name: "Buscar cuenta" }).click();
    await expect(form.getByRole("status")).toContainText("Ya es Personal de esta organización");
    await form.getByRole("checkbox").check();
    await form.getByRole("button", { name: "Sumar como Dueño" }).click();
    await expect(form.getByRole("status")).toContainText("ahora es Dueño");
    expect(await membresia(b.orgId, b.staff.id)).toBe("owner");
  });

  test("el Dueño y el Personal no ven la pantalla de SuperAdmin", async ({ page }) => {
    const { b } = await dosLocales("dex-acceso");
    for (const persona of [b.owner, b.staff]) {
      await login(page, persona.email, persona.password, "/panel");
      const respuesta = await page.goto(detalle(b.slug));
      expect(respuesta?.status()).toBe(404);
      await expect(page.getByLabel("Email de la cuenta")).toHaveCount(0);
      await page.goto("/panel");
      await page.getByRole("button", { name: "Salir" }).click();
    }
  });
});
