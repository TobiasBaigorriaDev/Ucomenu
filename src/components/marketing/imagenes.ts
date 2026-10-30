/**
 * Capturas REALES del producto que usa la portada (public/portada/*). Las cartas de teléfono son capturas de locales de
 * ejemplo de staging («Bruma Bistró», «Fuego Andino», «La Bestia Burger & Bar», «Patio Oliva», «Aurelia Alta Cocina»); las del
 * panel son capturas propias de staging (Aurelia y La Bestia); la promoción y la sala salen de la réplica local de «Bruma Bistró» con `tools/demo-portada/capturar-bruma.mjs`. Procedencia en `public/portada/PROCEDENCIA.md`.
 */
export type Imagen = { src: string; w: number; h: number; alt: string };

const carta = (archivo: string, alt: string): Imagen => ({ src: `/portada/${archivo}.jpg`, w: 780, h: 1688, alt });

export const IMG = {
  // Inicio de cada carta (teléfono de 390 × 844 a 2×)
  bruma: carta("carta-bruma", "Carta de Bruma Bistró, un local de ejemplo, con el estilo Bento y la paleta Oliva: nombre con logo, buscador y categorías en mosaico con fotos."),
  fuegoAndino: carta("carta-fuego-andino", "Carta de Fuego Andino, un local de ejemplo, con el estilo Afiche y la paleta Cacao: título enorme y categorías en bandas de color."),
  laBestia: carta("carta-la-bestia", "Carta de La Bestia Burger & Bar, un local de ejemplo, con el estilo Afiche y la paleta oscura Carbón, abierta desde el QR de la Mesa 1 con los botones Llamar al mozo y Pedir la cuenta."),
  patioOliva: carta("carta-patio-oliva", "Carta de Patio Oliva, un local de ejemplo, con el estilo Bento, la paleta Trattoria y el tema de fecha especial de San Valentín, abierta desde el QR de la Mesa 1 con los botones Llamar al mozo y Pedir la cuenta."),
  aurelia: carta("carta-aurelia", "Carta de Aurelia Alta Cocina, un local de ejemplo, con el estilo Minimal y la paleta Monocromo, con los botones Llamar al mozo, Menufeed y Pedir la cuenta."),
  // Más abajo en cada carta (para el pie)
  brumaAbajo: carta("carta-bruma-abajo", "Bruma Bistró, más abajo en la carta: la categoría Principales con la foto de un lomo con espárragos, su precio y su descripción."),
  fuegoAndinoAbajo: carta("carta-fuego-andino-abajo", "Fuego Andino, más abajo en la carta: platos de la parrilla con foto grande, número, nombre, precio y etiqueta Sin TACC."),
  laBestiaAbajo: carta("carta-la-bestia-abajo", "La Bestia Burger & Bar, más abajo en la carta: la hamburguesa La Bestia con foto, precio, descripción y adicionales con su diferencia de precio."),
  patioOlivaAbajo: carta("carta-patio-oliva-abajo", "Patio Oliva, más abajo en la carta: la categoría Algo dulce y bebidas con tarta de frambuesa, helado artesanal y limonada, con precios."),
  aureliaAbajo: carta("carta-aurelia-abajo", "Aurelia Alta Cocina, más abajo en la carta: platos con foto grande y precio, uno de ellos marcado como agotado."),
  // Promoción y sala de Bruma Bistró (réplica local del local de staging; ver PROCEDENCIA.md)
  cartaPromo: carta("carta-promo", "Carta de Bruma Bistró, un local de ejemplo, con una promoción vigente: la panna cotta muestra el precio anterior tachado, el promocional y hasta qué hora rige el Happy Hour."),
  salaAnotar: carta("sala-anotar", "Pantalla del mozo con el pedido de la Mesa 2 de Bruma Bistró: platos anotados, botones Entregado, Modificar y Cancelar, y el total hasta ahora."),
  llamadoLlama: { src: "/portada/sala-llamado-llama.png", w: 916, h: 488, alt: "Tarjeta de la sala: la Mesa 2 llama al mozo, hace unos segundos, con el botón Atendido." },
  llamadoCuenta: { src: "/portada/sala-llamado-cuenta.png", w: 916, h: 488, alt: "Tarjeta de la sala: la Mesa 3 pide la cuenta, con el botón Atendido." },
  // Panel del Dueño (capturas propias de staging)
  panelPlato: { src: "/portada/panel-plato-aurelia.jpg", w: 1899, h: 933, alt: "Panel del Dueño de Aurelia Alta Cocina editando un plato, «Langostinos del Atlántico»: nombre, descripción, precio, categoría y foto." },
  panelColores: { src: "/portada/panel-colores-aurelia.png", w: 505, h: 672, alt: "Panel del Dueño, pantalla Apariencia: las doce paletas de colores con Monocromo elegida y la vista previa de la carta de Aurelia Alta Cocina." },
  panelCarta: { src: "/portada/panel-carta-la-bestia.jpg", w: 1894, h: 936, alt: "Panel del Dueño de La Bestia Burger & Bar, pantalla Carta: la categoría Burgers con sus platos, fotos y precios, y el menú lateral con todas las secciones del local." },
} as const satisfies Record<string, Imagen>;

/** Los cinco locales de ejemplo, con lo que muestra cada captura (para las pestañas de estilo y el pie). */
export const LOCALES = [
  { id: "bruma", nombre: "Bruma Bistró", paleta: "oliva", estilo: "bento", inicio: IMG.bruma, abajo: IMG.brumaAbajo },
  { id: "fuego-andino", nombre: "Fuego Andino", paleta: "cacao", estilo: "afiche", inicio: IMG.fuegoAndino, abajo: IMG.fuegoAndinoAbajo },
  { id: "la-bestia", nombre: "La Bestia Burger & Bar", paleta: "carbon", estilo: "afiche", inicio: IMG.laBestia, abajo: IMG.laBestiaAbajo },
  { id: "patio-oliva", nombre: "Patio Oliva", paleta: "trattoria", estilo: "bento", inicio: IMG.patioOliva, abajo: IMG.patioOlivaAbajo, nota: "Con el tema de fecha especial de San Valentín: decoración suave y un saludo, sin cambiar los colores ni tapar platos." },
  { id: "aurelia", nombre: "Aurelia Alta Cocina", paleta: "monocromo", estilo: "minimal", inicio: IMG.aurelia, abajo: IMG.aureliaAbajo },
] as const;
