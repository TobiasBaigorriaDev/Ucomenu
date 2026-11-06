import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Young_Serif } from "next/font/google";
import "./globals.css";

const youngSerif = Young_Serif({
  variable: "--font-young-serif",
  subsets: ["latin"],
  weight: "400",
});

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "UcoMenú", template: "%s | UcoMenú" },
  description: "Menú digital para restaurantes, bares y cafeterías.",
  // Marca verde de UcoMenú (tools/generar-iconos.mjs) para la pestaña y los accesos directos del teléfono, también en la portada y
  // la carta pública. No son una app instalable (eso solo lo ofrece el área del personal, con su manifiesto). `favicon.ico` lo sirve
  // Next desde `src/app`.
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#155b20",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-AR" className={`${youngSerif.variable} ${hanken.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
