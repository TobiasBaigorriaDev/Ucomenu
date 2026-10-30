import Image from "next/image";
import { DEMO_CARTA_URL } from "@/lib/marketing/contacto";
import { IconArrow, IconCheck } from "./icons";
import { IMG } from "./imagenes";
import { Phone } from "./phone";
import { QrSvg } from "./qr-svg";
import { WhatsappLink } from "./whatsapp-link";

function Tildes({ items }: { items: string[] }) {
  return (
    <ul className="mk-ticks-start">
      {items.map((i) => (
        <li key={i}>
          <IconCheck />
          {i}
        </li>
      ))}
    </ul>
  );
}

const Cta = () => (
  <WhatsappLink className="mk-btn">
    Probalo 14 días gratis
    <IconArrow />
  </WhatsappLink>
);

export function Pasos() {
  return (
    <section className="mk-section" id="como-funciona" aria-labelledby="pasos-titulo">
      <div className="mk-wrap">
        <div className="mk-head">
          <h2 className="mk-h2 mk-center" id="pasos-titulo">
            La forma más fácil de manejar tu salón
          </h2>
          <p className="mk-lead mk-center">Un QR por mesa, un aviso en la pantalla del mozo y toda tu carta en un solo lugar.</p>
        </div>
        <div className="mk-steps">
          <div className="mk-step">
            <div className="mk-step-visual">
              <div className="mk-qr-card">
                <strong>Escaneá y mirá la carta</strong>
                <QrSvg texto={DEMO_CARTA_URL} titulo="Código QR de una carta de ejemplo" />
                <span>Mesa 1</span>
              </div>
              <Phone img={IMG.laBestia} sizes="216px" />
            </div>
            <div>
              <h3 className="mk-h3">Un QR por cada mesa</h3>
              <p className="mk-copy">Generás los QR de tus mesas desde el panel, los imprimís y listo. Tus clientes solo necesitan el celular.</p>
              <Tildes items={["Escanean con la cámara y la carta se abre al instante en el navegador.", "Sin app, sin registrarse y con una carta que se lee bien con una mano."]} />
              <Cta />
            </div>
          </div>

          <div className="mk-step mk-flip">
            <div className="mk-step-visual mk-sand">
              <div className="mk-qr-stack">
                <Image className="mk-float" src={IMG.llamadoLlama.src} alt={IMG.llamadoLlama.alt} width={IMG.llamadoLlama.w} height={IMG.llamadoLlama.h} sizes="352px" />
                <Image className="mk-float" src={IMG.llamadoCuenta.src} alt={IMG.llamadoCuenta.alt} width={IMG.llamadoCuenta.w} height={IMG.llamadoCuenta.h} sizes="352px" />
              </div>
            </div>
            <div>
              <h3 className="mk-h3">No pierdas ningún llamado</h3>
              <p className="mk-copy">En Mesas en vivo ves cada aviso con su mesa, su tipo y cuánto hace que espera. El mozo toca Atendido y sigue.</p>
              <Tildes items={["Alerta con sonido y aviso en el celular del mozo.", "Los llamados y el pedido abierto de cada mesa, en la misma tarjeta."]} />
              <Cta />
            </div>
          </div>

          <div className="mk-step">
            <div className="mk-step-visual">
              <Image className="mk-shot" src={IMG.panelCarta.src} alt={IMG.panelCarta.alt} width={IMG.panelCarta.w} height={IMG.panelCarta.h} sizes="(min-width: 900px) 540px, 92vw" quality={75} />
            </div>
            <div>
              <h3 className="mk-h3">Toda tu carta en un solo lugar</h3>
              <p className="mk-copy">Categorías, platos, variantes, adicionales, fotos, precios y promociones desde el panel, en el celular o en la compu. Un precio o un plato cambia en todos tus QR a la vez, y marcás agotado por sucursal sin borrar nada.</p>
              <Cta />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
