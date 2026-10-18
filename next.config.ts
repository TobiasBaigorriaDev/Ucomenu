import type { NextConfig } from "next";

// Fotos y logos viven en buckets públicos de Supabase Storage: el servidor los reduce y sirve desde `/_next/image`.
// Solo se permiten el host configurado y las carpetas product-images y organization-logos; otras rutas dan 400.
// Con el Supabase local (127.0.0.1) hay que permitir además la IP local; en la nube (`*.supabase.co`) queda prohibida.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL) : null;
const supabaseEsLocal = supabaseUrl !== null && ["127.0.0.1", "localhost"].includes(supabaseUrl.hostname);

const nextConfig: NextConfig = {
  // Solo la imagen de Docker (Dockerfile) construye en modo «standalone» (servidor mínimo con `node server.js`). Sin la
  // variable, `pnpm build` y `next start` quedan como siempre: las pruebas E2E locales dependen de eso.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Probar desde un teléfono en la misma red con `next dev`: DEV_LAN_HOST=<IP de la PC> (p. ej. 192.168.1.20). Sin la variable
  // no cambia nada. Con `next start` por HTTP las cookies `Secure` de la sesión no se guardan en una IP de red (solo en localhost).
  allowedDevOrigins: process.env.DEV_LAN_HOST ? [process.env.DEV_LAN_HOST] : [],
  experimental: {
    serverActions: {
      // Las fotos de los platos viajan en la server action (la app las reduce a unos cientos de KB antes de
      // subir; el servidor y el bucket rechazan más de 2 MB). El valor por defecto, 1 MB, las cortaría.
      bodySizeLimit: "3mb",
    },
  },
  images: {
    remotePatterns: supabaseUrl
      ? [
          {
            protocol: supabaseUrl.protocol === "https:" ? "https" : "http",
            hostname: supabaseUrl.hostname,
            port: supabaseUrl.port,
            pathname: "/storage/v1/object/public/product-images/**",
          },
          {
            protocol: supabaseUrl.protocol === "https:" ? "https" : "http",
            hostname: supabaseUrl.hostname,
            port: supabaseUrl.port,
            pathname: "/storage/v1/object/public/organization-logos/**",
          },
        ]
      : [],
    dangerouslyAllowLocalIP: supabaseEsLocal,
    // Solo los anchos que la carta necesita (miniatura de 96 px a 1x y 2x; mosaico de media pantalla y de pantalla completa):
    // menos variantes que optimizar y un `srcset` corto (va repetido por foto en el HTML). Si cambia el diseño de la
    // carta, revisar estos números.
    imageSizes: [96, 192],
    deviceSizes: [384, 640, 1080, 1280],
    // Las rutas de las fotos llevan un UUID nuevo en cada subida: nunca cambian, así que se pueden guardar mucho tiempo.
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  async headers() {
    // El service worker del aviso de llamados (ADR 0020) se revalida siempre: una versión nueva tiene que llegar a los
    // dispositivos sin esperar a una caché. Solo puede controlar la sala (alcance /sala/).
    return [
      {
        source: "/sala-sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/sala/" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
