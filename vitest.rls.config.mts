import path from "node:path";
import { defineConfig } from "vitest/config";

// Pruebas de integración de RLS contra el Supabase local.
// Lee .env.local (claves públicas) y .env.test.local (clave de servicio, solo para pruebas).
for (const file of [".env.local", ".env.test.local"]) {
  try {
    process.loadEnvFile(path.resolve(import.meta.dirname, file));
  } catch {
    // Si falta alguno, la prueba falla con un mensaje claro sobre las variables.
  }
}

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/rls/**/*.test.ts"],
    // Comparten una base: se ejecutan de a un archivo por vez.
    fileParallelism: false,
  },
});
