import { expect, test } from "@playwright/test";

// Regresión que solo existe con `pnpm dev`: StrictMode monta, desmonta y vuelve a montar los efectos, y un
// `dialog.close()` en la limpieza cerraba el detalle apenas se abría. El build de producción no duplica efectos,
// así que contra `next start` esta prueba no detectaría nada: se omite salvo que se pida explícitamente.
//   pnpm dev -p 3055   →   E2E_DEV_SERVER=1 E2E_BASE_URL=http://localhost:3055 pnpm exec playwright test e2e/detalle-plato-dev.spec.ts
test.skip(!process.env.E2E_DEV_SERVER, "Requiere un servidor de desarrollo (E2E_DEV_SERVER=1 y E2E_BASE_URL).");

test("el detalle del plato queda abierto en desarrollo, se cierra con Escape y devuelve el foco", async ({ page }) => {
  await page.goto("/m/cafe-ejemplo/centro");
  const trigger = page.getByRole("button", { name: "Ver detalle de Espresso" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Espresso" });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(600); // Un cierre diferido por el evento `close` del primer desmontaje llegaría acá.
  await expect(dialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Volver a la carta" }).click();
  await expect(dialog).toBeHidden();
});
