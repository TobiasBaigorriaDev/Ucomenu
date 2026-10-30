import Image from "next/image";
import { PALETTE_KEYS, PALETTES } from "@/lib/identidad/palettes";
import { IMG } from "./imagenes";
import { Phone } from "./phone";

export function Control() {
  return (
    <section className="mk-section" id="para-tu-local" aria-labelledby="control-titulo">
      <div className="mk-wrap">
        <div className="mk-head">
          <h2 className="mk-h2 mk-center" id="control-titulo">
            Tu carta siempre al día. Tu salón más ágil.
          </h2>
          <p className="mk-lead mk-center">Cambiás un precio en segundos, marcás lo que se terminó y tus clientes llaman al mozo sin levantar la mano.</p>
        </div>
        <div className="mk-control">
          <article className="mk-cell mk-cell-sand mk-a">
            <div>
              <h3 className="mk-h3">Tu carta, siempre al día</h3>
              <p className="mk-copy" style={{ marginTop: "0.75rem" }}>
                Cambiás un precio o pausás un plato desde el panel y ya está en todos los QR. Sin reimprimir nada.
              </p>
            </div>
            <div className="mk-visual">
              <Image className="mk-shot" src={IMG.panelPlato.src} alt={IMG.panelPlato.alt} width={IMG.panelPlato.w} height={IMG.panelPlato.h} sizes="(min-width: 900px) 640px, 92vw" quality={75} />
            </div>
          </article>

          <article className="mk-cell mk-cell-green mk-b mk-on-green">
            <div>
              <div className="mk-cell-head">
                <h3 className="mk-h3">Sin levantar la mano</h3>
                <span className="mk-tag">Pro</span>
              </div>
              <p className="mk-copy" style={{ marginTop: "0.75rem" }}>
                Desde el QR de la mesa tocan Llamar al mozo o Pedir la cuenta. El mozo lo ve en su pantalla, con sonido.
              </p>
            </div>
            <div className="mk-b-stage mk-visual">
              <Phone img={IMG.patioOliva} sizes="240px" />
              <Image className="mk-float" src={IMG.llamadoLlama.src} alt={IMG.llamadoLlama.alt} width={IMG.llamadoLlama.w} height={IMG.llamadoLlama.h} sizes="208px" />
            </div>
          </article>

          <article className="mk-cell mk-cell-mint mk-c">
            <div className="mk-c-grid">
              <div>
                <h3 className="mk-h3">Con tu cara</h3>
                <p className="mk-copy" style={{ marginTop: "0.75rem" }}>
                  Tu logo, una de 12 paletas de contraste verificado y cuatro estilos de carta. Se ve como tu local, no como el nuestro.
                </p>
                <ul className="mk-swatches" aria-label="Las 12 paletas de colores disponibles">
                  {PALETTE_KEYS.map((k) => (
                    <li key={k} title={PALETTES[k].name}>
                      <span style={{ background: PALETTES[k].background }} />
                      <span style={{ background: PALETTES[k].accent }} />
                      <span style={{ background: PALETTES[k].terra }} />
                      <span style={{ background: PALETTES[k].blush }} />
                    </li>
                  ))}
                </ul>
              </div>
              <Image className="mk-shot" src={IMG.panelColores.src} alt={IMG.panelColores.alt} width={IMG.panelColores.w} height={IMG.panelColores.h} sizes="(min-width: 900px) 560px, 92vw" quality={75} />
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
