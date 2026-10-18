// Genera los íconos de la app instalada (sala y panel) a partir de la marca de UcoMenu: dos rombos sobre el azul de la plataforma.
// Uso:  node tools/generar-iconos.mjs
// Escribe public/icons/*.png. No tiene dependencias nuevas: usa Playwright (ya instalado para las pruebas) y su Chromium.
// Los PNG se versionan; solo hay que volver a correrlo si cambia la marca o el color.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const FONDO = "#2646c4"; // --cobalt (el mismo que `themeColor` del viewport)
const ROMBO_A = "#ffffff";
const ROMBO_B = "#b9c6f4";
const OUT = new URL("../public/icons/", import.meta.url);

// `margen`: fracción del lado que queda vacía alrededor de la marca (la versión «maskable» necesita zona segura del 20 %).
const svg = (lado, margen) => {
  const ancho = lado * (1 - 2 * margen);
  const escala = ancho / 28; // la marca mide 28 × 16
  const x = (lado - 28 * escala) / 2;
  const y = (lado - 16 * escala) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}" viewBox="0 0 ${lado} ${lado}">
  <rect width="${lado}" height="${lado}" fill="${FONDO}"/>
  <g transform="translate(${x} ${y}) scale(${escala})">
    <path d="M8 0 16 8 8 16 0 8Z" fill="${ROMBO_A}"/>
    <path d="M20 0 28 8 20 16 12 8Z" fill="${ROMBO_B}"/>
  </g>
</svg>`;
};

const ICONOS = [
  ["icon-192.png", 192, 0.18],
  ["icon-512.png", 512, 0.18],
  ["icon-maskable-512.png", 512, 0.3], // el sistema recorta hasta el 40 %: la marca queda en la zona segura
  ["apple-touch-icon.png", 180, 0.2], // iOS no recorta con máscara propia, pero redondea las esquinas
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [nombre, lado, margen] of ICONOS) {
    const page = await browser.newPage({ viewport: { width: lado, height: lado }, deviceScaleFactor: 1 });
    await page.setContent(`<body style="margin:0">${svg(lado, margen)}</body>`);
    await page.screenshot({ path: new URL(nombre, OUT).pathname.replace(/^\/([A-Za-z]:)/, "$1"), clip: { x: 0, y: 0, width: lado, height: lado } });
    await page.close();
    console.log(`public/icons/${nombre} (${lado}×${lado})`);
  }
} finally {
  await browser.close();
}
