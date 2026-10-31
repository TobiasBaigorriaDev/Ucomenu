import { describe, expect, it } from "vitest";
import { esSitioDeProduccion, reglasRobots, RUTAS_PRIVADAS } from "./robots";

describe("esSitioDeProduccion", () => {
  it("solo el dominio definitivo con https", () => {
    expect(esSitioDeProduccion("https://ucomenu.com")).toBe(true);
    expect(esSitioDeProduccion("https://www.ucomenu.com")).toBe(true);
  });
  it("staging, local, http, vacío y basura no son producción", () => {
    for (const url of ["https://ucomenu-staging.fly.dev", "http://ucomenu.com", "http://localhost:3000", "https://x.test", undefined, "", "no es una url"]) {
      expect(esSitioDeProduccion(url), String(url)).toBe(false);
    }
  });
});

describe("reglasRobots", () => {
  it("producción: se indexan la portada, las cartas y los textos; no los paneles ni las mesas", () => {
    expect(reglasRobots("https://ucomenu.com")).toEqual({ rules: { userAgent: "*", allow: "/", disallow: [...RUTAS_PRIVADAS] } });
    expect(RUTAS_PRIVADAS).toEqual(expect.arrayContaining(["/panel/", "/sala/", "/cocina/", "/admin/", "/t/"]));
    expect(RUTAS_PRIVADAS).not.toContain("/m/");
  });
  it("staging: no se indexa nada", () => {
    expect(reglasRobots("https://ucomenu-staging.fly.dev")).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});
