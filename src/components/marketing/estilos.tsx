"use client";

import Image from "next/image";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { LAYOUTS } from "@/lib/identidad/layouts";
import { PALETTE_KEYS, PALETTES } from "@/lib/identidad/palettes";
import { LOCALES } from "./imagenes";

// Cinco locales de ejemplo, cada uno con su estilo y su paleta: son capturas del producto real (ver `public/portada/PROCEDENCIA.md`).
export function Estilos() {
  const base = useId();
  const [actual, setActual] = useState(0);
  const botones = useRef<(HTMLButtonElement | null)[]>([]);
  const v = LOCALES[actual];

  // Pestañas con flechas, Inicio y Fin (patrón de pestañas de WAI-ARIA).
  const teclas = (e: KeyboardEvent, i: number) => {
    const n = LOCALES.length;
    const destino = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i + n - 1) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (destino === null) return;
    e.preventDefault();
    setActual(destino);
    botones.current[destino]?.focus();
  };

  return (
    <section className="mk-section" aria-labelledby="estilos-titulo">
      <div className="mk-wrap">
        <div className="mk-head">
          <h2 className="mk-h2 mk-center" id="estilos-titulo">
            Elegí cómo se ve tu carta
          </h2>
          <p className="mk-lead mk-center">Cuatro estilos y doce paletas. Lo cambiás desde el panel y se ve en todos tus QR.</p>
        </div>
        <div className="mk-estilos">
          <div className="mk-estilo-phone" role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${v.id}`}>
            <div className="mk-phone">
              <div className="mk-phone-screen">
                <Image key={v.id} src={v.inicio.src} alt={v.inicio.alt} width={v.inicio.w} height={v.inicio.h} sizes="(min-width: 900px) 320px, 272px" quality={75} />
              </div>
            </div>
          </div>
          <div className="mk-estilo-info">
            <div role="tablist" aria-label="Locales de ejemplo" className="mk-tabs">
              {LOCALES.map((x, i) => (
                <button
                  key={x.id}
                  ref={(el) => {
                    botones.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${base}-tab-${x.id}`}
                  aria-selected={i === actual}
                  aria-controls={`${base}-panel`}
                  tabIndex={i === actual ? 0 : -1}
                  className="mk-tab"
                  onClick={() => setActual(i)}
                  onKeyDown={(e) => teclas(e, i)}
                >
                  {x.nombre}
                </button>
              ))}
            </div>
            <h3 className="mk-h3">
              Estilo {LAYOUTS[v.estilo].name}, paleta {PALETTES[v.paleta].name}
            </h3>
            <p className="mk-copy">{LAYOUTS[v.estilo].description}</p>
            {"nota" in v ? <p className="mk-copy">{v.nota}</p> : null}
            <ul className="mk-paleta-grid" aria-label="Las doce paletas">
              {PALETTE_KEYS.map((k) => (
                <li key={k}>
                  <span className="mk-swatch">
                    <span style={{ background: PALETTES[k].background }} />
                    <span style={{ background: PALETTES[k].accent }} />
                    <span style={{ background: PALETTES[k].terra }} />
                    <span style={{ background: PALETTES[k].blush }} />
                  </span>
                  {PALETTES[k].name}
                </li>
              ))}
            </ul>
            <p className="mk-demo-note" style={{ textAlign: "left" }}>
              Capturas de locales de ejemplo con platos ficticios.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
