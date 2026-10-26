"use client";

import { PantallaDeEstado } from "@/components/estado/pantalla-de-estado";

export default function CocinaOrgErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PantallaDeEstado donde="marco" title="No pudimos cargar la cocina" onRetry={reset} links={[]}>
      Es un problema de nuestro lado. Probá de nuevo; si sigue sin cargar, avisá en el local por otro medio.
    </PantallaDeEstado>
  );
}
