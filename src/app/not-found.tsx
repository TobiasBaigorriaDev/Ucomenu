import { PantallaDeEstado } from "@/components/estado/pantalla-de-estado";

export default function NotFound() {
  return (
    <PantallaDeEstado donde="pagina" title="No encontramos esta página" links={[{ href: "/", label: "Ir al inicio" }]}>
      El enlace puede estar incompleto o la página ya no existe.
    </PantallaDeEstado>
  );
}
