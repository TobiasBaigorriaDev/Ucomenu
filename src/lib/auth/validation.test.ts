import { describe, expect, it } from "vitest";
import { normalizeEmail, safeNext, validatePassword } from "./validation";

describe("validatePassword", () => {
  it("acepta 10 caracteres o más", () => {
    expect(validatePassword("0123456789")).toBeNull();
    expect(validatePassword("una contraseña larga y con ñ")).toBeNull();
  });

  it("rechaza las cortas, las vacías y las de solo espacios", () => {
    expect(validatePassword("123456789")).toBe("too_short");
    expect(validatePassword("")).toBe("blank");
    expect(validatePassword("            ")).toBe("blank");
  });

  it("cuenta caracteres y no unidades UTF-16", () => {
    expect(validatePassword("ñññññññññ")).toBe("too_short"); // 9
    expect(validatePassword("ñññññññññññ")).toBeNull(); // 11
  });

  it("rechaza lo que bcrypt truncaría (más de 72 bytes)", () => {
    expect(validatePassword("a".repeat(72))).toBeNull();
    expect(validatePassword("a".repeat(73))).toBe("too_long");
    expect(validatePassword("ñ".repeat(37))).toBe("too_long"); // 74 bytes
  });
});

describe("normalizeEmail", () => {
  it("pasa a minúsculas y recorta espacios", () => {
    expect(normalizeEmail("  Mozo@Cafe-Ejemplo.TEST ")).toBe("mozo@cafe-ejemplo.test");
  });

  it("rechaza lo que no es un email", () => {
    for (const malo of ["", "sin-arroba", "a@b", "a b@c.com", "a@@b.com", "<a>@b.com", "a@b.c", 42, null, undefined]) {
      expect(normalizeEmail(malo), String(malo)).toBeNull();
    }
    expect(normalizeEmail(`${"a".repeat(250)}@b.com`)).toBeNull();
  });
});

describe("safeNext", () => {
  it("acepta rutas internas de las áreas con sesión", () => {
    for (const ok of ["/panel", "/panel/", "/panel/cafe-ejemplo", "/panel/cafe-ejemplo/personal", "/sala/cafe-ejemplo", "/cuenta"]) {
      expect(safeNext(ok), ok).toBe(ok);
    }
  });

  it("ignora URL externas, esquemas, rutas protocolo-relativas y otras rutas", () => {
    const malos = [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "\\\\evil.test",
      "javascript:alert(1)",
      "/panel/../admin",
      "/panel//evil.test",
      "/panel?x=1",
      "/panel#frag",
      "/admin",
      "/m/cafe-ejemplo/centro",
      "panel",
      "/panelx",
      "/panel/%2e%2e/x",
      "/panel/ con espacio",
      "",
      "/".repeat(300),
      null,
      undefined,
      ["/panel"],
    ];
    for (const malo of malos) expect(safeNext(malo), String(malo)).toBeNull();
  });
});
