import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalSection } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Términos de uso",
  description: "Condiciones para usar UcoMenu como comensal o como local.",
};

export default function TermsPage() {
  return (
    <LegalDocument
      title="Términos de uso"
      intro="Estas condiciones rigen el uso de UcoMenu, la plataforma de cartas digitales para restaurantes, bares y cafeterías. Al usar el servicio, aceptás lo que sigue."
    >
      <LegalSection title="1. Qué es UcoMenu">
        <p>
          UcoMenu les permite a los locales publicar su carta y recibir avisos de sus mesas, y a los comensales consultarla desde
          el celular. Cada carta pertenece al local que la publica; UcoMenu pone la plataforma.
        </p>
      </LegalSection>

      <LegalSection title="2. Si sos comensal">
        <ul>
          <li>Ver la carta es gratuito y no requiere cuenta.</li>
          <li>
            El botón de llamado es un aviso al personal, no una garantía de atención en un tiempo determinado. Usalo solo
            cuando necesites al mozo o la cuenta.
          </li>
          <li>
            Para evitar abusos, el sistema limita los llamados repetidos de una misma mesa y de una misma conexión. No intentes
            eludir esos límites ni llamar desde una mesa en la que no estás.
          </li>
          <li>
            Los precios, descripciones y fotos los carga el local: ante una diferencia, vale lo que te informe el personal en el
            salón.
          </li>
        </ul>
        <p>Si el local tiene videos, desde el QR de tu mesa también podés dejar un comentario. Al hacerlo:</p>
        <ul>
          <li>
            Sos responsable de lo que escribís. No publiques insultos, amenazas, contenido ilícito o engañoso, publicidad ni
            enlaces, y no incluyas datos personales tuyos ni de otras personas (teléfonos, direcciones, apellidos).
          </li>
          <li>
            Tu comentario <strong>no se publica hasta que el local lo aprueba</strong>. El local puede aprobarlo, rechazarlo o
            retirarlo cuando quiera, sin tener que explicarte por qué, y no está obligado a publicar nada.
          </li>
          <li>
            Si se aprueba, lo puede ver cualquier persona que abra los videos de esa carta, con el nombre que pusiste (o
            «Anónimo») y la fecha. Los comentarios que no se publican se borran solos pasado un tiempo, como explica la{" "}
            <Link href="/privacidad" className="underline underline-offset-2">
              política de privacidad
            </Link>
            .
          </li>
          <li>
            El sistema limita los envíos repetidos desde una misma conexión. No intentes eludir esos límites ni comentar desde
            una mesa en la que no estás.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Si sos un local">
        <ul>
          <li>
            Sos responsable de todo lo que publicás: nombres, descripciones, precios, fotos y la información de alérgenos y
            etiquetas dietarias. Tenés que contar con los derechos para usar las imágenes que subas.
          </li>
          <li>
            Cuidá las credenciales de tu equipo. Las acciones hechas con una cuenta se atribuyen a su titular. Si dejás de
            trabajar con una persona, dala de baja desde el panel.
          </li>
          <li>
            No uses el servicio para publicar contenido ilícito, engañoso o que infrinja derechos de terceros. Podemos
            suspender una carta que lo haga.
          </li>
          <li>
            Si tu plan incluye videos con comentarios, vos decidís cuáles se publican: revisalos antes de aprobarlos y retirá los
            que correspondan. Sos responsable de lo que aprobás, que queda publicado en tu carta. No apruebes contenido ilícito,
            ofensivo o que incluya datos personales de terceros.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Planes y vigencia">
        <p>
          Cada organización tiene un plan con sus límites y una fecha hasta la cual está al día. Los valores y las condiciones
          comerciales de cada plan se acuerdan al contratar.
        </p>
        <p>
          Si la suscripción vence, el servicio no se corta de golpe: hay un período de gracia, después la cuenta pasa a solo
          lectura (podés ver tus datos pero no modificarlos) y, si no se regulariza, se suspende la carta pública. Al
          regularizar el pago, todo vuelve a funcionar.
        </p>
      </LegalSection>

      <LegalSection title="5. Disponibilidad">
        <p>
          Hacemos lo posible para que el servicio esté disponible, pero no garantizamos que funcione sin interrupciones ni
          errores. Puede haber cortes por mantenimiento o por causas ajenas a nosotros (por ejemplo, la conexión del local o de
          sus proveedores). Por eso el llamado al mozo complementa al servicio en el salón y no lo reemplaza.
        </p>
      </LegalSection>

      <LegalSection title="6. Responsabilidad">
        <p>
          UcoMenu no es responsable por el contenido que publica cada local, ni por los comentarios que dejan los comensales ni
          por la decisión del local de aprobarlos, ni por la atención, los productos o la información de alérgenos que el
          local brinde. Si algún contenido publicado en una carta te afecta, avisanos y, de corresponder, pedimos al local que lo
          retire o lo retiramos. En la medida que la ley lo permita, nuestra responsabilidad se limita a los daños
          directos causados por un incumplimiento nuestro. Esto no excluye los derechos que la ley reconoce a los consumidores.
        </p>
      </LegalSection>

      <LegalSection title="7. Datos personales">
        <p>
          Cómo tratamos los datos está explicado en la{" "}
          <Link href="/privacidad" className="underline underline-offset-2">
            política de privacidad
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="8. Cambios y ley aplicable">
        <p>
          Podemos actualizar estas condiciones; la versión vigente es la de esta página, con su fecha. Se rigen por las leyes de
          la República Argentina y, ante un conflicto, intervendrán los tribunales competentes de ese país.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
