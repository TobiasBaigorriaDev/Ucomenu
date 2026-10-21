import { describe, expect, it } from "vitest";
import { parseBranchIds, splitByView } from "./vista";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("parseBranchIds", () => {
  it("acepta una lista de ids (sin repetir y en minúscula) y la lista vacía (= todas)", () => {
    expect(parseBranchIds([])).toEqual([]);
    expect(parseBranchIds([A, B])).toEqual([A, B]);
    expect(parseBranchIds([A, A.toUpperCase()])).toEqual([A]);
  });

  it("rechaza todo lo que no sea una lista de identificadores: nada llega a la base", () => {
    for (const raro of [null, undefined, "x", 4, {}, [1], ["no-es-uuid"], [A, null], [A, "' or 1=1 --"], Array.from({ length: 51 }, () => A)]) {
      expect(parseBranchIds(raro), JSON.stringify(raro)).toBeNull();
    }
  });
});

describe("splitByView", () => {
  const items = [
    { id: 1, branchId: A },
    { id: 2, branchId: B },
    { id: 3, branchId: A },
  ];

  it("vista vacía = todas: nada queda afuera", () => {
    expect(splitByView(items, [])).toEqual({ shown: items, others: [] });
  });

  it("con una vista, separa lo que mira de lo que no", () => {
    expect(splitByView(items, [B])).toEqual({ shown: [items[1]], others: [items[0], items[2]] });
    expect(splitByView(items, [A, B]).others).toEqual([]);
  });
});
