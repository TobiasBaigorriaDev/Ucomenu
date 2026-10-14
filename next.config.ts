import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
