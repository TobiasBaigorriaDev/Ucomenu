// Genera los íconos de la app instalada (sala y panel) a partir de la marca de UcoMenú: dos rombos sobre el verde de UcoNext (como `components/panel/mark.tsx`).
// Uso:  node tools/generar-iconos.mjs
// Escribe public/icons/*.png. No tiene dependencias nuevas: usa Playwright (ya instalado para las pruebas) y su Chromium.
// Los PNG se versionan; solo hay que volver a correrlo si cambia la marca o el color.
import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { chromium } from "@playwright/test";

const FONDO = "#155b20"; // --cobalt (el mismo que `themeColor` del viewport): verde de UcoNext
const ROMBO_A = "#ffffff";
const ROMBO_B = "#4a9e38"; // --vivid: segundo rombo de la marca, solo decorativo
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

// `src/app/favicon.ico`: lo sirve Next como favicon de todo el sitio. Es un contenedor ICO con tres PNG (16, 32 y 48 px) y poco margen,
// para que la marca se distinga en la pestaña. Antes era el favicon por defecto de Next.js (una «N» negra).
const FAVICON = new URL("../src/app/favicon.ico", import.meta.url);
const LADOS_FAVICON = [16, 32, 48];
const MARGEN_FAVICON = 0.06;

// PNG RGBA (tipo de color 6) escrito a mano: Next.js decodifica `favicon.ico` al construir y rechaza los PNG sin canal alfa, y Chromium
// guarda sin alfa las capturas opacas (incluso con `omitBackground`). `rgba` son los píxeles del lienzo, fila por fila.
function pngRgba(lado, rgba) {
  const filas = Buffer.alloc(lado * (1 + lado * 4));
  for (let y = 0; y < lado; y++) {
    const inicio = y * (1 + lado * 4);
    filas[inicio] = 0; // filtro «ninguno»
    Buffer.from(rgba.subarray(y * lado * 4, (y + 1) * lado * 4)).copy(filas, inicio + 1);
  }
  const trozo = (tipo, datos) => {
    const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo) >>> 0);
    return Buffer.concat([largo, cuerpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo("IHDR", ihdr), trozo("IDAT", deflateSync(filas)), trozo("IEND", Buffer.alloc(0))]);
}

function armarIco(imagenes) {
  const cabecera = Buffer.alloc(6);
  cabecera.writeUInt16LE(1, 2); // tipo: ícono
  cabecera.writeUInt16LE(imagenes.length, 4);
  let desplazamiento = 6 + 16 * imagenes.length;
  const entradas = imagenes.map(({ lado, png }) => {
    const entrada = Buffer.alloc(16);
    entrada.writeUInt8(lado, 0);
    entrada.writeUInt8(lado, 1);
    entrada.writeUInt16LE(1, 4); // planos
    entrada.writeUInt16LE(32, 6); // bits por píxel
    entrada.writeUInt32LE(png.length, 8);
    entrada.writeUInt32LE(desplazamiento, 12);
    desplazamiento += png.length;
    return entrada;
  });
  return Buffer.concat([cabecera, ...entradas, ...imagenes.map(({ png }) => png)]);
}

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
  const imagenes = [];
  for (const lado of LADOS_FAVICON) {
    const page = await browser.newPage({ viewport: { width: lado, height: lado }, deviceScaleFactor: 1 });
    const dibujo = svg(lado, MARGEN_FAVICON);
    const pixeles = await page.evaluate(async ({ dibujo: marca, lado: n }) => {
      const imagen = new Image();
      imagen.src = `data:image/svg+xml;base64,${btoa(marca)}`;
      await imagen.decode();
      const lienzo = document.createElement("canvas");
      lienzo.width = lienzo.height = n;
      const contexto = lienzo.getContext("2d");
      contexto.drawImage(imagen, 0, 0, n, n);
      return Array.from(contexto.getImageData(0, 0, n, n).data);
    }, { dibujo, lado });
    imagenes.push({ lado, png: pngRgba(lado, Uint8Array.from(pixeles)) });
    await page.close();
  }
  writeFileSync(FAVICON, armarIco(imagenes));
  console.log(`src/app/favicon.ico (${LADOS_FAVICON.join(", ")} px)`);
} finally {
  await browser.close();
}
