"use client";

import { PantallaDeEstado } from "@/components/estado/pantalla-de-estado";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PantallaDeEstado donde="pagina" title="Algo salió mal" onRetry={reset} links={[{ href: "/", label: "Ir al inicio" }]}>
      Hubo un problema de nuestro lado. Probá de nuevo en un momento; si sigue pasando, volvé a intentarlo más tarde.
    </PantallaDeEstado>
  );
}
