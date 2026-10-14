import { qrMatrix, qrPath, qrViewSize } from "@/lib/mesas/qr";

/**
 * QR dibujado en el servidor como SVG (un único trazado). Fondo blanco y módulos oscuros con la zona de silencio
 * de la norma, para que se lea también al imprimir. `data-qr-url` deja a las pruebas comprobar qué codifica.
 */
export function QrCode({ value, title, className }: { value: string; title: string; className?: string }) {
  const matrix = qrMatrix(value);
  const size = qrViewSize(matrix);

  return (
    <svg
      role="img"
      aria-label={title}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      data-qr-url={value}
      className={className}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={qrPath(matrix)} fill="#000" />
    </svg>
  );
}
