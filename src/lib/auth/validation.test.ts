import { describe, expect, it } from "vitest";
import { landingPath, normalizeEmail, safeNext, validatePassword } from "./validation";

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
    for (const ok of ["/panel", "/panel/", "/panel/cafe-ejemplo", "/panel/cafe-ejemplo/personal", "/sala/cafe-ejemplo", "/cuenta", "/admin", "/admin/nueva"]) {
      expect(safeNext(ok), ok).toBe(ok);
    }
  });

  it("acepta el camino de la hoja de QR de una sucursal (la sucursal va en el camino, no en la query)", () => {
    for (const ok of [
      "/panel/cafe-ejemplo/mesas",
      "/panel/cafe-ejemplo/mesas/imprimir/11000000-0000-4000-8000-000000000001",
      "/panel/cafe-ejemplo/carta/platos/13000000-0000-4000-8000-000000000001",
    ]) {
      expect(safeNext(ok), ok).toBe(ok);
    }
    // Una query sigue siendo inválida: se perdería o habría que sanearla.
    expect(safeNext("/panel/cafe-ejemplo/mesas/imprimir?sucursal=11000000-0000-4000-8000-000000000001")).toBeNull();
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
      "/adminx",
      "/admin?x=1",
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

describe("landingPath", () => {
  it("manda al SuperAdmin a /admin y al resto a /panel cuando no hay next", () => {
    expect(landingPath(null, true)).toBe("/admin");
    expect(landingPath(null, false)).toBe("/panel");
  });

  it("un next válido manda siempre, también para el SuperAdmin", () => {
    expect(landingPath("/panel/cafe-ejemplo", true)).toBe("/panel/cafe-ejemplo");
    expect(landingPath("/sala/cafe-ejemplo", false)).toBe("/sala/cafe-ejemplo");
  });

  it("un next inválido (descartado por safeNext) cae al destino por defecto", () => {
    expect(landingPath(safeNext("//evil.test"), true)).toBe("/admin");
    expect(landingPath(safeNext("https://evil.test"), false)).toBe("/panel");
  });
});
