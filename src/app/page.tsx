import type { Metadata } from "next";
import { SITIO_URL } from "@/lib/marketing/contacto";
import { Cierre, Pie } from "@/components/marketing/cierre";
import { Control } from "@/components/marketing/control";
import { Demo } from "@/components/marketing/demo";
import { Estilos } from "@/components/marketing/estilos";
import { Faq } from "@/components/marketing/faq";
import { Hero } from "@/components/marketing/hero";
import { marketingFontClass } from "@/components/marketing/marketing-fonts";
import { Modulos } from "@/components/marketing/modulos";
import { Nav } from "@/components/marketing/nav";
import { Pasos } from "@/components/marketing/pasos";
import { Precios } from "@/components/marketing/precios";
import { Presentacion } from "@/components/marketing/presentacion";
import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import "@/components/marketing/marketing.css";

const TITULO = "UcoMenu · Carta digital con QR y llamado al mozo";
const DESCRIPCION =
  "La carta digital de tu bar, café o restaurante: tus clientes escanean el QR de la mesa, ven tu carta con tu logo y tus colores, y llaman al mozo con un toque. Probala 14 días gratis, sin tarjeta.";

const IMAGEN = { url: "/portada/og.jpg", width: 1200, height: 630, alt: "La carta de UcoMenu en el celular de cada mesa, con llamado al mozo." };

export const metadata: Metadata = {
  metadataBase: new URL(SITIO_URL),
  title: { absolute: TITULO },
  description: DESCRIPCION,
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "es_AR", siteName: "UcoMenu", title: TITULO, description: DESCRIPCION, url: "/", images: [IMAGEN] },
  twitter: { card: "summary_large_image", title: TITULO, description: DESCRIPCION, images: [IMAGEN.url] },
};

/** Portada de ucomenu.com. Ficha: agile/cambios/portada-ucomenu.md. */
export default function Home() {
  return (
    <div className={`marketing ${marketingFontClass}`}>
      <ScrollReveal />
      <Nav />
      <main id="contenido">
        <Hero />
        <Presentacion />
        <Control />
        <Modulos />
        <Pasos />
        <Estilos />
        <Demo />
        <Precios />
        <Faq />
        <Cierre />
      </main>
      <Pie />
    </div>
  );
}
