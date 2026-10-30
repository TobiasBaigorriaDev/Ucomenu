import { expect, test } from "@playwright/test";

test("las características aparecen una sola vez al entrar y siguen utilizables", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this.matches(".mk-bento > .mk-cell")) this.setAttribute("data-animaciones-test", String(Number(this.getAttribute("data-animaciones-test") || 0) + 1));
      return original.apply(this, args);
    };
  });
  await page.goto("/");
  const bloque = page.locator(".mk-bento > .mk-cell").first();
  await expect(bloque).not.toHaveAttribute("data-animaciones-test");
  await bloque.scrollIntoViewIfNeeded();
  await expect(bloque).toHaveAttribute("data-animaciones-test", "1");
  await expect(bloque.getByRole("heading", { name: "Pedidos que anota el mozo" })).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await bloque.scrollIntoViewIfNeeded();
  await expect(bloque).toHaveAttribute("data-animaciones-test", "1");
  await page.screenshot({ path: "output/ux/aparicion-movil.png" });
});

test("movimiento reducido: los bloques permanecen visibles sin animación", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const bloque = page.locator(".mk-bento > .mk-cell").first();
  await bloque.scrollIntoViewIfNeeded();
  await expect(bloque).toBeVisible();
  expect(await bloque.evaluate((el) => el.getAnimations().length)).toBe(0);
});

test("sin JavaScript el contenido de la portada sigue visible", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto("/");
  const bloque = page.locator(".mk-bento > .mk-cell").first();
  await bloque.scrollIntoViewIfNeeded();
  await expect(bloque).toBeVisible();
  await page.screenshot({ path: "output/ux/aparicion-escritorio.png" });
  await context.close();
});
