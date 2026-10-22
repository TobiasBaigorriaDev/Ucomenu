// `hls.js/light` (la variante liviana: sin subtítulos, audio alternativo ni EME) no publica tipos propios; es la misma API que el
// paquete principal. Ficha feed-de-videos.
declare module "hls.js/light" {
  import Hls from "hls.js";
  export default Hls;
}
