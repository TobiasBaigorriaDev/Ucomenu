import { PantallaDeEstado } from "@/components/estado/pantalla-de-estado";

export default function PanelNotFound() {
  return (
    <PantallaDeEstado donde="pagina" title="No encontramos esta página" links={[{ href: "/panel", label: "Ir a mis locales" }, { href: "/", label: "Ir al inicio" }]}>
      El enlace puede estar incompleto o puede que no tengas acceso a este local.
    </PantallaDeEstado>
  );
}
