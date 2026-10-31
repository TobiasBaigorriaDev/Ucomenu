import { expect, test } from "@playwright/test";

/**
 * Cabeceras de seguridad y robots.txt (revisión de preparación para producción, hallazgo I3) contra el build y el Supabase local.
 * El sitio de pruebas no es el dominio definitivo, así que el robots.txt pide no indexar nada (igual que staging).
 */
for (const ruta of ["/", "/login", "/terminos", "/m/cafe-ejemplo/centro"]) {
  test(`${ruta} lleva las cabeceras de seguridad y no anuncia el framework`, async ({ request }) => {
    const respuesta = await request.get(ruta);
    expect(respuesta.status()).toBe(200);
    const h = respuesta.headers();
    expect(h["strict-transport-security"]).toBe("max-age=31536000");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("SAMEORIGIN");
    expect(h["content-security-policy"]).toBe("frame-ancestors 'self'");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toContain("geolocation=()");
    expect(h["x-powered-by"]).toBeUndefined();
  });
}

test("el robots.txt de un sitio que no es el definitivo no deja indexar nada", async ({ request }) => {
  const respuesta = await request.get("/robots.txt");
  expect(respuesta.status()).toBe(200);
  const texto = await respuesta.text();
  expect(texto).toContain("User-Agent: *");
  expect(texto).toContain("Disallow: /");
  expect(texto).not.toContain("Allow: /\n");
});

test("la carta, el panel y la sala siguen funcionando con las cabeceras (la app no usa iframes)", async ({ page }) => {
  await page.goto("/m/cafe-ejemplo/centro");
  await expect(page.locator("main")).toBeVisible();
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /ingresar/i }).first()).toBeVisible();
});
