import { describe, expect, it } from "vitest";
import { ORPHAN_UNCERTAIN_MESSAGE } from "./orphan-accounts";

describe("recuperación tras un resultado incierto", () => {
  it("dice que repetir es seguro y no usa la lista como prueba de que la cuenta se borró", () => {
    expect(ORPHAN_UNCERTAIN_MESSAGE).toContain("Repetirlo es seguro");
    expect(ORPHAN_UNCERTAIN_MESSAGE).toContain("si la cuenta sigue ahí, volvé a borrarla");
    expect(ORPHAN_UNCERTAIN_MESSAGE).not.toMatch(/si ya no aparece, se borró/);
  });
});
