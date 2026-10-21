"use client";

import { PantallaDeEstado } from "@/components/estado/pantalla-de-estado";

export default function AdminErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PantallaDeEstado donde="marco" title="No pudimos cargar esta pantalla" onRetry={reset} links={[{ href: "/admin", label: "Volver a Organizaciones" }]}>
      Es un problema de nuestro lado. Probá de nuevo o volvé a Organizaciones.
    </PantallaDeEstado>
  );
}
