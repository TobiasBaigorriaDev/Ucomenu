import { expect, test } from "@playwright/test";

test("el abanico móvil recorre las cinco cartas cada tres segundos y vuelve al inicio", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await page.goto("/");
  const fan = page.locator(".mk-fan");
  await fan.scrollIntoViewIfNeeded();
  const centro = fan.locator('[data-position="centro"] img');
  // El observador de visibilidad se activa de forma asíncrona tras el desplazamiento.
  await page.clock.runFor(1000);
  await page.waitForTimeout(100);
  await page.screenshot({ path: "output/ux/hero-rotacion-movil.png" });
  const nombres = [];
  for (let i = 0; i < 5; i++) {
    nombres.push(await centro.getAttribute("alt"));
    await page.clock.runFor(3000);
  }
  expect(new Set(nombres).size).toBe(5);
  await expect(centro).toHaveAttribute("alt", nombres[0]!);
  await expect(page.getByRole("button", { name: /animación/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("footer").scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const cartaAlSalir = await centro.getAttribute("alt");
  await page.clock.runFor(12000);
  await expect(centro).toHaveAttribute("alt", cartaAlSalir!);
});

for (const caso of [{ name: "escritorio", width: 1440, reduced: false }, { name: "movimiento reducido", width: 390, reduced: true }]) {
  test(`${caso.name}: el abanico permanece quieto`, async ({ page }) => {
    await page.setViewportSize({ width: caso.width, height: 844 });
    if (caso.reduced) await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install();
    await page.goto("/");
    await page.locator(".mk-fan").scrollIntoViewIfNeeded();
    if (!caso.reduced) {
      await expect(page.locator(".mk-fan .mk-phone:visible")).toHaveCount(5);
    }
    if (!caso.reduced) await page.screenshot({ path: "output/ux/hero-rotacion-escritorio.png" });
    await page.clock.runFor(12000);
    await expect(page.locator('[data-position="centro"] img')).toHaveAttribute("alt", /Bruma Bistró/);
    await expect(page.getByRole("button", { name: /animación/ })).toHaveCount(0);
  });
}
