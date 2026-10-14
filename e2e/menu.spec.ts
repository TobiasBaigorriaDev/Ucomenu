import { expect, test } from "@playwright/test";

const MENU = "/m/cafe-ejemplo/centro";

test.describe("carta pública de Café Ejemplo (390 px)", () => {
  test("muestra las categorías en orden y cada plato con nombre, descripción y precio", async ({ page }) => {
    const response = await page.goto(MENU);
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Café Ejemplo");
    await expect(page.getByText("Sucursal Centro")).toBeVisible();

    const categories = page.getByRole("heading", { level: 2 });
    await expect(categories).toHaveText(["Cafetería", "Pastelería"]);

    const dishes = page.getByRole("heading", { level: 3 });
    await expect(dishes).toHaveText(["Espresso", "Flat white", "Medialuna de manteca"]);

    // Precios en ARS, formato es-AR (el espacio puede ser duro: \s lo cubre).
    await expect(page.getByText(/^\$\s2\.800$/)).toBeVisible();
    await expect(page.getByText(/^\$\s4\.200$/)).toBeVisible();
    await expect(page.getByText(/^\$\s1\.500$/)).toBeVisible();

    await expect(page.getByText("Blend de la casa, tostado medio.")).toBeVisible();
  });

  test("no se desborda horizontalmente", async ({ page }) => {
    await page.goto(MENU);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("no publica lo inactivo ni lo de otras organizaciones", async ({ page }) => {
    await page.goto(MENU);
    const body = page.locator("body");

    await expect(body).not.toContainText("Cold brew"); // plato inactivo
    await expect(body).not.toContainText("Temporada"); // categoría inactiva
    await expect(body).not.toContainText("Helado de maracuyá"); // plato activo en categoría inactiva
    await expect(body).not.toContainText("Entraña"); // otra organización
    await expect(body).not.toContainText("Fernet"); // organización inactiva
  });

  test("la navegación por categorías lleva a la sección", async ({ page }) => {
    await page.goto(MENU);

    await page.getByRole("navigation", { name: "Categorías de la carta" }).getByRole("link", { name: "Pastelería" }).click();

    await expect(page.getByRole("heading", { level: 2, name: "Pastelería" })).toBeInViewport();
  });

  test("es accesible por teclado: el primer Tab llega a los enlaces de categorías", async ({ page }) => {
    await page.goto(MENU);

    await page.keyboard.press("Tab");
    const first = page.getByRole("navigation", { name: "Categorías de la carta" }).getByRole("link").first();
    await expect(first).toBeFocused();
  });
});

test.describe("otra organización", () => {
  test("la carta de Parrilla Demo no mezcla platos de Café Ejemplo", async ({ page }) => {
    await page.goto("/m/parrilla-demo/sur");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Parrilla Demo");
    await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Entraña", "Provoleta"]);
    await expect(page.locator("body")).not.toContainText("Espresso");
  });
});

test.describe("cuenta suspendida por mora", () => {
  test("muestra «Carta temporalmente no disponible» y no publica ningún plato", async ({ page }) => {
    const response = await page.goto("/m/resto-moroso/unica");

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resto Moroso");
    await expect(page.getByText("Carta temporalmente no disponible")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Milanesa completa");
    await expect(page.locator("body")).not.toContainText("Minutas");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("no se desborda horizontalmente", async ({ page }) => {
    await page.goto("/m/resto-moroso/unica");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("rutas que no existen", () => {
  for (const [label, path] of [
    ["organización inexistente", "/m/no-existe/centro"],
    ["sucursal inexistente", "/m/cafe-ejemplo/no-existe"],
    ["sucursal de otra organización", "/m/cafe-ejemplo/sur"],
    ["organización inactiva", "/m/bar-inactivo/unica"],
    ["slug con caracteres inválidos", "/m/CAFE_ejemplo/centro"],
    ["slug de 65 caracteres", `/m/${"a".repeat(65)}/centro`],
    ["sucursal inexistente en una organización suspendida", "/m/resto-moroso/no-existe"],
    ["sucursal de otra organización en una organización suspendida", "/m/resto-moroso/centro"],
  ] as const) {
    test(`responde 404 para ${label}`, async ({ page }) => {
      const response = await page.goto(path);

      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("No encontramos esta carta");
    });
  }
});
