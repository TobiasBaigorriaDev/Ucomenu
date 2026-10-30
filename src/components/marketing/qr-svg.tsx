import { qrMatrix, qrPath, qrViewSize } from "@/lib/mesas/qr";

/** QR de una dirección, con el mismo trazado que los QR de las mesas (`lib/mesas/qr.ts`). */
export function QrSvg({ texto, titulo }: { texto: string; titulo: string }) {
  const matriz = qrMatrix(texto);
  const lado = qrViewSize(matriz);
  return (
    <svg role="img" aria-label={titulo} viewBox={`0 0 ${lado} ${lado}`}>
      <path d={qrPath(matriz)} fill="currentColor" />
    </svg>
  );
}
