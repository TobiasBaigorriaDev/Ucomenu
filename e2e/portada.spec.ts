import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support";

test("Acceder está disponible en el nav móvil y lleva al login", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Principal" });
  const acceso = nav.getByRole("link", { name: "Acceder" });
  await expect(acceso).toBeVisible();
  await expect(acceso).toHaveAttribute("href", "/login");
  await expect(nav.getByRole("link", { name: "Probalo gratis" })).toBeVisible();
  const barra = (await nav.boundingBox())!;
  const caja = (await acceso.boundingBox())!;
  expect(caja.height).toBeGreaterThanOrEqual(44);
  expect(caja.x + caja.width).toBeLessThanOrEqual(barra.x + barra.width);
  await expectNoHorizontalOverflow(page);
  await acceso.click();
  await expect(page).toHaveURL(/\/login$/);
});

test("la presentación se ofrece con controles y sin reproducirse ni descargarse automáticamente", async ({ page, request }) => {
  const pedidosVideo: string[] = [];
  page.on("request", (req) => { if (req.url().includes("/portada/presentacion.mp4")) pedidosVideo.push(req.url()); });
  await page.goto("/");
  const video = page.getByLabel("Presentación de UcoMenu");
  await expect(video).toHaveAttribute("controls", "");
  await expect(video).toHaveAttribute("preload", "none");
  await expect(video).not.toHaveAttribute("autoplay", "");
  expect(pedidosVideo).toHaveLength(0);
  const respuesta = await request.get("/portada/presentacion.mp4", { headers: { Range: "bytes=0-1023" } });
  expect(respuesta.status()).toBe(206);
  expect(respuesta.headers()["content-type"]).toContain("video/mp4");
  await expect(video.locator("track")).toHaveAttribute("src", "/portada/presentacion-es.vtt");
  for (const viewport of [{ width: 320, height: 640 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await video.scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `output/ux/presentacion-${viewport.width}.png` });
  }
});

/**
 * Portada de ucomenu.com (ficha portada-ucomenu): el botón abre WhatsApp con el mensaje, cabe en el teléfono, los precios cambian
 * con el período, las pestañas de estilos funcionan y la página no promete lo que el producto no hace.
 */

test("el titular y el botón principal abren WhatsApp con el mensaje prellenado", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Tu carta digital con QR");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("que también llama al mozo");
  const boton = page.getByRole("link", { name: /Probalo 14 días gratis/ }).first();
  const href = new URL((await boton.getAttribute("href")) ?? "");
  expect(href.origin + href.pathname).toBe("https://wa.me/5492622230125");
  expect(href.searchParams.get("text")).toBe("Hola, quiero probar UcoMenu 14 días gratis con mi local.");
  await expect(boton).toHaveAttribute("target", "_blank");
  await expect(boton).toHaveAttribute("rel", /noopener/);
});

test("en el teléfono cabe sin desborde y el botón se ve sin bajar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expectNoHorizontalOverflow(page);
  const caja = await page.getByRole("link", { name: /Probalo 14 días gratis/ }).first().boundingBox();
  expect(caja).not.toBeNull();
  expect(caja!.y + caja!.height).toBeLessThanOrEqual(844);
});

test("muestra los precios mensuales en pesos", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".mk-plan").first().locator(".mk-precio")).toContainText("ARS 14.900");
  await expect(page.locator("article.mk-plan-pro .mk-precio")).toContainText("ARS 29.000");
});

test("se ofrecen solo Básico y Pro: sin Premium y sin funciones «Pronto»", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("article.mk-plan")).toHaveCount(2);
  const texto = await page.locator("main").innerText();
  expect(texto).not.toMatch(/premium/i);
  expect(texto).not.toContain("Pronto");
});

test("la celda de videos muestra el feed en un teléfono: video mudo y en bucle con botón de pausa, o la imagen de portada si no se puede reproducir", async ({ page }) => {
  await page.goto("/");
  const celda = page.locator(".mk-visual-video");
  await celda.scrollIntoViewIfNeeded();
  // El Chromium que trae Playwright no decodifica H.264: ahí el video falla y la página muestra la imagen de portada, sin botón.
  // En un Chrome, Edge, Firefox o Safari normales el video se reproduce y vale la segunda parte.
  const estado = await page
    .waitForFunction(() => {
      const v = document.querySelector<HTMLVideoElement>(".mk-visual-video video");
      if (!v) return "portada";
      return v.readyState >= 1 ? "video" : false;
    }, undefined, { timeout: 20_000 })
    .then((h) => h.jsonValue());
  if (estado === "portada") {
    await expect(celda.locator("img")).toHaveAttribute("alt", /feed de videos cortos/);
    await expect(page.locator(".mk-feed-pausa")).toHaveCount(0);
    return;
  }
  const video = celda.locator("video");
  await expect(video).toHaveAttribute("src", "/portada/menufeed.mp4");
  await expect(video).toHaveAttribute("poster", "/portada/menufeed-poster.jpg");
  await expect(video).toHaveJSProperty("muted", true);
  await expect(video).toHaveJSProperty("loop", true);
  await expect(video).toHaveAccessibleName(/feed de videos cortos/);
  const boton = page.locator(".mk-feed-pausa");
  // Arranca solo al estar a la vista (si el navegador no pide reducir el movimiento) y el botón dice lo que el video hace de verdad.
  await expect(boton).toHaveText("Pausar video", { timeout: 10_000 });
  await boton.click();
  await expect(boton).toHaveText("Reproducir video");
  await expect(video).toHaveJSProperty("paused", true);
  await boton.click();
  await expect(boton).toHaveText("Pausar video");
  await expect(video).toHaveJSProperty("paused", false);
});

test("el feed de videos figura en Pro, con su cupo de 10", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("article.mk-plan-pro")).toContainText("Videos cortos en tu carta");
  await expect(page.locator("article.mk-plan-pro")).toContainText("hasta 10 publicados");
  await expect(page.locator("article.mk-plan").first()).not.toContainText("Videos cortos");
});

test("las pestañas de estilo cambian la captura y se manejan con flechas", async ({ page }) => {
  await page.goto("/");
  const titulo = page.locator(".mk-estilo-info h3");
  await expect(titulo).toHaveText("Estilo Bento, paleta Oliva");
  await expect(async () => {
    await page.getByRole("tab", { name: "Fuego Andino" }).click();
    await expect(titulo).toHaveText("Estilo Afiche, paleta Cacao", { timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("tab", { name: "La Bestia Burger & Bar" }).click();
  await expect(titulo).toHaveText("Estilo Afiche, paleta Carbón");
  await page.keyboard.press("ArrowRight");
  await expect(titulo).toHaveText("Estilo Bento, paleta Trattoria");
  await expect(page.getByText("tema de fecha especial de San Valentín")).toBeVisible();
  await expect(page.getByRole("tab", { selected: true })).toHaveCount(1);
});

test("las preguntas se abren y aclaran que la carta es solo de consulta", async ({ page }) => {
  await page.goto("/");
  const pregunta = page.locator(".mk-faq details", { hasText: "pueden pedir y pagar desde la carta" });
  await pregunta.locator("summary").click();
  await expect(pregunta).toContainText("No: la carta es solo de consulta");
});

test("la carta de ejemplo del botón es una carta pública real", async ({ page, request }) => {
  await page.goto("/");
  const enlace = page.getByRole("link", { name: /Ver una carta de ejemplo/ });
  const href = await enlace.getAttribute("href");
  expect(href).toBe("https://ucomenu-staging.fly.dev/m/aurelia/centro");
  expect((await request.get(href!)).status()).toBe(200);
});

test("no promete pedidos del cliente, pagos online ni comisiones", async ({ page }) => {
  await page.goto("/");
  const texto = (await page.locator("main").innerText()).toLowerCase();
  expect(texto).not.toContain("comisi");
  expect(texto).not.toContain("pedí desde");
  expect(texto).not.toContain("pagá desde");
});

test("el pie muestra las cinco cartas de ejemplo, más abajo, con su estilo y su paleta", async ({ page }) => {
  await page.goto("/");
  const galeria = page.locator(".mk-galeria figure");
  await expect(galeria).toHaveCount(5);
  await expect(galeria.first()).toContainText("Bruma Bistró");
  await expect(galeria.first()).toContainText("Estilo Bento · Oliva");
  await expect(page.locator(".mk-galeria img").first()).toHaveAttribute("alt", /más abajo en la carta/);
});
