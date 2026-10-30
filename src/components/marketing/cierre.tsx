import Link from "next/link";
import { LegalLinks } from "@/components/legal/legal-links";
import { Mark } from "@/components/panel/mark";
import { LAYOUTS } from "@/lib/identidad/layouts";
import { PALETTES } from "@/lib/identidad/palettes";
import { IconArrow } from "./icons";
import { LOCALES } from "./imagenes";
import { Phone } from "./phone";
import { WhatsappLink } from "./whatsapp-link";

export function Cierre() {
  return (
    <section className="mk-close mk-on-green" aria-labelledby="cierre-titulo">
      <div className="mk-wrap">
        <h2 className="mk-h2 mk-center" id="cierre-titulo">
          Tu carta, lista para que la escaneen
        </h2>
        <p className="mk-lead mk-center">Escribinos por WhatsApp y empezá tu prueba de 14 días con el plan Pro.</p>
        <WhatsappLink className="mk-btn">
          Probalo 14 días gratis
          <IconArrow />
        </WhatsappLink>
        <p className="mk-close-note">Sin tarjeta de crédito · Sin instalar nada</p>
      </div>
      <Mark className="mk-close-mark" />
    </section>
  );
}

export function Pie() {
  return (
    <footer className="mk-foot">
      <div className="mk-wrap">
        <section className="mk-galeria" aria-labelledby="galeria-titulo">
          <h2 className="mk-h3" id="galeria-titulo">
            Y más abajo, la carta sigue
          </h2>
          <p className="mk-copy">Categorías, fotos, precios y opciones: así se lee cada carta después del inicio.</p>
          <div className="mk-galeria-fila" role="region" aria-label="Cartas de ejemplo, más abajo en la carta" tabIndex={0}>
            {LOCALES.map((l) => (
              <figure key={l.id}>
                <div className="mk-galeria-phone">
                  <Phone img={l.abajo} sizes="192px" />
                </div>
                <figcaption>
                  <strong>{l.nombre}</strong>
                  <span>
                    Estilo {LAYOUTS[l.estilo].name} · {PALETTES[l.paleta].name}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
        <div className="mk-foot-grid">
          <div>
            <Link href="/" className="mk-brand">
              <Mark />
              UcoMenu
            </Link>
            <p style={{ marginTop: "0.75rem" }}>La carta digital con QR y llamado al mozo para bares, cafés y restaurantes.</p>
          </div>
          <div>
            <ul>
              <li>
                <Link href="/login">Ingresar</Link>
              </li>
              <li>
                <WhatsappLink>Escribinos por WhatsApp</WhatsappLink>
              </li>
            </ul>
            <LegalLinks className="text-muted" />
          </div>
        </div>
        <p className="mk-small">© {new Date().getFullYear()} UcoMenu. Las capturas de esta página son de locales de ejemplo con platos y precios ficticios.</p>
      </div>
    </footer>
  );
}
