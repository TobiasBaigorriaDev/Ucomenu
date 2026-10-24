import { describe, expect, it } from "vitest";
import { parseResetInput, RESET_TEXT, resetFailureFromDb } from "./turno";

const ID = "00000000-0000-4000-8000-000000000001";

describe("reiniciar el turno de una mesa", () => {
  it("acepta un uuid de mesa, en minúsculas", () => {
    expect(parseResetInput({ tableId: ID })).toEqual({ tableId: ID });
    expect(parseResetInput({ tableId: ID.toUpperCase().replace("0000", "AAAA") })).toEqual({ tableId: ID.replace("0000", "aaaa") });
  });

  it("rechaza lo que no es un uuid o no es un objeto", () => {
    for (const raw of [null, undefined, "x", 3, [], [ID], {}, { tableId: "no-es-uuid" }, { tableId: 7 }, { tableId: `${ID} ` }]) {
      expect(parseResetInput(raw)).toBe("invalid");
    }
  });

  it("traduce el error de la base: mesa inexistente o ajena es 'table_gone'; el resto, inesperado", () => {
    expect(resetFailureFromDb("table_not_found")).toBe("table_gone");
    expect(resetFailureFromDb(" table_not_found ")).toBe("table_gone");
    expect(resetFailureFromDb("otra cosa")).toBe("unexpected");
    expect(resetFailureFromDb(undefined)).toBe("unexpected");
  });

  it("todos los fallos tienen un texto para la pantalla", () => {
    for (const reason of ["table_gone", "invalid", "unexpected"] as const) expect(RESET_TEXT[reason].length).toBeGreaterThan(10);
  });
});
