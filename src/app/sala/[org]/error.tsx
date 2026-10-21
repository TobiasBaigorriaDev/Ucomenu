"use client";

import { useParams } from "next/navigation";
import { PantallaDeEstado } from "@/components/estado/pantalla-de-estado";

export default function SalaOrgErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { org } = useParams<{ org: string }>();
  return (
    <PantallaDeEstado donde="marco" title="No pudimos cargar la sala" onRetry={reset} links={[{ href: `/panel/${org}`, label: "Ir al panel" }]}>
      Es un problema de nuestro lado. Probá de nuevo; si sigue sin cargar, avisá en el local por otro medio.
    </PantallaDeEstado>
  );
}
