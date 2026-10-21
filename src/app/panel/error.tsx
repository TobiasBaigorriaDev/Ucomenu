"use client";

import { PantallaDeEstado } from "@/components/estado/pantalla-de-estado";

export default function PanelErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PantallaDeEstado donde="pagina" title="No pudimos cargar el panel" onRetry={reset} links={[{ href: "/", label: "Ir al inicio" }]}>
      Hubo un problema de nuestro lado. Probá de nuevo; si sigue sin cargar, volvé más tarde.
    </PantallaDeEstado>
  );
}
