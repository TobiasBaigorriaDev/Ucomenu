import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support";

/**
 * Textos legales (ficha textos-legales): las tres páginas son públicas, se llega a ellas desde la portada, el login y la
 * carta, caben en 390 px y la carta no deja cookies (lo que afirma la política de privacidad).
 */

const PAGES = [
  { path: "/terminos", heading: "Términos de uso", link: "Términos de uso" },
  { path: "/privacidad", heading: "Política de privacidad", link: "Privacidad" },
  { path: "/alergenos", heading: "Aviso de alérgenos", link: "Aviso de alérgenos" },
] as const;

for (const { path, heading } of PAGES) {
  test(`${path} es pública, tiene su título y cabe en el teléfono`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.getByText(/Actualizado el \d{1,2} de \w+ de \d{4}/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

test("la política de privacidad dice los 14 días y que el identificador no es la IP", async ({ page }) => {
  await page.goto("/privacidad");
  await expect(page.getByText("se borran automáticamente a los 14 días")).toBeVisible();
  await expect(page.getByText("No guardamos tu IP")).toBeVisible();
});

for (const [origen, ruta] of [
  ["la portada", "/"],
  ["el login", "/login"],
  ["la carta pública", "/m/cafe-ejemplo/centro"],
] as const) {
  test(`desde ${origen} se llega a los tres textos`, async ({ page }) => {
    await page.goto(ruta);
    const nav = page.getByRole("navigation", { name: "Información legal" });
    for (const { link, path } of PAGES) {
      await expect(nav.getByRole("link", { name: link })).toHaveAttribute("href", path);
    }
    await nav.getByRole("link", { name: "Aviso de alérgenos" }).click();
    await expect(page).toHaveURL(/\/alergenos$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aviso de alérgenos");
  });
}

test("la carta pública no guarda cookies ni datos locales (como dice la política de privacidad)", async ({ page, context }) => {
  await page.goto("/m/cafe-ejemplo/centro");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Café Ejemplo");
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => window.localStorage.length + window.sessionStorage.length)).toBe(0);
});

test.describe("volver desde los textos legales", () => {
  test("desde la carta se vuelve con un solo toque, aun después de pasar por otro texto, sin guardar nada ni agregar parámetros", async ({ page, context }) => {
    await page.goto("/m/cafe-ejemplo/centro");
    await page.getByRole("navigation", { name: "Información legal" }).getByRole("link", { name: "Términos de uso" }).click();
    await expect(page).toHaveURL(/\/terminos$/);
    await expect(page.getByRole("button", { name: "Volver" }).first()).toBeVisible();

    // Entre textos legales el historial no se apila: un «Volver» sale de todos ellos.
    await page.getByRole("navigation", { name: "Información legal" }).getByRole("link", { name: "Privacidad" }).click();
    await expect(page).toHaveURL(/\/privacidad$/);
    expect(new URL(page.url()).search).toBe("");
    await page.getByRole("button", { name: "Volver" }).first().click();

    await expect(page).toHaveURL(/\/m\/cafe-ejemplo\/centro$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Café Ejemplo");
    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(() => window.localStorage.length + window.sessionStorage.length)).toBe(0);
  });

  test("el «Volver» del final del texto también funciona", async ({ page }) => {
    await page.goto("/m/cafe-ejemplo/centro");
    await page.getByRole("navigation", { name: "Información legal" }).getByRole("link", { name: "Aviso de alérgenos" }).click();
    await page.getByRole("button", { name: "Volver" }).last().click();
    await expect(page).toHaveURL(/\/m\/cafe-ejemplo\/centro$/);
  });

  test("con acceso directo no hay a dónde volver: se ofrece ir a la portada, que es una dirección fija", async ({ page }) => {
    await page.goto("/privacidad");
    await expect(page.getByRole("button", { name: "Volver" })).toHaveCount(0);
    const portada = page.getByRole("link", { name: "Ir a la portada" }).first();
    await expect(portada).toHaveAttribute("href", "/");
    await portada.click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("desde el login también se vuelve; a 390 px no desborda", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("navigation", { name: "Información legal" }).getByRole("link", { name: "Términos de uso" }).click();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Volver" }).first().click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
