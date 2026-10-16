import type { NextConfig } from "next";

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
