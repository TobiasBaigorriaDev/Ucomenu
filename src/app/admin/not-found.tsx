import { PantallaDeEstado } from "@/components/estado/pantalla-de-estado";

export default function AdminNotFound() {
  return (
    <PantallaDeEstado donde="marco" title="No encontramos eso en la administración" links={[{ href: "/admin", label: "Volver a Organizaciones" }]}>
      Puede que la organización ya no exista o que el enlace esté incompleto.
    </PantallaDeEstado>
  );
}
