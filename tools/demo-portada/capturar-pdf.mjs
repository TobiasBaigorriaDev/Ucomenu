#!/usr/bin/env node
/**
 * Saca las capturas de la carta de estilo Hoja (`menu_layout = 'hoja'`) para la portada: el inicio (la página entera, como llega al
 * celular) y una ampliada (como queda al pellizcar). Usa «Café Ejemplo» del Supabase LOCAL. SOLO EN DESARROLLO LOCAL: no toca staging
 * ni ninguna base remota y no necesita credenciales de nadie.
 *
 * Requisitos: Supabase local encendido, «Café Ejemplo» en estilo Hoja (`update organizations set menu_layout='hoja' ...`) y la app
 * construida y sirviendo (`pnpm build` y `pnpm exec next start -p 3300`; PORTADA_BASE, por defecto http://localhost:3300). La carta
 * pública se guarda en caché 60 s: si el servidor ya la tenía, el script recarga y espera hasta que desaparezca el plato oculto.
 * Uso:  node tools/demo-portada/capturar-pdf.mjs
 * Deja en public/portada/: carta-cafe-pdf.jpg y carta-cafe-pdf-abajo.jpg (390 × 844 a 2×, 780 × 1688). Los platos de prueba que hay
 * en la base local se ocultan SOLO mientras dura la captura (`is_active = false`) y se vuelven a mostrar al terminar.
 */
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";

const BASE = process.env.PORTADA_BASE ?? "http://localhost:3300";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("Solo contra la app local.");
const SLUG = "cafe-ejemplo";
const RUTA = `/m/${SLUG}/centro`;
// Platos de prueba que hay en la base local y no deben salir en una imagen de la portada.
const OCULTAR = ["UYSHUSHUS"];
// Zoom de la captura ampliada: con 1,9 entra una columna entera de la hoja con sus precios.
const ZOOM = 1.9;
const OUT = new URL("../../public/portada/", import.meta.url);
const ruta = (n) => new URL(n, OUT).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const psql = (sql) => execFileSync("docker", ["exec", "supabase_db_ucomenu", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], { encoding: "utf8" });
const nombres = OCULTAR.map((n) => `'${n.replace(/'/g, "''")}'`).join(", ");
const filtro = `organization_id = (select id from organizations where slug = '${SLUG}') and name in (${nombres})`;
const OCULTAR_DEV = "nextjs-portal,[data-nextjs-toast],[data-nextjs-dev-tools-button]{display:none!important}";

if (psql(`select menu_layout from organizations where slug = '${SLUG}'`).trim() !== "hoja") throw new Error("«Café Ejemplo» tiene que estar en estilo Hoja (menu_layout = 'hoja').");
psql(`update products set is_active = false where ${filtro}`);
console.log("Platos de prueba ocultos.");
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "es-AR" });
  const page = await context.newPage();
  for (let intento = 0; ; intento++) {
    await page.goto(new URL(RUTA, BASE).href, { waitUntil: "networkidle" });
    await page.locator(".sheet-paper[data-fit]").waitFor();
    if (!(await page.getByText(OCULTAR[0]).count())) break;
    if (intento === 3) throw new Error("El plato de prueba sigue en la carta: reiniciar la app y repetir.");
    console.log("La caché todavía tiene el plato de prueba: espero 31 s y recargo.");
    await page.waitForTimeout(31_000);
  }
  await page.addStyleTag({ content: OCULTAR_DEV }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: ruta("carta-cafe-pdf.jpg"), type: "jpeg", quality: 88 });
  console.log("carta-cafe-pdf.jpg");

  // Ampliada: el zoom de pellizco que haría la persona, sobre la parte de arriba de la hoja.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: ZOOM });
  await page.waitForTimeout(500);
  const y = await page.evaluate(() => document.querySelector(".sheet-columns").getBoundingClientRect().top + window.scrollY - 24);
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await page.waitForTimeout(500);
  await page.screenshot({ path: ruta("carta-cafe-pdf-abajo.jpg"), type: "jpeg", quality: 88 });
  console.log("carta-cafe-pdf-abajo.jpg");
} finally {
  await browser.close();
  psql(`update products set is_active = true where ${filtro}`);
  console.log("Platos de prueba restaurados.");
}
