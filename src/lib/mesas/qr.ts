import qrcode from "qrcode-generator";

/**
 * QR de una mesa. La codificación la hace `qrcode-generator` (MIT, sin dependencias; aprobada el 2026-10-14);
 * acá solo se arma la matriz y el trazado SVG. No se usa `createSvgTag`: así el SVG lo escribe React (sin
 * `dangerouslySetInnerHTML`) y la prueba puede comparar la matriz con el trazado.
 */

/** Zona de silencio mínima que exige la norma: 4 módulos. */
export const QUIET_ZONE = 4;

/** Matriz de módulos (`true` = oscuro). Corrección de errores M; versión automática. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => qr.isDark(row, col)));
}

/** Lado del dibujo en módulos, con la zona de silencio a cada lado. */
export const qrViewSize = (matrix: boolean[][]) => matrix.length + QUIET_ZONE * 2;

/** Un único trazado: cada módulo oscuro es un cuadrado de 1×1 (`M x y h1 v1 h-1 z`). */
export function qrPath(matrix: boolean[][]): string {
  const parts: string[] = [];
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`);
    }),
  );
  return parts.join("");
}
