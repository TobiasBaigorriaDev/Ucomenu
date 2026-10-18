import { expect, test, type BrowserContext } from "@playwright/test";
import { conPushDoble } from "./push-doble";
import { createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";

/**
 * Aviso en iPhone y iPad (ficha aviso-push-iphone): la sala y el panel se pueden instalar como app (manifiesto + ícono) y,
 * en una pestaña de Safari, el bloque explica cómo instalarla en vez de ofrecer un botón que no funcionaría. Apple no se
 * puede probar de punta a punta desde acá (hace falta un iPhone real con la app instalada): se simula el entorno.
 */

const tenants: Tenant[] = [];

async function nuevoLocal(label: string) {
  const t = await createTenant(label, "active");
  tenants.push(t);
  await service().from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
  return t;
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** Safari en una pestaña: sin `PushManager` (Apple solo lo expone a la app instalada). */
async function comoSafariDeIphone(context: BrowserContext, opciones: { instalada?: boolean } = {}) {
  await context.addInitScript((instalada) => {
    delete (window as unknown as Record<string, unknown>).PushManager;
    if (instalada) Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
  }, opciones.instalada === true);
}

test.describe("app instalable", () => {
  test("la sala y el panel enlazan el manifiesto y el ícono de iOS; la carta, el login y la mesa no", async ({ browser, request }) => {
    const t = await nuevoLocal("iphone-manifiesto");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();

    await page.goto("/login");
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);

    await login(page, t.owner.email, t.owner.password);
    for (const ruta of [`/sala/${t.slug}`, `/panel/${t.slug}`, "/sala", "/panel"]) {
      await page.goto(ruta);
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/sala.webmanifest");
      await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/apple-touch-icon.png");
      await expect(page.locator('meta[name="mobile-web-app-capable"], meta[name="apple-mobile-web-app-capable"]').first()).toHaveAttribute("content", "yes");
    }

    const mesa = await service().from("tables").select("qr_token").eq("organization_id", t.orgId).limit(1);
    if (mesa.data?.[0]) {
      await page.goto(`/t/${mesa.data[0].qr_token}`);
      await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
    }
    await context.close();

    // El manifiesto es JSON válido y todos los íconos existen como PNG.
    const respuesta = await request.get("/sala.webmanifest");
    expect(respuesta.status()).toBe(200);
    const manifiesto = await respuesta.json();
    expect(manifiesto).toMatchObject({ display: "standalone", start_url: "/sala", scope: "/" });
    expect(manifiesto.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifiesto.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
    for (const src of [...manifiesto.icons.map((i: { src: string }) => i.src), "/icons/apple-touch-icon.png"]) {
      const icono = await request.get(src);
      expect(icono.status(), src).toBe(200);
      expect(icono.headers()["content-type"], src).toContain("image/png");
    }
  });
});

test.describe("iPhone y iPad", () => {
  for (const [donde, ruta, texto] of [
    ["la sala", (t: Tenant) => `/sala/${t.slug}`, "la sala"],
    ["el Resumen del panel", (t: Tenant) => `/panel/${t.slug}`, "el panel"],
  ] as const) {
    test(`en Safari (sin instalar), ${donde} explica cómo instalar la app y no ofrece activar`, async ({ browser }) => {
      const t = await nuevoLocal("iphone-instalar");
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA, hasTouch: true });
      await comoSafariDeIphone(context);
      const page = await context.newPage();
      await login(page, t.staff.email, t.staff.password);
      await page.goto(ruta(t));

      const instrucciones = page.getByTestId("push-instalar");
      await expect(instrucciones).toBeVisible();
      await expect(instrucciones).toContainText("Compartir");
      await expect(instrucciones).toContainText("Agregar a pantalla de inicio");
      await expect(instrucciones).toContainText(texto);
      await expect(page.getByTestId("push-ayuda")).toContainText("iOS 16.4");
      await expect(page.getByRole("button", { name: /Avisarme/ })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await context.close();
    });
  }

  test("con la app instalada pero un iOS sin Web Push, pide actualizar el sistema", async ({ browser }) => {
    const t = await nuevoLocal("iphone-viejo");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA, hasTouch: true });
    await comoSafariDeIphone(context, { instalada: true });
    const page = await context.newPage();
    await login(page, t.staff.email, t.staff.password);
    await page.goto(`/sala/${t.slug}`);
    await expect(page.getByTestId("push-ayuda")).toContainText("iOS o iPadOS 16.4 o superior");
    await expect(page.getByTestId("push-instalar")).toHaveCount(0);
    await context.close();
  });

  test("con la app instalada y Web Push disponible, ofrece activar como en cualquier otro navegador", async ({ browser }) => {
    const t = await nuevoLocal("iphone-instalada");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA, hasTouch: true });
    await conPushDoble(context);
    await context.addInitScript(() => Object.defineProperty(navigator, "standalone", { configurable: true, value: true }));
    const page = await context.newPage();
    await login(page, t.staff.email, t.staff.password);
    await page.goto(`/sala/${t.slug}`);
    await page.getByRole("button", { name: "Avisarme aunque cierre la sala" }).click();
    await expect(page.getByTestId("push-activo")).toBeVisible();
    await expect(page.getByTestId("push-instalar")).toHaveCount(0);
    await context.close();
  });
});
