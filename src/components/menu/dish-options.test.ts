import { describe, expect, it } from "vitest";
import type { MenuOptionGroup } from "@/lib/menu";
import { limitOptionGroups } from "./dish-options";

const group = (id: string, n: number): MenuOptionGroup => ({
  id, name: id, min_choices: 0, max_choices: n, sort_order: 0,
  options: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}`, name: `Opción ${i}`, price_delta_cents: 0, sort_order: i })),
}) as MenuOptionGroup;

describe("limitOptionGroups", () => {
  it("sin tope devuelve todo", () => {
    const groups = [group("a", 3), group("b", 12)];
    expect(limitOptionGroups(groups)).toEqual({ shown: groups, hidden: 0 });
  });

  it("con tope recorta en orden, el último grupo puede quedar parcial y se cuenta lo oculto", () => {
    const { shown, hidden } = limitOptionGroups([group("a", 4), group("b", 5)], 6);
    expect(shown.map((g) => g.options.length)).toEqual([4, 2]);
    expect(hidden).toBe(3);
  });

  it("un grupo que no entra se omite y un plato dentro del tope no oculta nada", () => {
    expect(limitOptionGroups([group("a", 6), group("b", 2)], 6).shown.map((g) => g.id)).toEqual(["a"]);
    expect(limitOptionGroups([group("a", 2), group("b", 3)], 6).hidden).toBe(0);
  });
});
