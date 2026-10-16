import type { Metadata } from "next";
import { LegalDocument, LegalSection } from "@/components/legal/legal-document";
import { WAITER_CALL_RETENTION_DAYS, contactEmail } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacidad",
  description: "Qué datos trata UcoMenu, para qué, por cuánto tiempo y cómo ejercer tus derechos.",
};

export default function PrivacyPage() {
  const email = contactEmail();

  return (
    <LegalDocument
      title="Política de privacidad"
      intro="UcoMenu es una carta digital para restaurantes, bares y cafeterías. Acá te contamos qué datos tratamos según seas comensal o parte del equipo de un local, y cómo podés ejercer tus derechos."
    >
      <LegalSection title="1. Si sos comensal">
        <p>
          Para ver la carta no tenés que crear una cuenta ni darnos ningún dato: alcanza con escanear el código QR de la mesa.
          La carta no usa cookies ni guarda información en tu dispositivo.
        </p>
        <p>
          Como en cualquier sitio web, el servidor que te entrega la página y su proveedor de alojamiento pueden registrar datos
          técnicos de la conexión (por ejemplo, tu dirección IP y el navegador) en sus registros de funcionamiento y seguridad.
          UcoMenu no usa esos registros para identificarte ni para publicidad.
        </p>
      </LegalSection>

      <LegalSection title="2. Si llamás al mozo o pedís la cuenta">
        <p>Cuando tocás uno de esos botones guardamos:</p>
        <ul>
          <li>la mesa y el local desde donde se hizo el llamado;</li>
          <li>el tipo de llamado (mozo o cuenta), la hora y su estado (pendiente, atendido o vencido);</li>
          <li>
            un <strong>identificador de cliente derivado de tu dirección IP</strong>. No guardamos tu IP: el servidor la
            transforma con una clave secreta (un cálculo de un solo sentido) y conserva solo el resultado. Sin esa clave no se
            puede volver a obtener tu IP a partir de él.
          </li>
        </ul>
        <p>
          El identificador sirve únicamente para limitar los llamados repetidos y evitar abusos. Estos registros se borran
          automáticamente a los {WAITER_CALL_RETENTION_DAYS} días.
        </p>
      </LegalSection>

      <LegalSection title="3. Si sos dueño o parte del personal de un local">
        <p>Para ingresar al panel o a la sala tratamos:</p>
        <ul>
          <li>tu email y tu contraseña (la contraseña se guarda cifrada, no en texto legible);</li>
          <li>tu rol (dueño o personal) y el local al que pertenecés;</li>
          <li>una cookie de sesión, necesaria para mantener tu ingreso y que se usa solo con ese fin.</li>
        </ul>
        <p>
          También registramos quién hizo ciertos cambios, para que el local pueda revisarlos: qué persona atendió un llamado y
          quién modificó el precio de un plato. Las acciones del equipo de UcoMenu sobre las organizaciones (por ejemplo, el alta
          de un local) quedan en un registro de auditoría que no se modifica.
        </p>
        <p>
          La carta, los precios, las fotos y demás contenido pertenecen al local, que decide qué publica. El local puede pedir
          que se corrija o se quite lo que haya cargado.
        </p>
      </LegalSection>

      <LegalSection title="4. Con quién compartimos los datos">
        <p>
          No vendemos ni cedemos datos personales. Para funcionar usamos proveedores de infraestructura (base de datos,
          autenticación y alojamiento de la aplicación) que tratan datos por nuestra cuenta y solo para prestar el servicio.
          Algunos de esos servidores pueden estar fuera de la Argentina. Solo entregaremos datos a una autoridad cuando la ley
          lo exija.
        </p>
      </LegalSection>

      <LegalSection title="5. Tus derechos">
        <p>
          Podés pedir acceso a tus datos personales, su rectificación, actualización o supresión, conforme a la Ley 25.326 de
          Protección de los Datos Personales.
          {email ? (
            <>
              {" "}
              Escribinos a{" "}
              <a href={`mailto:${email}`} className="underline underline-offset-2">
                {email}
              </a>{" "}
              y te respondemos dentro de los plazos que fija la ley.
            </>
          ) : (
            " Para hacerlo, contactá al equipo de UcoMenu por el medio por el que te dimos acceso al servicio."
          )}
        </p>
        <p>
          La Agencia de Acceso a la Información Pública, en su carácter de órgano de control de la Ley 25.326, tiene la
          atribución de atender las denuncias y reclamos por incumplimientos de las normas de protección de datos personales.
        </p>
      </LegalSection>

      <LegalSection title="6. Cambios en esta política">
        <p>
          Si cambiamos qué datos tratamos o para qué, actualizamos este texto y la fecha de arriba. La versión vigente es siempre
          la que ves en esta página.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
