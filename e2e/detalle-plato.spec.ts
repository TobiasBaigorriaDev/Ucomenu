import { expect, test, type Page } from "@playwright/test";
import { createTenant, service, type Tenant } from "./support";

/**
 * Detalle de un plato en la carta pública (diálogo nativo): en un detalle largo el botón de volver sigue a la vista, el
 * desplazamiento no se contagia a la página de atrás y el teclado conserva Escape, la contención del foco y su devolución.
 * Emulación de un teléfono de 390 px en Chromium: no reemplaza una prueba en un teléfono real ni un lector de pantalla.
 */

const tenants: Tenant[] = [];
test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

/** Un plato con descripción larga y varios grupos de opciones, rodeado de platos para que la página también se desplace. */
async function cartaLarga(label: string) {
  const t = await createTenant(label);
  tenants.push(t);
  const db = service();
  const branch = (await db.from("branches").select("id").eq("organization_id", t.orgId).single()).data!;
  await db.from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
  const cat = (await db.from("categories").insert({ organization_id: t.orgId, name: "Platos", sort_order: 0 }).select("id").single()).data!;
  const platos = Array.from({ length: 25 }, (_, i) => ({
    organization_id: t.orgId,
    category_id: cat.id,
    name: i === 0 ? "Parrillada completa" : `Plato de relleno ${String(i).padStart(2, "0")}`,
    description: i === 0 ? "Un plato muy abundante para compartir. ".repeat(14) : "Relleno",
    price_cents: 1_500_000,
    sort_order: i,
  }));
  const creados = (await db.from("products").insert(platos).select("id, name")).data!;
  const principal = creados.find((p) => p.name === "Parrillada completa")!;
  for (const [g, nombre] of ["Punto de cocción", "Guarnición", "Salsas", "Extras"].entries()) {
    const grupo = (
      await db
        .from("option_groups")
        .insert({ organization_id: t.orgId, product_id: principal.id, name: nombre, min_choices: 0, max_choices: 3, sort_order: g })
        .select("id")
        .single()
    ).data!;
    await db.from("options").insert(
      Array.from({ length: 6 }, (_, i) => ({ organization_id: t.orgId, group_id: grupo.id, name: `${nombre} ${i + 1}`, price_delta_cents: 0, sort_order: i })),
    );
  }
  return { t, branchSlug: "centro", branchId: branch.id as string };
}

const abrir = async (page: Page, slug: string) => {
  await page.goto(`/m/${slug}/centro`);
  const disparador = page.getByRole("button", { name: "Ver detalle de Parrillada completa" });
  await disparador.scrollIntoViewIfNeeded();
  await disparador.click();
  const detalle = page.getByRole("dialog", { name: "Parrillada completa" });
  await expect(detalle).toBeVisible();
  return { detalle, disparador };
};

const volver = (page: Page) => page.getByRole("dialog").getByRole("button", { name: "Volver a la carta" });

test("en un detalle largo el botón de volver sigue a la vista al desplazarse, y cierra", async ({ page }) => {
  const { t } = await cartaLarga("detalle-volver");
  const { detalle, disparador } = await abrir(page, t.slug);
  const { alto, visible } = await detalle.evaluate((el) => ({ alto: el.scrollHeight, visible: el.clientHeight }));
  expect(alto, "el detalle tiene que desbordar para que la prueba valga").toBeGreaterThan(visible + 200);

  await detalle.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(volver(page)).toBeInViewport({ ratio: 1 });
  // Pegado al borde superior del diálogo, no en algún lugar del contenido.
  const dialogo = (await detalle.boundingBox())!;
  const boton = (await volver(page).boundingBox())!;
  expect(boton.y - dialogo.y).toBeLessThan(24);

  await volver(page).click();
  await expect(detalle).not.toBeVisible();
  await expect(disparador).toBeFocused();
});

test("teclado: el foco empieza en «Volver», Tab y Shift+Tab no llegan a la carta de atrás, Enter cierra y Escape también, y el foco vuelve al plato", async ({ page }) => {
  const { t } = await cartaLarga("detalle-teclado");
  const { detalle, disparador } = await abrir(page, t.slug);
  await expect(volver(page)).toBeFocused();

  // Contención nativa del diálogo modal: el resto de la página es inerte, así que el foco nunca cae en la carta de atrás (puede
  // pasar a la interfaz del navegador, en cuyo caso la página no tiene elemento activo).
  const sinSalirALaPagina = () =>
    detalle.evaluate((el) => document.activeElement === null || document.activeElement === document.body || el.contains(document.activeElement));
  for (const tecla of ["Tab", "Tab", "Shift+Tab", "Shift+Tab"]) {
    await page.keyboard.press(tecla);
    expect(await sinSalirALaPagina(), tecla).toBe(true);
  }
  // Con el detalle desplazado hasta el final, «Volver» sigue siendo alcanzable y se activa con el teclado.
  await detalle.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await volver(page).focus();
  await page.keyboard.press("Enter");
  await expect(detalle).not.toBeVisible();
  await expect(disparador).toBeFocused();

  // Escape cierra igual y devuelve el foco.
  await disparador.press("Enter");
  await expect(detalle).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detalle).not.toBeVisible();
  await expect(disparador).toBeFocused();
});

test("el desplazamiento no pasa a la página de atrás (ni al llegar al final del detalle ni con la rueda sobre el fondo) y vuelve al cerrar", async ({ page }) => {
  const { t } = await cartaLarga("detalle-fondo");
  await page.setViewportSize({ width: 1024, height: 700 }); // con ancho de sobra queda fondo visible a los costados
  await page.goto(`/m/${t.slug}/centro`);
  await page.evaluate(() => window.scrollTo(0, 400));
  const antes = await page.evaluate(() => window.scrollY);
  expect(antes).toBeGreaterThan(100);
  await page.getByRole("button", { name: "Ver detalle de Parrillada completa" }).click({ force: true });
  const detalle = page.getByRole("dialog", { name: "Parrillada completa" });
  await expect(detalle).toBeVisible();
  const caja = (await detalle.boundingBox())!;

  // Rueda sobre el detalle, mucho más allá de su final.
  await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 1200);
  expect(await detalle.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(antes);

  // Rueda sobre el fondo oscuro, fuera del detalle.
  await page.mouse.move(20, 300);
  await page.mouse.wheel(0, 800);
  expect(await page.evaluate(() => window.scrollY)).toBe(antes);

  // Al cerrar, la página vuelve a desplazarse.
  await page.keyboard.press("Escape");
  await expect(detalle).not.toBeVisible();
  await page.mouse.move(500, 300);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(antes);
});
