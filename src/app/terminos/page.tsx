import type { Metadata } from "next";
import Link from "next/link";
import { LegalContactText, LegalEntityText, LegalPending } from "@/components/legal/legal-contact";
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
          el celular. Cada carta pertenece al local que la publica; UcoMenu pone la plataforma. La plataforma la opera{" "}
          <LegalEntityText />.
        </p>
        <p>
          UcoMenu muestra la información que carga cada local, tal como la cargó. No la elabora, no la verifica ni certifica que un
          plato cumpla una dieta o esté libre de un alérgeno.
        </p>
      </LegalSection>

      <LegalSection title="2. Si sos comensal">
        <ul>
          <li>Ver la carta es gratuito y no requiere cuenta.</li>
          <li>
            Las etiquetas dietarias (por ejemplo, «Sin TACC») las declara el local y no son una certificación. Si tenés una alergia,
            una intolerancia o celiaquía, consultá al personal antes de pedir: ver el{" "}
            <Link href="/alergenos" className="underline underline-offset-2">
              aviso de alérgenos
            </Link>
            .
          </li>
          <li>
            El botón de llamado es un aviso al personal, no una garantía de atención en un tiempo determinado. Usalo solo
            cuando necesites al mozo o la cuenta.
          </li>
          <li>
            Para evitar abusos, el sistema limita los llamados repetidos de una misma mesa y de una misma conexión. No intentes
            eludir esos límites ni llamar desde una mesa en la que no estás.
          </li>
          <li>
            Los precios, descripciones, fotos y etiquetas dietarias los carga el local. Si ves una diferencia entre la carta y lo
            que te informan o te cobran, avisá al personal en el momento y, si la información de la carta es incorrecta, reportala
            como indica la sección 7. Estas condiciones no limitan los derechos que la ley te reconoce como consumidor frente al
            local, que es quien vende y responde por el precio y los productos que ofrece.
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
            Sos responsable de todo lo que publicás: nombres, descripciones, precios, fotos y las etiquetas dietarias. Tenés que
            contar con los derechos para usar las imágenes que subas.
          </li>
          <li>
            Tenés que mantener actualizados los ingredientes, los precios y las etiquetas dietarias de tus platos. Revisalos cada
            vez que cambie una receta, un proveedor, una variante, un adicional o el precio, y corregí la carta en el momento. Las
            etiquetas valen para todas las sucursales donde se muestra el plato: si en alguna no se cumplen, ocultá el plato allí.
          </li>
          <li>
            Marcá una etiqueta solo si podés confirmarla para la receta vigente y para la forma real de prepararla en tu cocina,
            incluido el contacto con otros ingredientes (contaminación cruzada). Ante la duda, no la marques. Las etiquetas de
            UcoMenu no reemplazan ni certifican nada: cumplir las normas que te correspondan por tu actividad (alimentos,
            manipulación, enfermedad celíaca y las demás aplicables) es responsabilidad tuya.
          </li>
          <li>
            Si te avisan que algo de tu carta es incorrecto o puede poner en riesgo a un comensal, corregilo o retirá el plato de
            inmediato.
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
          regularizar el pago, todo vuelve a funcionar.{" "}
          <LegalPending>duración del período de gracia y aviso previo a la suspensión por falta de pago</LegalPending>
        </p>
        <p>
          UcoMenu también puede suspender o dar de baja una cuenta o una carta que incumpla estas condiciones, por ejemplo si
          publica contenido ilícito o información alimentaria que pueda poner en riesgo a las personas, avisando al local por el
          medio de contacto que tenga registrado cuando sea posible. Una baja no borra los datos del local de inmediato: el borrado
          definitivo es una decisión posterior y se rige por la{" "}
          <Link href="/privacidad" className="underline underline-offset-2">
            política de privacidad
          </Link>
          . <LegalPending>cómo y con qué aviso un local pide su baja, y qué pasa con la facturación al cancelar</LegalPending>
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
          <strong>El local</strong> es responsable de la información que carga y publica (platos, precios, ingredientes, etiquetas
          dietarias y fotos), de la preparación y calidad de sus productos, de la atención y de lo que aprueba como comentario.
        </p>
        <p>
          <strong>UcoMenu</strong> es responsable de sus propias obligaciones y actuaciones: operar la plataforma con diligencia, mostrar
          fielmente lo que el local cargó (sin alterarlo ni agregarle afirmaciones), actualizar la carta publicada cuando el local
          guarda un cambio, proteger los datos conforme a la política de privacidad y atender los reportes de la sección 7. Responde
          por los daños que causen sus propios incumplimientos y fallas técnicas, según la legislación aplicable.
        </p>
        <p>
          No garantizamos que el servicio funcione sin interrupciones (ver sección 5). Nada de lo dicho excluye ni limita la
          responsabilidad que la ley no permite excluir, ni los derechos que la Ley 24.240 de Defensa del Consumidor y demás
          normas reconocen a los consumidores.
        </p>
        <p>
          En la relación con los locales, nuestra responsabilidad se limita a los daños directos causados por un incumplimiento
          nuestro, en la medida que la ley lo permita.
        </p>
      </LegalSection>

      <LegalSection title="7. Reportar información incorrecta o riesgosa">
        <p>
          Si encontrás en una carta un dato incorrecto, una etiqueta que no corresponde, un precio distinto del que te cobran o
          cualquier información que pueda poner en riesgo la salud de alguien, avisá primero al personal del local y escribinos a{" "}
          <LegalContactText /> indicando el local, el plato y qué está mal. Los reportes sobre alimentos y salud los tratamos como
          prioritarios: pedimos al local que corrija o retire el plato y, si el riesgo es evidente, podemos suspender la carta
          mientras se resuelve. Como el contenido es del local, la corrección definitiva depende de él.{" "}
          <LegalPending>plazos internos de respuesta a los reportes y quién los atiende</LegalPending>
        </p>
      </LegalSection>

      <LegalSection title="8. Datos personales">
        <p>
          Cómo tratamos los datos está explicado en la{" "}
          <Link href="/privacidad" className="underline underline-offset-2">
            política de privacidad
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="9. Cambios y ley aplicable">
        <p>
          Podemos actualizar estas condiciones; la versión vigente es la de esta página, con su fecha. Los cambios no se aplican
          a lo ocurrido antes de que rijan. Si cambiamos algo que afecte de forma sustancial a los locales, se lo avisaremos por
          el medio de contacto que tengan registrado, y si no estás de acuerdo podés dejar de usar el servicio.{" "}
          <LegalPending>plazo de aviso previo de los cambios a los locales</LegalPending>
        </p>
        <p>
          Se rigen por las leyes de la República Argentina y, ante un conflicto, intervendrán los tribunales competentes de ese
          país, sin perjuicio de las reglas de competencia que la ley reconoce a los consumidores.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
