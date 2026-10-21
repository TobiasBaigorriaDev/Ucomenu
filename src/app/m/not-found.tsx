import { PantallaDeEstado } from "@/components/estado/pantalla-de-estado";

export default function CartaNotFound() {
  return (
    <PantallaDeEstado donde="pagina" title="No encontramos esta carta" links={[]}>
      El enlace puede estar incompleto o el local ya no la publica. Probá escaneando de nuevo el código QR de tu mesa.
    </PantallaDeEstado>
  );
}
