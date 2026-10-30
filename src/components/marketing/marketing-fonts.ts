import { Schibsted_Grotesk } from "next/font/google";

// Tipografía de la portada: Schibsted Grotesk en toda su gama de pesos (variable). Titulares en 800 apretados; el resto en 400 a 600.
// Es la misma familia de la carta, pero la portada no carga Gloock ni Big Shoulders: cada ruta paga solo lo que usa.
const schibsted = Schibsted_Grotesk({ variable: "--font-mk", subsets: ["latin"], display: "swap" });

/** Clase que define `--font-mk`; va en el elemento raíz `.marketing`. */
export const marketingFontClass = schibsted.variable;
