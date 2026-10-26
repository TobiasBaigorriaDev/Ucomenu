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

test("la política de privacidad explica los comentarios: aprobación previa, plazos de borrado y que no guarda nada en el dispositivo", async ({ page }) => {
  await page.goto("/privacidad");
  await expect(page.getByText("no se publica hasta que el local lo aprueba")).toBeVisible();
  await expect(page.getByText(/Los comentarios rechazados se borran a los\s+7\s+días y los que nadie revisa, a los\s+30\s+días/)).toBeVisible();
  await expect(page.getByText("No escribas datos personales tuyos ni de otras personas")).toBeVisible();
  await expect(page.getByText("No guardamos la mesa ni nada en tu dispositivo")).toBeVisible();
});

test("los términos fijan las reglas de los comentarios para comensales y locales", async ({ page }) => {
  await page.goto("/terminos");
  await expect(page.getByText("no se publica hasta que el local lo aprueba")).toBeVisible();
  await expect(page.getByText("Sos responsable de lo que escribís")).toBeVisible();
  await expect(page.getByText("Sos responsable de lo que aprobás")).toBeVisible();
  await expect(page.getByText(/lo que aprueba como comentario/)).toBeVisible();
});

test("los términos no eximen de forma absoluta ni dan prioridad al personal sobre la carta", async ({ page }) => {
  await page.goto("/terminos");
  const body = page.locator("main");
  // Antes: «UcoMenu no es responsable por … la información de alérgenos» y «vale lo que te informe el personal».
  await expect(body).not.toContainText("no es responsable por el contenido");
  await expect(body).not.toContainText("información de alérgenos que el local brinde");
  await expect(body).not.toContainText("vale lo que te informe el personal");
  await expect(body).toContainText("no limitan los derechos que la ley te reconoce como consumidor");
  await expect(body).toContainText("Responde por los daños que causen sus propios incumplimientos y fallas técnicas");
  await expect(body).toContainText("Tenés que mantener actualizados los ingredientes, los precios y las etiquetas dietarias");
  await expect(body.getByRole("heading", { name: "7. Reportar información incorrecta o riesgosa" })).toBeVisible();
});

test("el aviso de alérgenos no promete información que la carta no tiene", async ({ page }) => {
  await page.goto("/alergenos");
  const body = page.locator("main");
  await expect(body).toContainText("no muestra los ingredientes ni los alérgenos de cada plato");
  await expect(body).toContainText("Un plato sin etiqueta no está declarado como apto");
  await expect(body).toContainText("Contaminación cruzada");
  await expect(body).toContainText("Variantes y adicionales");
  await expect(body).toContainText("consultale por el plato");
});

test("la privacidad nombra al responsable, el canal y los plazos de la ley, y marca a la vista lo que falta decidir", async ({ page }) => {
  await page.goto("/privacidad");
  const body = page.locator("main");
  await expect(body.getByRole("heading", { name: "1. Quién es el responsable y cómo contactarlo" })).toBeVisible();
  await expect(body).toContainText("10 días corridos");
  await expect(body).toContainText("5 días hábiles");
  await expect(body).toContainText("Supabase");
  await expect(body).toContainText("Fly.io");
  // Mientras el usuario no decida razón social, CUIT, domicilio y correo, el texto lo muestra como pendiente (no los inventa).
  expect(await page.getByTestId("pendiente-legal").count()).toBeGreaterThan(0);
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
