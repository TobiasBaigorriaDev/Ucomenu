"use client";

import { useParams } from "next/navigation";
import { PantallaDeEstado } from "@/components/estado/pantalla-de-estado";

export default function PanelOrgNotFound() {
  const { org } = useParams<{ org: string }>();
  return (
    <PantallaDeEstado donde="marco" title="No encontramos eso en tu panel" links={[{ href: `/panel/${org}`, label: "Ir al resumen" }]}>
      Puede que ya no exista o que el enlace esté incompleto.
    </PantallaDeEstado>
  );
}
