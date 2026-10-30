import { DEMO_CARTA_PATH } from "@/lib/marketing/contacto";
import Link from "next/link";
import { IconArrow, IconCheck } from "./icons";
import { HeroFan } from "./hero-fan";
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
      <HeroFan />
      <p className="mk-demo-note mk-wrap">Capturas del producto real con locales de ejemplo: los platos y los precios son ficticios.</p>
    </header>
  );
}
