import { describe, expect, it } from "vitest";
import { WHATSAPP_MENSAJE, WHATSAPP_NUMERO, whatsappUrl } from "./contacto";
import { PLANES, precioArs } from "./planes";

describe("contacto de la portada", () => {
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
    expect(PLANES[0].anualArs! / 12).toBe(11_920);
  });
});
