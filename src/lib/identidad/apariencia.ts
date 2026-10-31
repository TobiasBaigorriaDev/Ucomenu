import type { CSSProperties } from "react";
import { ambientStyle, isAmbient, visibleAmbient, NO_AMBIENT, type Ambient } from "./ambientes";
import { DEFAULT_DENSITY, DEFAULT_SHAPE, isDensity, isShape, type Density, type Shape } from "./formas";
import { DEFAULT_FONT, FONTS, isFont, type Font } from "./tipografias";

/** Tipografía, forma, densidad y ambiente de la carta (ADR 0050). Todo es un conjunto cerrado; lo desconocido cae al predeterminado. */
export type Look = { font: Font; shape: Shape; density: Density; ambient: Ambient };
export const DEFAULT_LOOK: Look = { font: DEFAULT_FONT, shape: DEFAULT_SHAPE, density: DEFAULT_DENSITY, ambient: NO_AMBIENT };

type Row = { menu_font?: unknown; menu_shape?: unknown; menu_density?: unknown; menu_ambient?: unknown };

export function readLook(row: Row): Look {
  return {
    font: isFont(row.menu_font) ? row.menu_font : DEFAULT_FONT,
    shape: isShape(row.menu_shape) ? row.menu_shape : DEFAULT_SHAPE,
    density: isDensity(row.menu_density) ? row.menu_density : DEFAULT_DENSITY,
    ambient: isAmbient(row.menu_ambient) ? row.menu_ambient : NO_AMBIENT,
  };
}

/** Atributos `data-*` y variables CSS que van en el elemento `.carta`. Con un tema de fecha vigente, la textura permanente no se dibuja. */
export function lookProps(look: Look, themeActive: boolean): { attrs: Record<string, string | undefined>; style: CSSProperties } {
  const ambient = visibleAmbient(look.ambient, themeActive);
  return {
    attrs: { "data-fuente": look.font, "data-forma": look.shape, "data-densidad": look.density, "data-ambiente": ambient ?? undefined },
    style: { ...ambientStyle(ambient), "--titulo-escala": String(FONTS[look.font].scale) } as CSSProperties,
  };
}
