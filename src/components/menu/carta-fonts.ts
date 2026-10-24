import { Big_Shoulders, Gloock, Schibsted_Grotesk } from "next/font/google";

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

/** Clases que definen las variables CSS de las fuentes; van en el elemento raíz `.carta`. */
export const cartaFontClass = `${gloock.variable} ${schibsted.variable} ${bigShoulders.variable}`;
