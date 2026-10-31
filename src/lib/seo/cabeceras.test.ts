import { describe, expect, it } from "vitest";
import nextConfig, { securityHeaders } from "../../../next.config";

describe("cabeceras de seguridad", () => {
  it("se aplican a todas las rutas y no anuncian el framework", async () => {
    const reglas = await nextConfig.headers!();
    const global = reglas.find((r) => r.source === "/:path*");
    expect(global?.headers).toEqual(securityHeaders);
    expect(nextConfig.poweredByHeader).toBe(false);
  });
  it("HSTS de un año sin comprometer otros subdominios, nosniff, sin iframes ajenos y sin permisos que la app no usa", () => {
    const valor = (clave: string) => securityHeaders.find((h) => h.key === clave)?.value;
    expect(valor("Strict-Transport-Security")).toBe("max-age=31536000");
    expect(valor("X-Content-Type-Options")).toBe("nosniff");
    expect(valor("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(valor("Content-Security-Policy")).toBe("frame-ancestors 'self'");
    expect(valor("Permissions-Policy")).toContain("geolocation=()");
  });
  it("el service worker de la sala sigue revalidándose siempre", async () => {
    const reglas = await nextConfig.headers!();
    expect(reglas.find((r) => r.source === "/sala-sw.js")?.headers).toContainEqual({ key: "Cache-Control", value: "no-cache, max-age=0, must-revalidate" });
  });
});
