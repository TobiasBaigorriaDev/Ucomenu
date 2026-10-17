import { describe, expect, it } from "vitest";
import type { Entitlements } from "@/lib/entitlements";
import { branchLimitMessage, sucursalesBlockNotice, sucursalesErrorMessage, sucursalesWriteBlock } from "./messages";
import { BRANCH_NAME_MAX, suggestSlug, validateBranchName, validateBranchSlug } from "./rules";

const ent = (over: Partial<Entitlements> = {}): Entitlements => ({
  state: "active",
  canWrite: true,
  features: [],
  limits: { branches: 2 },
  usage: { branches: 1 },
  ...over,
});

describe("validateBranchName", () => {
  it("recorta y acepta de 1 a 80 caracteres", () => {
    expect(validateBranchName("  Palermo  ")).toEqual({ ok: true, value: "Palermo" });
    expect(validateBranchName("x".repeat(BRANCH_NAME_MAX))).toMatchObject({ ok: true });
  });

  it("rechaza vacío, solo espacios, no texto y más de 80", () => {
    expect(validateBranchName("")).toEqual({ ok: false, problem: "blank" });
    expect(validateBranchName("   ")).toEqual({ ok: false, problem: "blank" });
    expect(validateBranchName(null)).toEqual({ ok: false, problem: "blank" });
    expect(validateBranchName("x".repeat(BRANCH_NAME_MAX + 1))).toEqual({ ok: false, problem: "too_long" });
  });

  it("cuenta caracteres, no unidades UTF-16 (igual que la base)", () => {
    expect(validateBranchName("😀".repeat(BRANCH_NAME_MAX))).toMatchObject({ ok: true });
    expect(validateBranchName("😀".repeat(BRANCH_NAME_MAX + 1))).toEqual({ ok: false, problem: "too_long" });
  });
});

describe("validateBranchSlug", () => {
  it("recorta y pasa a minúsculas, pero no arregla nada más", () => {
    expect(validateBranchSlug("  Palermo-2 ")).toEqual({ ok: true, value: "palermo-2" });
    expect(validateBranchSlug("a".repeat(64))).toMatchObject({ ok: true });
  });

  it("rechaza lo que la base rechazaría", () => {
    expect(validateBranchSlug("")).toEqual({ ok: false, problem: "blank" });
    expect(validateBranchSlug(7)).toEqual({ ok: false, problem: "blank" });
    for (const slug of ["con espacio", "ñandú", "-a", "a-", "a--b", "a_b", "a/b", "a".repeat(65)]) {
      expect(validateBranchSlug(slug), slug).toEqual({ ok: false, problem: "invalid" });
    }
  });
});

describe("suggestSlug", () => {
  it("saca acentos, pasa a minúsculas y junta con guiones simples", () => {
    expect(suggestSlug("Palermo Soho")).toBe("palermo-soho");
    expect(suggestSlug("  Ñandú & Cía.  ")).toBe("nandu-cia");
    expect(suggestSlug("Sucursal  N°  2")).toBe("sucursal-n-2");
  });

  it("lo que propone siempre es un identificador válido (o vacío)", () => {
    for (const name of ["Centro", "¡¡¡", "", "x".repeat(100), `${"a".repeat(63)} b`, "Ñ", "---"]) {
      const slug = suggestSlug(name);
      expect(slug === "" || validateBranchSlug(slug).ok, name).toBe(true);
      expect(slug.length).toBeLessThanOrEqual(64);
    }
  });
});

describe("mensajes", () => {
  it("el tope muestra el número del plan, en singular y plural, y nunca sale del texto del error", () => {
    expect(branchLimitMessage(ent({ limits: { branches: 1 } }))).toContain("incluye 1 sucursal y");
    expect(branchLimitMessage(ent({ limits: { branches: 2 } }))).toContain("incluye 2 sucursales y");
    expect(branchLimitMessage(null)).toContain("tope de sucursales");
    expect(sucursalesErrorMessage("limit", ent({ limits: { branches: 2 } }))).toBe(branchLimitMessage(ent({ limits: { branches: 2 } })));
    expect(branchLimitMessage(ent())).toContain("contactá a UcoMenu");
  });

  it("reactivar sin cupo explica la salida (desactivar otra) con el número del plan y dice que no se reactivó", () => {
    const uno = sucursalesErrorMessage("limit_reactivate", ent({ limits: { branches: 1 } }));
    expect(uno).toContain("incluye 1 sucursal activa y");
    expect(uno).toContain("desactivá otra");
    expect(uno).toContain("No se reactivó");
    expect(sucursalesErrorMessage("limit_reactivate", ent({ limits: { branches: 2 } }))).toContain("incluye 2 sucursales activas y");
    expect(sucursalesErrorMessage("limit_reactivate", null)).toContain("tope de sucursales activas");
    // Al crear, el tope también sugiere desactivar una.
    expect(branchLimitMessage(ent())).toContain("desactivá una");
  });

  it("todos los errores tienen mensaje propio", () => {
    for (const error of [
      "name_blank",
      "name_too_long",
      "slug_blank",
      "slug_invalid",
      "slug_duplicate",
      "limit",
      "limit_reactivate",
      "blocked_read_only",
      "blocked_suspended",
      "forbidden",
      "not_found",
      "unexpected",
    ] as const) {
      expect(sucursalesErrorMessage(error, null).length, error).toBeGreaterThan(10);
    }
  });

  it("la cuenta bloqueada se explica; sin dato del plan falla cerrado", () => {
    expect(sucursalesWriteBlock(ent())).toBeNull();
    expect(sucursalesBlockNotice(ent())).toBeNull();
    expect(sucursalesWriteBlock(ent({ state: "read_only", canWrite: false }))).toBe("blocked_read_only");
    expect(sucursalesWriteBlock(ent({ state: "suspended", canWrite: false }))).toBe("blocked_suspended");
    expect(sucursalesBlockNotice(ent({ state: "read_only", canWrite: false }))).toContain("solo lectura");
    expect(sucursalesBlockNotice(ent({ state: "suspended", canWrite: false }))).toContain("suspendida");
    expect(sucursalesWriteBlock(null)).toBe("unexpected");
  });
});
