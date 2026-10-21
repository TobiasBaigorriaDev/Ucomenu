"use client";

import { useParams } from "next/navigation";
import { PantallaDeEstado } from "@/components/estado/pantalla-de-estado";

export default function PanelOrgErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { org } = useParams<{ org: string }>();
  return (
    <PantallaDeEstado donde="marco" title="No pudimos cargar esta pantalla" onRetry={reset} links={[{ href: `/panel/${org}`, label: "Ir al resumen" }]}>
      Es un problema de nuestro lado. Probá de nuevo y, si sigue, volvé al resumen.
    </PantallaDeEstado>
  );
}
