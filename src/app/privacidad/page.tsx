import type { Metadata } from "next";
import { LegalContactText, LegalEntityText, LegalPending } from "@/components/legal/legal-contact";
import { LegalDocument, LegalSection } from "@/components/legal/legal-document";
import { WAITER_CALL_RETENTION_DAYS } from "@/lib/legal";
import { PENDING_RETENTION_DAYS, REJECTED_RETENTION_DAYS } from "@/lib/videos/retencion";

export const metadata: Metadata = {
  title: "Privacidad",
  description: "Qué datos trata UcoMenu, para qué, por cuánto tiempo y cómo ejercer tus derechos.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Política de privacidad"
      intro="UcoMenu es una carta digital para restaurantes, bares y cafeterías. Acá te contamos quién trata tus datos, cuáles, por cuánto tiempo y cómo podés ejercer tus derechos, según seas comensal o parte del equipo de un local."
    >
      <LegalSection title="1. Quién es el responsable y cómo contactarlo">
        <p>
          Responsable de los datos descritos en esta política: <LegalEntityText />.
        </p>
        <p>
          Contacto para consultas y para ejercer tus derechos: <LegalContactText />.
        </p>
        <p>
          La carta, los precios, las fotos, los videos y demás contenido pertenecen al local, que decide qué publica. Esta política
          se refiere a los datos personales que trata la plataforma.
        </p>
      </LegalSection>

      <LegalSection title="2. Si sos comensal">
        <p>
          Para ver la carta no tenés que crear una cuenta ni darnos ningún dato: alcanza con escanear el código QR de la mesa.
          La carta no usa cookies y, mientras la mirás, no guarda información en tu dispositivo. La única excepción es el «me gusta»
          de los videos, que se explica más abajo.
        </p>
        <p>
          Para que el local sepa qué platos interesan más, contamos cuántas veces se abre el detalle de cada plato. Es solo un
          número por plato y por día: no registramos quién lo abrió ni tu dirección IP, y no guardamos nada en tu dispositivo.
        </p>
        <p>
          Si el local tiene videos y escaneaste el QR de tu mesa, podés tocar «me gusta». <strong>Recién en ese momento</strong> tu
          navegador guarda en tu dispositivo un código aleatorio y la lista de videos que marcaste, para que cada dispositivo dé un
          solo «me gusta» por video y para mostrarte el corazón marcado cuando volvés. El servidor no guarda ese código sino un
          resultado de un solo sentido calculado a partir de él, junto con el video y la fecha; no guarda la mesa ni quién sos. Ese
          resultado se conserva mientras exista el video. Podés eliminar el código borrando los datos del sitio en tu navegador.
        </p>
        <p>
          En ese mismo caso también podés dejar un <strong>comentario</strong> sobre un video, con un nombre opcional (puede ser un
          apodo o quedar vacío). <strong>No escribas datos personales tuyos ni de otras personas</strong>, como teléfonos,
          direcciones o apellidos. Guardamos el texto, el nombre si lo pusiste, el video, la fecha y el estado del comentario.
          No guardamos la mesa ni nada en tu dispositivo.
        </p>
        <p>
          Un comentario <strong>no se publica hasta que el local lo aprueba</strong>: hasta entonces solo lo ven el dueño y el
          personal del local. Si lo aprueban, lo puede ver cualquier persona que abra los videos de esa carta, con el nombre que
          pusiste y la fecha, hasta que el local lo retire o se borre el video. Los comentarios rechazados se borran a los{" "}
          {REJECTED_RETENTION_DAYS} días y los que nadie revisa, a los {PENDING_RETENTION_DAYS} días. Como no guardamos quién sos,
          para pedir que se quite un comentario tuyo indicanos el local, el video y el texto (ver «Tus derechos»).
        </p>
        <p>
          <strong>Dirección IP y valores derivados.</strong> Para limitar abusos (llamados, «me gusta» y comentarios repetidos),
          el servidor transforma tu dirección IP con una clave secreta, mediante un cálculo de un solo sentido, y guarda solo el
          resultado, no la IP. Ese valor no te identifica por sí solo, pero quien tuviera la clave podría comprobar si una
          dirección concreta le corresponde; por eso lo tratamos como dato personal. En los «me gusta» y los comentarios se usa
          durante una hora y después se borra, pero la limpieza se hace al procesar el siguiente «me gusta» o comentario, así que
          si no hay actividad puede quedar guardado más tiempo hasta entonces.
        </p>
        <p>
          Como en cualquier sitio web, el servidor que te entrega la página y su proveedor de alojamiento pueden registrar datos
          técnicos de la conexión (por ejemplo, tu dirección IP y el navegador) en sus registros de funcionamiento y seguridad.
          UcoMenu no usa esos registros para identificarte ni para publicidad. El plazo de esos registros lo fija cada proveedor:{" "}
          <LegalPending>plazo de los registros de los proveedores de alojamiento</LegalPending>.
        </p>
      </LegalSection>

      <LegalSection title="3. Si llamás al mozo o pedís la cuenta">
        <p>Cuando tocás uno de esos botones guardamos:</p>
        <ul>
          <li>la mesa y el local desde donde se hizo el llamado;</li>
          <li>el tipo de llamado (mozo o cuenta), la hora y su estado (pendiente, atendido o vencido);</li>
          <li>
            un <strong>identificador de cliente derivado de tu dirección IP</strong>. No guardamos tu IP: el servidor la
            transforma con una clave secreta (un cálculo de un solo sentido) y conserva solo el resultado. Se trata como dato
            personal, como se explica arriba.
          </li>
        </ul>
        <p>
          El identificador sirve únicamente para limitar los llamados repetidos y evitar abusos. Estos registros se borran
          automáticamente a los {WAITER_CALL_RETENTION_DAYS} días y no se incluyen en nuestras copias de seguridad.
        </p>
      </LegalSection>

      <LegalSection title="4. Si sos dueño o parte del personal de un local">
        <p>Para ingresar al panel, a la sala o a la cocina tratamos:</p>
        <ul>
          <li>tu email y tu contraseña (la contraseña se guarda cifrada, no en texto legible);</li>
          <li>tu rol (dueño, personal o cocina) y el local al que pertenecés;</li>
          <li>una cookie de sesión, necesaria para mantener tu ingreso y que se usa solo con ese fin;</li>
          <li>
            si activás los avisos de llamados con la pestaña cerrada, los datos técnicos que tu navegador entrega para recibirlos
            (una dirección del servicio de notificaciones de tu navegador y claves de cifrado). Podés desactivarlos cuando quieras.
          </li>
        </ul>
        <p>
          También registramos quién hizo ciertos cambios, para que el local pueda revisarlos: qué persona atendió un llamado, quién
          anotó o cambió un pedido y quién modificó el precio de un plato. Los pedidos que el personal anota (mesa, platos y
          cantidades) no llevan datos que identifiquen al comensal, pero sus observaciones son texto libre y pueden mencionar, por
          ejemplo, una alergia que el comensal le indica al mozo para la cocina; el personal no debe escribir ahí datos personales
          que no hagan falta. Las acciones del equipo de UcoMenu sobre las organizaciones (por ejemplo, el
          alta de un local) quedan en un registro de auditoría que no se modifica.
        </p>
        <p>
          El dueño y el personal ven los comentarios que dejan los comensales en los videos de su local (los pendientes, los
          aprobados y los rechazados que todavía no se borraron) y deciden cuáles se publican.
        </p>
        <p>
          El local puede pedir que se corrija o se quite lo que haya cargado. Los datos de cobro del servicio (pagos registrados
          de cada local) los conserva UcoMenu como registro contable.
        </p>
      </LegalSection>

      <LegalSection title="5. Cuánto tiempo conservamos los datos">
        <ul>
          <li>
            Llamados al mozo o a la cuenta, con su identificador derivado de la IP: {WAITER_CALL_RETENTION_DAYS} días, con borrado
            automático.
          </li>
          <li>
            Comentarios de los videos: los rechazados, {REJECTED_RETENTION_DAYS} días; los que nadie revisa, {PENDING_RETENTION_DAYS}{" "}
            días; los aprobados, hasta que el local los retire o se borre el video o el local.
          </li>
          <li>
            «Me gusta» de los videos: el resultado derivado del código de tu dispositivo, mientras exista el video; el valor
            derivado de la IP, una hora.
          </li>
          <li>
            Pedidos cerrados o anulados: 2 años desde el cierre. <LegalPending>confirmar este plazo con un contador</LegalPending>
          </li>
          <li>
            Pagos registrados de cada local: 10 años desde el registro, aunque el local ya no exista, como registro contable.{" "}
            <LegalPending>confirmar este plazo con un contador</LegalPending>
          </li>
          <li>
            Cuenta, carta y datos de un local: mientras el local use el servicio. Si el local se da de baja, sus datos se conservan
            y el borrado definitivo lo decide el equipo de UcoMenu después de al menos 30 días de baja; el historial de precios se
            borra con el local. Las cuentas de acceso del personal no se borran automáticamente con el local:{" "}
            <LegalPending>definir cuándo se borran las cuentas de personas que quedan sin ningún local</LegalPending>
          </li>
          <li>
            Registro de auditoría: no se modifica; <LegalPending>plazo de conservación del registro de auditoría</LegalPending>
          </li>
          <li>
            Copias de seguridad: hacemos copias propias que incluyen las cuentas del personal y los datos de los locales (no los
            llamados), con acceso restringido. <LegalPending>plazo de conservación de las copias y cómo se cifran</LegalPending>
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Con quién compartimos los datos y dónde se guardan">
        <p>No vendemos ni cedemos datos personales. Para funcionar usamos proveedores que tratan datos por nuestra cuenta y solo para prestar el servicio:</p>
        <ul>
          <li>Supabase: base de datos, autenticación y archivos (fotos y logos).</li>
          <li>Fly.io: alojamiento de la aplicación.</li>
          <li>Mux: alojamiento y reproducción de los videos que publican los locales.</li>
          <li>
            El servicio de notificaciones de tu navegador (por ejemplo, el de Google, Apple o Mozilla), solo si el personal activa
            los avisos con la pestaña cerrada.
          </li>
          <li>Cloudflare, para el sistema de nombres de dominio (DNS) de la aplicación.</li>
          <li>
            Un proveedor de inteligencia artificial, solo si el local usa la sugerencia de traducciones o el resumen de la
            analítica: se envían los nombres y descripciones de su carta, o cifras agregadas de ventas, nunca datos personales de
            comensales. <LegalPending>proveedor de IA que se usará en producción</LegalPending>
          </li>
        </ul>
        <p>
          La base de datos y la aplicación están previstas en la región de São Paulo (Brasil), es decir, fuera de la Argentina; otros
          proveedores pueden tratar datos en otros países.{" "}
          <LegalPending>verificar con un abogado el marco para las transferencias internacionales (art. 12 de la Ley 25.326) y, si hace falta, los contratos con cada proveedor</LegalPending>
        </p>
        <p>
          Lo que un local publica en su carta, incluidos los comentarios que aprobó, lo puede ver cualquiera que abra esa carta.
          Solo entregaremos datos a una autoridad cuando la ley lo exija.
        </p>
      </LegalSection>

      <LegalSection title="7. Tus derechos y cómo ejercerlos">
        <p>
          Conforme a la Ley 25.326 de Protección de los Datos Personales, podés pedir acceso a tus datos personales y su
          rectificación, actualización o supresión.
        </p>
        <ul>
          <li>
            <strong>Cómo:</strong> escribí a <LegalContactText /> desde una dirección que podamos asociar a vos, explicá qué
            pedís y acreditá tu identidad. Si el dato no te identifica por sí solo (por ejemplo, un comentario o un llamado), indicá el
            local, el video o la mesa y el momento, para poder encontrarlo.
          </li>
          <li>
            <strong>Plazos legales:</strong> la ley fija 10 días corridos para responder un pedido de acceso y 5 días hábiles para
            rectificar, actualizar o suprimir (arts. 14 y 16). El acceso es gratuito a intervalos no inferiores a seis meses, salvo
            que acredites un interés legítimo.
          </li>
          <li>
            <strong>Límites:</strong> la supresión no procede si afecta derechos de terceros o si hay una obligación legal de
            conservar el dato (por ejemplo, los registros contables).
          </li>
          <li>
            Si el dato lo cargó un local (por ejemplo, un comentario ya publicado), podés pedirlo también al local, o a nosotros
            indicando el local, el video y el texto: lo retiramos o le pedimos al local que lo haga.
          </li>
        </ul>
        <p>
          La Agencia de Acceso a la Información Pública, en su carácter de órgano de control de la Ley 25.326, tiene la
          atribución de atender las denuncias y reclamos por incumplimientos de las normas de protección de datos personales.
        </p>
      </LegalSection>

      <LegalSection title="8. Cambios en esta política">
        <p>
          Si cambiamos qué datos tratamos o para qué, actualizamos este texto y la fecha de arriba. La versión vigente es siempre
          la que ves en esta página.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
