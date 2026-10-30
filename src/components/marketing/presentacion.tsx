export function Presentacion() {
  return (
    <section className="mk-section mk-presentacion" aria-labelledby="presentacion-titulo">
      <div className="mk-wrap">
        <div className="mk-presentacion-intro">
          <h2 className="mk-h2" id="presentacion-titulo">Mirá UcoMenu en acción</h2>
          <p className="mk-copy">De la carta a la cocina, conocé cómo funciona en tu local.</p>
        </div>
        <video
          className="mk-presentacion-video"
          controls
          playsInline
          preload="none"
          poster="/portada/presentacion-poster.jpg"
          aria-label="Presentación de UcoMenu"
        >
          <source src="/portada/presentacion.mp4" type="video/mp4" />
          <track kind="subtitles" src="/portada/presentacion-es.vtt" srcLang="es" label="Español" />
          Tu navegador no puede reproducir el video. <a href="/portada/presentacion.mp4">Descargá la presentación</a>.
        </video>
      </div>
    </section>
  );
}
