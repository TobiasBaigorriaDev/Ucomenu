"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const MOVIMIENTO_REDUCIDO = "(prefers-reduced-motion: reduce)";
const suscribirMovimiento = (alCambiar: () => void) => {
  const m = window.matchMedia(MOVIMIENTO_REDUCIDO);
  m.addEventListener("change", alCambiar);
  return () => m.removeEventListener("change", alCambiar);
};

/**
 * Muestra del feed de videos (grabación del producto real) dentro de un teléfono. Es un video mudo y en bucle:
 *  - solo se reproduce mientras está a la vista (no gasta batería ni datos fuera de pantalla);
 *  - no arranca solo si la persona pidió reducir el movimiento (`prefers-reduced-motion`);
 *  - lleva un botón para pausarlo o reproducirlo (un movimiento automático de más de 5 segundos tiene que poder detenerse);
 *  - el botón refleja lo que el video hace de verdad (eventos `play` y `pause`), no lo que la página quería que hiciera;
 *  - si el navegador no puede reproducirlo, se ve la imagen de portada y no hay botón.
 * El archivo está recortado a la parte sin material de terceros y sin pista de audio; ver `public/portada/PROCEDENCIA.md`.
 */
export function MenufeedVideo({ src, poster, label }: { src: string; poster: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [reproduciendo, setReproduciendo] = useState(false);
  const [fallo, setFallo] = useState(false);
  // Elección de la persona con el botón: true = quiere verlo, false = lo pausó, null = decide la página.
  const eleccion = useRef<boolean | null>(null);
  const reducida = useSyncExternalStore(suscribirMovimiento, () => window.matchMedia(MOVIMIENTO_REDUCIDO).matches, () => false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [fallo]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true; // los navegadores solo dejan reproducir solo un video mudo
    if (visible && (eleccion.current ?? !reducida)) v.play().catch(() => {});
    else v.pause();
  }, [visible, reducida, fallo]);

  const alternar = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      eleccion.current = true;
      v.play().catch(() => setFallo(true));
    } else {
      eleccion.current = false;
      v.pause();
    }
  };

  return (
    <div className="mk-feedvideo">
      {fallo ? null : (
        <button type="button" className="mk-feed-pausa" aria-pressed={!reproduciendo} onClick={alternar}>
          {reproduciendo ? "Pausar video" : "Reproducir video"}
        </button>
      )}
      <div className="mk-phone">
        <div className="mk-phone-screen">
          {fallo ? (
            <Image src={poster} alt={label} width={362} height={812} sizes="216px" />
          ) : (
            <video
              ref={ref}
              src={src}
              poster={poster}
              muted
              loop
              playsInline
              preload="metadata"
              width={362}
              height={812}
              aria-label={label}
              onPlay={() => setReproduciendo(true)}
              onPause={() => setReproduciendo(false)}
              onError={() => setFallo(true)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
