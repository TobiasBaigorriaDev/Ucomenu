/** Constantes del alta unificada de platos que también usa el navegador (sin dependencias de servidor). Ver `alta.ts`. */

/** Qué pieza del alta quedó sin guardar (viaja en la URL del editor, `?pendiente=`). */
export const ALTA_PENDING = ["foto", "opciones", "precios"] as const;
export type AltaPending = (typeof ALTA_PENDING)[number];

/** Prefijo de los campos del precio propio de una sucursal (`precio_<uuid>`). */
export const BRANCH_PRICE_FIELD = "precio_";

/** Lee `?pendiente=foto,precios`: solo las piezas conocidas, sin repetir y en el orden de siempre. */
export function parsePending(raw: string | string[] | undefined): AltaPending[] {
  const given = new Set((Array.isArray(raw) ? raw.join(",") : (raw ?? "")).split(","));
  return ALTA_PENDING.filter((piece) => given.has(piece));
}
