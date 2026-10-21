"use client";

import { PantallaDeEstado } from "@/components/estado/pantalla-de-estado";

export default function SalaErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PantallaDeEstado donde="pagina" title="No pudimos cargar la sala" onRetry={reset} links={[{ href: "/", label: "Ir al inicio" }]}>
      Hubo un problema de nuestro lado. Probá de nuevo; si sigue sin cargar, avisá en el local por otro medio.
    </PantallaDeEstado>
  );
}
