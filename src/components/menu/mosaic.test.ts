import { describe, expect, it } from "vitest";
import { mosaicLayout, TILE_AREA } from "./mosaic";

describe("mosaicLayout", () => {
  it("devuelve una forma por categoría", () => {
    for (let n = 0; n <= 30; n++) expect(mosaicLayout(n)).toHaveLength(n);
  });

  it("nunca deja huecos: el área total es par (2 columnas completas)", () => {
    for (let n = 1; n <= 30; n++) {
      const area = mosaicLayout(n).reduce((sum, shape) => sum + TILE_AREA[shape], 0);
      expect(area % 2, `n=${n}`).toBe(0);
    }
  });

  it("cada «alto» va seguido de dos chicos que cierran sus dos filas", () => {
    for (let n = 1; n <= 30; n++) {
      const shapes = mosaicLayout(n);
      shapes.forEach((shape, i) => {
        if (shape === "tall") expect(shapes.slice(i + 1, i + 3), `n=${n}`).toEqual(["small", "small"]);
      });
    }
  });

  it("casos chicos", () => {
    expect(mosaicLayout(1)).toEqual(["wide"]);
    expect(mosaicLayout(2)).toEqual(["small", "small"]);
    expect(mosaicLayout(3)).toEqual(["small", "small", "wide"]);
    expect(mosaicLayout(6)).toEqual(["small", "small", "wide", "tall", "small", "small"]);
  });
});
