import { describe, expect, it } from "vitest";
import { isAmbient } from "./ambientes";
import { isDensity, isShape } from "./formas";
import { isLayout } from "./layouts";
import { LOOK_KEYS, LOOKS, lookStyle, matchingLook, sameStyle } from "./looks";
import { isPalette } from "./palettes";
import { isFont } from "./tipografias";

describe("looks", () => {
  it.each(LOOK_KEYS)("%s: usa solo opciones que existen, con nombre y descripción", (key) => {
    const look = LOOKS[key];
    expect(isPalette(look.palette), "paleta").toBe(true);
    expect(isLayout(look.layout), "estilo").toBe(true);
    expect(isFont(look.font), "tipografía").toBe(true);
    expect(isShape(look.shape), "forma").toBe(true);
    expect(isDensity(look.density), "densidad").toBe(true);
    expect(isAmbient(look.ambient), "ambientación").toBe(true);
    expect(look.name.trim()).not.toBe("");
    expect(look.description.trim()).not.toBe("");
  });

  it("no hay dos looks iguales ni se puede confundir uno con otro", () => {
    for (const a of LOOK_KEYS) for (const b of LOOK_KEYS) {
      if (a !== b) expect(sameStyle(lookStyle(a), lookStyle(b)), `${a} y ${b}`).toBe(false);
    }
    for (const key of LOOK_KEYS) expect(matchingLook(lookStyle(key))).toBe(key);
  });

  it("una combinación propia no coincide con ningún look", () => {
    expect(matchingLook({ ...lookStyle("bar"), palette: "oliva" })).toBeNull();
  });
});
