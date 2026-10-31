import { Alfa_Slab_One, Big_Shoulders, Bricolage_Grotesque, Fraunces, Gloock, Playfair_Display, Schibsted_Grotesk, Syne } from "next/font/google";

// Tipografía propia de la carta pública (rediseño editorial). Se carga solo donde se usa: el panel, la sala y el login
// siguen con las fuentes globales de `layout.tsx`. Gloock tiene un solo peso: nunca se le aplica negrita.
const gloock = Gloock({ variable: "--font-gloock", subsets: ["latin"], weight: "400" });
const schibsted = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"] });
// Títulos del estilo «afiche» (condensada, variable de 100 a 900). Sin precarga: el navegador la baja solo si la página la usa,
// así las cartas de los otros estilos no pagan el archivo. `next/font` no tiene métricas para ajustarle un reemplazo; lo define
// `carta.css` (`AficheFallback`: la sans del sistema angostada al ancho de Big Shoulders), así mientras carga se lee el título
// con el mismo ancho, sin partir palabras ni saltar.
const bigShoulders = Big_Shoulders({
  variable: "--font-afiche",
  subsets: ["latin"],
  preload: false,
  adjustFontFallback: false,
  fallback: ["AficheFallback", "sans-serif"],
});

// Voces tipográficas que elige el local (`lib/identidad/tipografias.ts`). Ninguna se precarga: el navegador baja solo el archivo de la
// voz que la carta usa (las reglas `.carta[data-fuente]` de `carta.css` son las únicas que la nombran), y `next/font` genera el
// reemplazo con la métrica de cada una para que no haya salto al cargar. Solo reemplazan los títulos: el texto sigue en Schibsted.
// `next/font` pide objetos literales (no admite `...spread`), por eso las opciones se repiten en cada llamada.
const fraunces = Fraunces({ variable: "--font-calida", subsets: ["latin"], axes: ["SOFT"], preload: false, display: "swap" });
const playfair = Playfair_Display({ variable: "--font-editorial", subsets: ["latin"], preload: false, display: "swap" });
const bricolage = Bricolage_Grotesque({ variable: "--font-moderna", subsets: ["latin"], preload: false, display: "swap" });
const alfaSlab = Alfa_Slab_One({ variable: "--font-bodegon", subsets: ["latin"], weight: "400", preload: false, display: "swap" });
const syne = Syne({ variable: "--font-nocturna", subsets: ["latin"], preload: false, display: "swap" });

/** Clases que definen las variables CSS de las fuentes; van en el elemento raíz `.carta`. */
export const cartaFontClass = `${gloock.variable} ${schibsted.variable} ${bigShoulders.variable} ${fraunces.variable} ${playfair.variable} ${bricolage.variable} ${alfaSlab.variable} ${syne.variable}`;
