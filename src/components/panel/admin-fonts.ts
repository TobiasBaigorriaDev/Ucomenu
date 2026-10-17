import { Geist, Geist_Mono } from "next/font/google";

// Tipografía de SuperAdmin: la herramienta interna de la plataforma, sin el tono de carta de restaurante del panel del
// Dueño. Se carga solo en `/admin` (el layout la pasa al marco); Geist Mono es para datos (identificadores y direcciones).
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const adminFontClass = `${geist.variable} ${geistMono.variable}`;
