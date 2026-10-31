import { describe, expect, it } from "vitest";
import { DEMO_CARTA_PATH, DEMO_CARTA_URL, WHATSAPP_MENSAJE, WHATSAPP_NUMERO, whatsappUrl } from "./contacto";
import { PLANES, precioArs } from "./planes";

describe("contacto de la portada", () => {
  it("el enlace y el QR usan la misma carta de Aurelia", () => {
    expect(DEMO_CARTA_PATH).toBe("https://ucomenu-staging.fly.dev/m/aurelia/centro");
    expect(DEMO_CARTA_URL).toBe(DEMO_CARTA_PATH);
  });
  it("arma el enlace de WhatsApp con el mensaje codificado", () => {
    const url = new URL(whatsappUrl());
    expect(url.origin + url.pathname).toBe(`https://wa.me/${WHATSAPP_NUMERO}`);
    expect(url.searchParams.get("text")).toBe(WHATSAPP_MENSAJE);
  });

  it("el número es internacional, solo dígitos y de celular argentino", () => {
    expect(WHATSAPP_NUMERO).toMatch(/^549\d{10}$/);
  });

  it("acepta otro mensaje y lo codifica", () => {
    expect(new URL(whatsappUrl("Hola & chau")).searchParams.get("text")).toBe("Hola & chau");
  });
});

describe("planes de la portada", () => {
  it("vende Básico y Pro, en ese orden", () => {
    expect(PLANES.map((p) => p.code)).toEqual(["basic", "pro"]);
  });

  it("muestra los precios mensuales en pesos", () => {
    expect(PLANES.map(precioArs)).toEqual(["ARS 14.900", "ARS 29.000"]);
    expect(PLANES[0].anualArs).toBe(143_040);
    expect(PLANES[0].anualArs / 12).toBe(11_920);
  });

  it("los dos planes tienen precio anual, con el mismo 20 % menos que doce meses", () => {
    expect(PLANES.map((p) => p.anualArs)).toEqual([143_040, 278_400]);
    for (const plan of PLANES) expect(plan.anualArs).toBe(plan.mensualArs * 12 * 0.8);
    expect(PLANES[1].anualArs / 12).toBe(23_200);
  });
});
