import path from "node:path";
import { defineConfig } from "vitest/config";

// Pruebas unitarias: puras, sin base de datos ni red.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
