"use client";

import { PantallaDeEstado } from "@/components/estado/pantalla-de-estado";

export default function CartaErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PantallaDeEstado donde="pagina" title="No pudimos cargar la carta" onRetry={reset} links={[]}>
      Hubo un problema de nuestro lado. Revisá tu conexión e intentá de nuevo.
    </PantallaDeEstado>
  );
}
