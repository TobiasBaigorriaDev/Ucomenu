import { Gloock, Schibsted_Grotesk } from "next/font/google";

// Tipografía propia de la carta pública (rediseño editorial). Se carga solo donde se usa: el panel, la sala y el login
// siguen con las fuentes globales de `layout.tsx`. Gloock tiene un solo peso: nunca se le aplica negrita.
const gloock = Gloock({ variable: "--font-gloock", subsets: ["latin"], weight: "400" });
const schibsted = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"] });

/** Clases que definen las variables CSS de las fuentes; van en el elemento raíz `.carta`. */
export const cartaFontClass = `${gloock.variable} ${schibsted.variable}`;
