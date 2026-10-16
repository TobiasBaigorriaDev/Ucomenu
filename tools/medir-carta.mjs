#!/usr/bin/env node
/**
 * Mide la carga de una página (por defecto la carta de `tools/sembrar-carta-medicion.mjs`) con el Chromium de Playwright
 * y una pantalla de teléfono de 390 px. Sirve para comparar antes y después (ficha rendimiento-carta-publica).
 *
 * Uso (contra un servidor ya levantado, p. ej. `pnpm build` y `pnpm exec next start -p 3200`):
 *   node tools/medir-carta.mjs [--base http://localhost:3200] [--ruta /m/medicion-carta/centro] [--veces 5]
 *
 * Por perfil de red («sin límite» y «4G») y con el caché del navegador vacío en cada corrida, informa la MEDIANA de:
 *   LCP y CLS, TTFB, peso transferido al cargar y tras recorrer toda la página (con las fotos diferidas), cantidad y peso
 *   de imágenes, y el formato en que llegan. «4G» = el perfil móvil de Lighthouse: 1,6 Mbps de bajada, 150 ms de latencia,
 *   CPU 4 veces más lenta. Es una medición local y repetible, no reemplaza una prueba en un teléfono real.
 */
import { chromium } from "@playwright/test";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    base: { type: "string", default: "http://localhost:3200" },
    ruta: { type: "string", default: "/m/medicion-carta/centro" },
    veces: { type: "string", default: "5" },
  },
});

const PERFILES = {
  "sin límite": null,
  "4G": { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, cpu: 4 },
};

const mediana = (numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

async function corrida(browser, perfil) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "es-AR" });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  if (perfil) {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: perfil.latency,
      downloadThroughput: perfil.downloadThroughput,
      uploadThroughput: perfil.uploadThroughput,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: perfil.cpu });
  }

  const responses = new Map();
  cdp.on("Network.responseReceived", (event) => responses.set(event.requestId, { url: event.response.url, type: event.type, mime: event.response.mimeType }));
  const sizes = new Map();
  cdp.on("Network.loadingFinished", (event) => sizes.set(event.requestId, event.encodedDataLength));

  await page.addInitScript(() => {
    window.__lcp = 0;
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  });

  await page.goto(new URL(values.ruta, values.base).href, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  const alCargar = snapshot(responses, sizes);
  const { lcp, ttfb } = await page.evaluate(() => ({ lcp: window.__lcp, ttfb: performance.getEntriesByType("navigation")[0].responseStart }));

  // Recorre toda la página para que se pidan también las fotos diferidas.
  const alto = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < alto; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(150);
  }
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  const alRecorrer = snapshot(responses, sizes);
  const cls = await page.evaluate(() => window.__cls);
  const formatos = [...new Set(alRecorrer.imagenes.map((image) => image.mime))].join(", ");

  await context.close();
  return { lcp, ttfb, cls, alCargar, alRecorrer, formatos };
}

function snapshot(responses, sizes) {
  const todas = [...responses].map(([id, response]) => ({ ...response, bytes: sizes.get(id) ?? 0 }));
  const imagenes = todas.filter((response) => response.type === "Image");
  return {
    bytes: todas.reduce((sum, response) => sum + response.bytes, 0),
    imagenes,
    bytesImagenes: imagenes.reduce((sum, response) => sum + response.bytes, 0),
  };
}

const browser = await chromium.launch();
try {
  console.log(`Medición de ${new URL(values.ruta, values.base).href} (390 px, mediana de ${values.veces} corridas, caché vacío)\n`);
  for (const [nombre, perfil] of Object.entries(PERFILES)) {
    const corridas = [];
    for (let i = 0; i < Number(values.veces); i++) corridas.push(await corrida(browser, perfil));
    const m = (pick) => mediana(corridas.map(pick));
    console.log(`Red: ${nombre}`);
    console.log(`  LCP                    ${m((c) => c.lcp).toFixed(0)} ms`);
    console.log(`  TTFB                   ${m((c) => c.ttfb).toFixed(0)} ms`);
    console.log(`  CLS                    ${m((c) => c.cls).toFixed(3)}`);
    console.log(`  Al cargar              ${kb(m((c) => c.alCargar.bytes))} en total, ${m((c) => c.alCargar.imagenes.length)} imágenes (${kb(m((c) => c.alCargar.bytesImagenes))})`);
    console.log(`  Tras recorrer todo     ${kb(m((c) => c.alRecorrer.bytes))} en total, ${m((c) => c.alRecorrer.imagenes.length)} imágenes (${kb(m((c) => c.alRecorrer.bytesImagenes))})`);
    console.log(`  Formato de las fotos   ${corridas[0].formatos}\n`);
  }
} finally {
  await browser.close();
}
