import Link from "next/link";
import { DEMO_CARTA_PATH, DEMO_CARTA_URL } from "@/lib/marketing/contacto";
import { IconArrow } from "./icons";
import { QrSvg } from "./qr-svg";

export function Demo() {
  return (
    <section className="mk-demo mk-on-green" aria-labelledby="demo-titulo">
      <div className="mk-wrap">
        <div className="mk-demo-grid">
          <div>
            <h2 className="mk-h2" id="demo-titulo">
              Escaneá y mirá una carta de verdad
            </h2>
            <p className="mk-copy">
              Esta es la carta de un local de ejemplo, la misma que ve un cliente al escanear el QR de su mesa. Los platos y los precios son ficticios.
            </p>
            <Link href={DEMO_CARTA_PATH} className="mk-btn mk-btn-light">
              Abrir la carta de ejemplo
              <IconArrow />
            </Link>
          </div>
          <div className="mk-qr-big">
            <QrSvg texto={DEMO_CARTA_URL} titulo="Código QR que abre la carta de ejemplo" />
            <strong>Apuntá la cámara del celular</strong>
            <span>Y abrí la carta como lo haría un cliente.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
