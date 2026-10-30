import Image from "next/image";
import { IconPin, IconPlay } from "./icons";
import { IMG } from "./imagenes";
import { MenufeedVideo } from "./menufeed-video";
import { Phone } from "./phone";

export function Modulos() {
  return (
    <section className="mk-stage" aria-labelledby="modulos-titulo">
      <div className="mk-wrap">
        <div className="mk-head">
          <h2 className="mk-h2 mk-center" id="modulos-titulo">
            Mucho más que una carta digital
          </h2>
          <p className="mk-lead mk-center">Pedidos, promociones, analítica y varios idiomas, en el mismo panel y sin instalar nada más.</p>
        </div>
        <div className="mk-bento">
          <article className="mk-cell mk-cell-paper mk-s4 mk-cell-wide">
            <div>
              <div className="mk-cell-head">
                <h3>Pedidos que anota el mozo</h3>
                <span className="mk-tag">Pro</span>
              </div>
              <p>
                El mozo anota lo que le dicta el cliente, con variantes, adicionales y observaciones. La cocina ve cada plato, lo marca listo y la mesa avisa para entregarlo.
              </p>
              <p>El cliente no pide ni paga desde la carta: sigue siendo solo de consulta.</p>
              <ol className="mk-estados" aria-label="Estados de cada plato anotado">
                <li>
                  <span>Anotado</span>
                </li>
                <li>
                  <span>Listo</span>
                </li>
                <li>
                  <span>Entregado</span>
                </li>
              </ol>
            </div>
            <div className="mk-visual-phone mk-visual-phone-wide">
              <Phone img={IMG.salaAnotar} sizes="224px" />
              <Image className="mk-float" src={IMG.llamadoCuenta.src} alt={IMG.llamadoCuenta.alt} width={IMG.llamadoCuenta.w} height={IMG.llamadoCuenta.h} sizes="216px" />
            </div>
          </article>

          <article className="mk-cell mk-cell-paper mk-s2">
            <div className="mk-cell-head">
              <h3>Happy Hour programado</h3>
              <span className="mk-tag">Pro</span>
            </div>
            <p>Descuentos por día y horario que se prenden y se apagan solos. La carta muestra el precio anterior tachado y hasta cuándo rige.</p>
            <div className="mk-visual-phone">
              <Phone img={IMG.cartaPromo} sizes="224px" />
            </div>
          </article>

          <article className="mk-cell mk-cell-paper mk-s2">
            <div className="mk-cell-head">
              <h3>Analítica con resumen</h3>
              <span className="mk-tag">Pro</span>
            </div>
            <p>Qué platos se miran y se venden, cuáles no se piden y a qué hora llaman las mesas. Un resumen escrito con IA te sugiere qué probar.</p>
          </article>

          <article className="mk-cell mk-cell-paper mk-s2">
            <h3>En tres idiomas</h3>
            <p>Tu carta en español, inglés y portugués. La IA sugiere la traducción y vos la revisás antes de publicarla.</p>
            <ul className="mk-chips" aria-label="Idiomas disponibles">
              <li>Español</li>
              <li>English</li>
              <li>Português</li>
            </ul>
          </article>

          <article className="mk-cell mk-cell-paper mk-s2">
            <h3>Filtros por dieta</h3>
            <p>Cada plato puede llevar las etiquetas que declare tu local. No es una certificación: el cliente sigue consultando al personal.</p>
            <ul className="mk-chips" aria-label="Etiquetas dietarias">
              <li>Sin TACC</li>
              <li>Vegano</li>
              <li>Vegetariano</li>
            </ul>
          </article>


                    <article className="mk-cell mk-cell-paper mk-s2">
            <h3>Varias sucursales</h3>
            <p>Una sola carta, con la disponibilidad de cada sucursal: lo que se terminó en una sigue disponible en las otras.</p>
            <ul className="mk-chips" aria-label="Ejemplo de disponibilidad por sucursal">
              <li>
                <IconPin />
                Centro
              </li>
              <li className="mk-off">
                <IconPin />
                Sur · <s>Espresso</s> agotado
              </li>
            </ul>
          </article>

          <article className="mk-cell mk-cell-deep mk-s4 mk-on-green mk-cell-wide">
            <div>
              <div className="mk-cell-head">
                <IconPlay className="mk-cell-icon" />
                <h3>Videos cortos de tu local</h3>
                <span className="mk-tag">Pro</span>
              </div>
              <p>
                Un feed vertical dentro de tu carta, con los videos de tu salón y de tus platos: tus clientes los miran y, desde el QR de la mesa, les dan me gusta y los comentan. Los comentarios se publican
                cuando los aprobás. Hasta 10 videos publicados.
              </p>
            </div>
            <div className="mk-visual-video">
              <MenufeedVideo
                src="/portada/menufeed.mp4"
                poster="/portada/menufeed-poster.jpg"
                label="Muestra del feed de videos cortos de una carta: un video de un bistec con los botones de sonido, me gusta y comentarios, el nombre del plato y el botón Ver plato."
              />
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
