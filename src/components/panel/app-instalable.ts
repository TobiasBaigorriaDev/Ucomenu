import type { Metadata } from "next";

/**
 * Metadatos para que la sala y el panel se puedan instalar como app (ficha aviso-push-iphone): manifiesto, ícono de iOS y
 * modo «app web». En iPhone y iPad es la única forma de recibir los avisos con la app cerrada. Solo el área del personal
 * los lleva: la carta pública, el login y `/t/{token}` no ofrecen instalar nada.
 */
export const appInstalable: Pick<Metadata, "manifest" | "icons" | "appleWebApp"> = {
  manifest: "/sala.webmanifest",
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "UcoMenu", statusBarStyle: "default" },
};
