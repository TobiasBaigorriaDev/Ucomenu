import { describe, expect, it } from "vitest";
import { instagramUrl, readVoice, validateHours, validateInstagram, validateTagline, validateWhatsapp, whatsappUrl } from "./voz";

describe("lema y horarios", () => {
  it("recorta, junta espacios repetidos y trata vacío como «quitar»", () => {
    expect(validateTagline("  Café   de especialidad  ")).toEqual({ ok: true, value: "Café de especialidad" });
    for (const empty of ["", "   ", null, undefined, 5]) expect(validateTagline(empty)).toEqual({ ok: true, value: null });
  });
  it("acepta exactamente el máximo y rechaza uno más (en caracteres, no en bytes)", () => {
    expect(validateTagline("ñ".repeat(80))).toMatchObject({ ok: true });
    expect(validateTagline("ñ".repeat(81))).toEqual({ ok: false, problem: "too_long" });
    expect(validateHours("a".repeat(160))).toMatchObject({ ok: true });
    expect(validateHours("a".repeat(161))).toEqual({ ok: false, problem: "too_long" });
  });
  it("rechaza saltos de línea, controles y marcas invisibles de dirección o ancho cero", () => {
    for (const bad of ["uno\ndos", "tab\taquí", "nulo\u0000", "‮oculto", "a​b", "a⁦b", "a﻿b", "a\u0085b"]) {
      expect(validateTagline(bad), JSON.stringify(bad)).toEqual({ ok: false, problem: "invalid" });
      expect(validateHours(bad), JSON.stringify(bad)).toEqual({ ok: false, problem: "invalid" });
    }
  });
  it("no interpreta HTML: se guarda como texto", () => {
    expect(validateTagline("<script>alert(1)</script>")).toMatchObject({ ok: true, value: "<script>alert(1)</script>" });
  });
});

describe("Instagram", () => {
  it("acepta usuario, @usuario y el enlace del perfil, y guarda solo el usuario", () => {
    for (const ok of ["milocal", "@milocal", "https://www.instagram.com/milocal/", "http://instagram.com/milocal?hl=es", "instagram.com/milocal"]) {
      expect(validateInstagram(ok), ok).toEqual({ ok: true, value: "milocal" });
    }
    expect(validateInstagram("mi.local_01")).toEqual({ ok: true, value: "mi.local_01" });
    expect(validateInstagram("")).toEqual({ ok: true, value: null });
  });
  it("rechaza otros sitios, espacios, caracteres raros y usuarios largos", () => {
    for (const bad of ["https://evil.example/milocal", "javascript:alert(1)", "mi local", "mi-local", "mi@local", "//evil.example", "@@x", "mi/local/otro"]) {
      expect(validateInstagram(bad).ok, bad).toBe(false);
    }
    expect(validateInstagram("a".repeat(31))).toEqual({ ok: false, problem: "too_long" });
    expect(validateInstagram("a".repeat(30))).toMatchObject({ ok: true });
  });
  it("el enlace lo arma el servidor con el usuario validado", () => {
    expect(instagramUrl("milocal")).toBe("https://www.instagram.com/milocal/");
  });
});

describe("WhatsApp", () => {
  it("acepta formatos con separadores y guarda solo dígitos", () => {
    expect(validateWhatsapp("+54 9 11 1234-5678")).toEqual({ ok: true, value: "5491112345678" });
    expect(validateWhatsapp("(011) 4444-5555")).toEqual({ ok: true, value: "01144445555" });
    expect(validateWhatsapp("")).toEqual({ ok: true, value: null });
  });
  it("rechaza letras, enlaces y largos fuera de 8 a 15 dígitos", () => {
    for (const bad of ["https://wa.me/549111", "54911abc", "1234567", "+54 9 11 1234-5678 ext 2", "tel:5491112345678"]) expect(validateWhatsapp(bad).ok, bad).toBe(false);
    expect(validateWhatsapp("1".repeat(16))).toEqual({ ok: false, problem: "too_long" });
    expect(validateWhatsapp("1".repeat(15))).toMatchObject({ ok: true });
  });
  it("el enlace lo arma el servidor con el número validado", () => {
    expect(whatsappUrl("5491112345678")).toBe("https://wa.me/5491112345678");
  });
});

describe("lectura de lo guardado", () => {
  it("descarta cualquier valor que no cumpla las reglas, aunque ya esté en la base", () => {
    expect(readVoice({ menu_tagline: "Hola", opening_hours: "Todos los días", instagram_handle: "milocal", whatsapp_number: "5491112345678" })).toEqual({ tagline: "Hola", hours: "Todos los días", instagram: "milocal", whatsapp: "5491112345678" });
    expect(readVoice({ menu_tagline: "uno\ndos", opening_hours: 5, instagram_handle: "https://evil.example", whatsapp_number: "abc" })).toEqual({ tagline: null, hours: null, instagram: null, whatsapp: null });
    expect(readVoice({})).toEqual({ tagline: null, hours: null, instagram: null, whatsapp: null });
  });
});
