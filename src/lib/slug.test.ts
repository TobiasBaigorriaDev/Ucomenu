import { describe, expect, it } from "vitest";
import { isValidSlug, SLUG_MAX_LENGTH } from "./slug";

describe("isValidSlug", () => {
  it("acepta un slug de exactamente 64 caracteres", () => {
    expect(isValidSlug("a".repeat(SLUG_MAX_LENGTH))).toBe(true);
  });

  it("rechaza un slug de 65 caracteres", () => {
    expect(isValidSlug("a".repeat(SLUG_MAX_LENGTH + 1))).toBe(false);
  });

  it("acepta slugs comunes", () => {
    expect(isValidSlug("cafe-ejemplo")).toBe(true);
    expect(isValidSlug("sucursal-2")).toBe(true);
  });

  it.each(["", "-a", "a-", "a--b", "Cafe", "café", "a b", "a_b", "a/b", ".."])("rechaza %j", (value) => {
    expect(isValidSlug(value)).toBe(false);
  });
});
