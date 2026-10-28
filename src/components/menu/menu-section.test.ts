import { describe, expect, it } from "vitest";
import { cardSpans, desktopLastSpan } from "./menu-section";

const con = { image_path: "a.jpg" };
const sin = { image_path: null };

describe("cardSpans", () => {
  it("el primer plato con foto es el destacado si hay al menos tres", () => {
    expect(cardSpans([con, sin, con, sin, sin])).toEqual(["featured", "normal", "normal", "normal", "normal"]);
  });

  it("sin foto en el primero, o con menos de tres platos, no hay destacado", () => {
    expect(cardSpans([sin, con, con])).toEqual(["normal", "normal", "tail"]);
    expect(cardSpans([con, con])).toEqual(["normal", "normal"]);
    expect(cardSpans([con])).toEqual(["tail"]);
  });

  it("una cola impar ocupa el ancho completo en el celular para no dejar un hueco", () => {
    expect(cardSpans([con, sin, sin, sin])).toEqual(["featured", "normal", "normal", "tail"]);
    expect(cardSpans([sin, sin, sin])).toEqual(["normal", "normal", "tail"]);
  });

  it("nunca altera el orden y devuelve una forma por plato", () => {
    for (let n = 0; n <= 12; n++) expect(cardSpans(Array.from({ length: n }, (_, i) => (i % 2 ? sin : con)))).toHaveLength(n);
  });
});

describe("desktopLastSpan", () => {
  it("completa la última fila después del destacado", () => {
    expect(desktopLastSpan([con, con, con])).toBe(1);
    expect(desktopLastSpan([con, con, con, con])).toBe(3);
    expect(desktopLastSpan([con, con, con, con, con])).toBe(2);
    expect(desktopLastSpan([con, con, con, con, con, con])).toBe(1);
  });

  it("completa la última fila sin destacado y conserva los casos pequeños", () => {
    expect(desktopLastSpan([sin, con, con, con])).toBe(3);
    expect(desktopLastSpan([sin, con, con, con, con])).toBe(2);
    expect(desktopLastSpan([con])).toBe(1);
    expect(desktopLastSpan([con, con])).toBe(1);
  });
});
