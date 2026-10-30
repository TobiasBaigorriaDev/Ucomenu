import Image from "next/image";
import { DEMO_CARTA_PATH } from "@/lib/marketing/contacto";
import Link from "next/link";
import { IconArrow, IconCheck } from "./icons";
import { IMG } from "./imagenes";
import { Phone } from "./phone";
import { WhatsappLink } from "./whatsapp-link";

const TILDES = ["14 días gratis con el plan Pro", "Sin tarjeta de crédito", "Sin instalar nada"];

export function Hero() {
  return (
    <header className="mk-hero">
      <div className="mk-wrap">
        <h1 className="mk-h1">
          Tu carta digital con QR <span className="mk-accent">que también llama al mozo</span>
        </h1>
        <p className="mk-lead">
          Dejá el PDF y la carta de papel. Tus clientes escanean el QR de la mesa, ven tu carta con tu logo y tus colores, y llaman al mozo o piden la cuenta con un
          toque. Sin app y sin hardware.
        </p>
        <ul className="mk-ticks">
          {TILDES.map((t) => (
            <li key={t}>
              <IconCheck />
              {t}
            </li>
          ))}
        </ul>
        <div className="mk-cta-row">
          <WhatsappLink className="mk-btn">
            Probalo 14 días gratis
            <IconArrow />
          </WhatsappLink>
          <Link href={DEMO_CARTA_PATH} className="mk-link">
            Ver una carta de ejemplo
            <IconArrow />
          </Link>
        </div>
      </div>
      <div className="mk-fan-wrap">
        <div className="mk-fan">
          <Phone img={IMG.aurelia} className="mk-p-l2" sizes="(min-width: 1100px) 210px, 20vw" />
          <Phone img={IMG.patioOliva} className="mk-p-r2" sizes="(min-width: 1100px) 210px, 20vw" />
          <Phone img={IMG.fuegoAndino} className="mk-p-l1" sizes="(min-width: 1100px) 250px, (min-width: 640px) 24vw, 50vw" />
          <Phone img={IMG.laBestia} className="mk-p-r1" sizes="(min-width: 1100px) 250px, (min-width: 640px) 24vw, 50vw" />
          <Phone img={IMG.bruma} className="mk-p-c" sizes="(min-width: 1100px) 300px, (min-width: 640px) 28vw, 62vw" priority />
          <Image src={IMG.llamadoLlama.src} alt={IMG.llamadoLlama.alt} width={IMG.llamadoLlama.w} height={IMG.llamadoLlama.h} sizes="(min-width: 1100px) 330px, 56vw" className="mk-float mk-float-a" />
          <Image src={IMG.llamadoCuenta.src} alt={IMG.llamadoCuenta.alt} width={IMG.llamadoCuenta.w} height={IMG.llamadoCuenta.h} sizes="(min-width: 1100px) 330px, 56vw" className="mk-float mk-float-b" />
        </div>
      </div>
      <p className="mk-demo-note mk-wrap">Capturas del producto real con locales de ejemplo: los platos y los precios son ficticios.</p>
    </header>
  );
}
