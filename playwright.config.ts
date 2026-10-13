import { defineConfig } from "@playwright/test";

const PORT = 3100;

// E2E contra el build de producción y el Supabase LOCAL con supabase/seed.sql.
// Requisitos: `pnpm db:start`, `pnpm db:reset` y `pnpm build` (o usar `pnpm test:e2e:full`).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Teléfono de referencia del producto: mobile-first, 390 px de ancho.
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "es-AR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
