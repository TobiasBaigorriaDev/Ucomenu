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
    // Borra restos de corridas interrumpidas (organizaciones `tt-*`, usuarios `rls-*`) antes de empezar.
    globalSetup: ["./tests/rls/global-setup.ts"],
    // La limpieza final de algunos archivos borra decenas de organizaciones con cientos de filas: con la base fría
    // supera los 10 s por defecto y, si se corta, deja restos que rompen la corrida siguiente.
    hookTimeout: 60_000,
    // Con la base fría las pruebas de concurrencia (varias rondas de bajas simultáneas) pasan los 5 s por defecto.
    testTimeout: 30_000,
    // Comparten una base: se ejecutan de a un archivo por vez.
    fileParallelism: false,
  },
});
