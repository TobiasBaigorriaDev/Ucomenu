import { expect, test } from "@playwright/test";

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
    // Sin la medida de `expectNoHorizontalOverflow` (da falsos aprobados en móvil): ningún elemento pasa del ancho.
    const derecha = await page.evaluate(() =>
      Math.max(...[...document.querySelectorAll("main, main *")].map((el) => el.getBoundingClientRect().right)),
    );
    expect(derecha).toBeLessThanOrEqual((page.viewportSize()?.width ?? 390) + 0.5);
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
