import { defineConfig } from "@playwright/test";

// El servidor de prueba hereda estas variables: la clave de servicio (solo en .env.test.local) llega a la app
// únicamente en las pruebas, sin escribirla en .env.local. Con `pnpm dev` hay que ponerla en .env.local.
for (const file of [".env.local", ".env.test.local"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Si falta alguno, las pruebas fallan con un mensaje claro sobre las variables.
  }
}

// Secreto fijo para el servidor de pruebas: así las pruebas pueden firmar tickets de visita (vencidos, de otra mesa) con el
// mismo secreto que usa la app. Es solo de pruebas y no da acceso a nada. Si el entorno ya define uno, se respeta.
process.env.WAITER_CALL_CLIENT_SECRET ||= "secreto-solo-para-las-pruebas-e2e-0123456789";

// `E2E_PORT` permite que dos worktrees corran E2E a la vez (cada uno con su propio Supabase local y su puerto).
const PORT = Number(process.env.E2E_PORT ?? 3100);
// Con E2E_BASE_URL las pruebas apuntan a un servidor ya levantado (por ejemplo, el contenedor de Docker) en vez de `next start`.
const EXTERNAL_BASE_URL = process.env.E2E_BASE_URL;

// E2E contra el build de producción y el Supabase LOCAL con supabase/seed.sql.
// Requisitos: `pnpm db:start`, `pnpm db:reset` y `pnpm build` (o usar `pnpm test:e2e:full`).
export default defineConfig({
  testDir: "./e2e",
  // Las pruebas largas (varias sesiones, fotos grandes) superaban los 30 s por defecto con todos los workers a la vez.
  timeout: 60_000,
  // Las aserciones esperan hasta 10 s (5 s por defecto): con ~100 pruebas en paralelo, acciones del servidor como el
  // cambio de contraseña a veces tardan más de 5 s en una máquina cargada.
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: EXTERNAL_BASE_URL ?? `http://localhost:${PORT}`,
    // Teléfono de referencia del producto: mobile-first, 390 px de ancho.
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "es-AR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: EXTERNAL_BASE_URL
    ? undefined
    : {
        command: `pnpm exec next start -p ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
