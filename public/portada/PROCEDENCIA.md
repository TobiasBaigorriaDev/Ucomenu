# Procedencia de las imágenes de la portada

Todas las imágenes de esta carpeta son **capturas del producto real** (la app corriendo), de locales de demostración
**ficticios**. Nada es de un cliente real. Hay cuatro orígenes:

1. **Cartas de teléfono (`carta-<local>.jpg` y `carta-<local>-abajo.jpg`):** capturas sacadas a mano por el usuario (2026-10-29) de
   los locales de ejemplo de staging, a 390 × 844 con relación de píxeles 2 (780 × 1688). Se convirtieron a JPG (calidad 86) sin
   recortar ni retocar. Los originales PNG están en `tools/demo-portada/mis-capturas/` (fuera de la publicación).
2. **Panel del Dueño (`panel-*`):** capturas sacadas a mano por el usuario (2026-10-29) de los paneles de los locales de ejemplo de
   staging (Aurelia Alta Cocina y La Bestia Burger & Bar), a 1899 × 933 y 1894 × 936 px (JPG calidad 88) y un recorte de 505 × 672 px
   (PNG). La de colores es chica: se muestra a su tamaño real, sin estirarla. No muestran correos ni datos de clientes.
3. **Promoción y sala (`carta-promo`, `sala-*`):** sacadas por Claude (2026-10-29) con
   `node tools/demo-portada/capturar-bruma.mjs` sobre una **réplica local de «Bruma Bistró»**: el mismo local de ejemplo de
   staging (mismo catálogo, fotos y mesas), cargado en el Supabase local con `tools/sembrar-demo-staging.mjs --prueba-local --local
   bruma-bistro`, con la paleta Oliva y el estilo Bento. No se tocó staging ni ninguna base remota. El script crea dos cuentas
   locales de ejemplo, una promoción, pedidos y llamados, y los borra al terminar. El logo de esa réplica es el del seed
   (una cloche), no el que cargó el usuario en staging.

4. **Carta de estilo Hoja (`carta-cafe-pdf*.jpg`):** sacadas por Claude (2026-10-30) con `node tools/demo-portada/capturar-pdf.mjs` sobre «Café
   Ejemplo» del Supabase **local** (estilo Hoja, paleta Cítrico, 390 × 844 a 2×, JPG calidad 88): una con la página entera y otra
   ampliada con un zoom de pellizco simulado. Ese local no está en staging. El script oculta un plato de prueba de la base local
   solo mientras captura y lo restaura. No se tocó ninguna base remota. El local no tiene fotos de platos: el estilo Hoja no las muestra.

**Fotos de platos:** son de Unsplash (licencia Unsplash: uso libre, también comercial, sin atribución obligatoria). Los
identificadores están en `FOTO` de `tools/demo/catalogo.mjs`. Los logos de los locales de ejemplo son insignias dibujadas con
formas simples o creadas para la demo, sin marcas de terceros.

| Archivo | Qué es | Origen |
| --- | --- | --- |
| `carta-bruma.jpg`, `carta-bruma-abajo.jpg` | Bruma Bistró: estilo Bento, paleta Oliva; inicio y más abajo | captura propia, staging |
| `carta-fuego-andino.jpg`, `carta-fuego-andino-abajo.jpg` | Fuego Andino: estilo Afiche, paleta Cacao | ídem |
| `carta-la-bestia.jpg`, `carta-la-bestia-abajo.jpg` | La Bestia Burger & Bar: estilo Afiche, paleta Carbón, desde el QR de la Mesa 1 | ídem |
| `carta-patio-oliva.jpg`, `carta-patio-oliva-abajo.jpg` | Patio Oliva: estilo Bento, paleta Trattoria, tema de San Valentín, desde el QR de la Mesa 1 | ídem |
| `carta-aurelia.jpg`, `carta-aurelia-abajo.jpg` | Aurelia Alta Cocina: estilo Minimal, paleta Monocromo, con el botón Menufeed | ídem |
| `carta-cafe-pdf.jpg`, `carta-cafe-pdf-abajo.jpg` | Café Ejemplo: estilo Hoja, paleta Cítrico; la página entera como llega al celular y ampliada con zoom 1,9 | captura local (`capturar-pdf.mjs`) |
| `carta-promo.jpg` | Bruma Bistró con el Happy Hour vigente: precio tachado, promocional y «Hasta las HH:MM» | réplica local |
| `sala-anotar.jpg` | Pantalla del mozo con el pedido abierto de la Mesa 2 | réplica local |
| `sala-llamado-llama.png`, `sala-llamado-cuenta.png` | Tarjetas de la sala (Mesa 2 llama al mozo, Mesa 3 pide la cuenta), recortadas hasta «Atendido» | réplica local |
| `panel-plato-aurelia.jpg` | Panel de Aurelia Alta Cocina editando «Langostinos del Atlántico» (tema Monocromo) | captura propia, staging |
| `panel-colores-aurelia.png` | Pantalla Apariencia: las 12 paletas, con Monocromo elegida, y la vista previa | captura propia, staging |
| `panel-carta-la-bestia.jpg` | Panel de La Bestia Burger & Bar, pantalla Carta: la categoría Burgers con platos, fotos y precios | captura propia, staging |
| `menufeed.mp4`, `menufeed-poster.jpg` | Muestra del feed de videos: video mudo de 6 s (H.264, 362 × 812 px, sin pista de audio) y su primer fotograma como imagen de portada | grabación propia del feed, recortada |
| `og.jpg` | Imagen para compartir (1200 × 630) | captura del hero de la propia portada |
| `presentacion.mp4` | Presentación horizontal narrada de UcoMenu | copia de `video/entregas/ucomenu-presentacion-youtube-narrado.mp4`; origen y licencias en `video/README.md` |
| `presentacion-poster.jpg`, `presentacion-es.vtt` | Fotograma y subtítulos de la presentación | fotograma a los 12 s y guion de `video/voz/guion.json` |

**Video del feed (`menufeed.mp4`):** el usuario grabó el feed en uso (`MuestraMenuFeed.mp4`, 14,9 s). Se publica **solo la parte
limpia**: los primeros 6 s (el clip «Bistec», 1/6). Desde ~7 s la grabación muestra clips con la marca de agua de TikTok de una cuenta
ajena (`@cookingwithcarrri`), que no se publican ni se dejan dentro del archivo: se recortó con el transcodificador de Windows
(`MediaTranscoder`, H.264, **sin pista de audio**: la versión con AAC dejaba un último paquete que Chrome no decodificaba y cortaba el video a los 6 s) y se movió el índice del archivo al inicio para que arranque rápido. El original queda solo en
`tools/demo-portada/mis-capturas/`. **A confirmar por el usuario:** que el clip «Bistec» sea propio o de uso libre. Además, ese clip es casi
estático, así que la muestra se parece a una imagen; ver `mis-capturas/README.md` para grabar una mejor.

**No se usa** `demostracionDeMenufeed.png` (feed de videos): el video de la captura trae una marca de agua de TikTok de una
cuenta ajena.

Para rehacer el tercer grupo: `pnpm db:start`, cargar `bruma-bistro` en local (`node --env-file=.env.local --env-file=.env.test.local
tools/sembrar-demo-staging.mjs --prueba-local --local bruma-bistro`), la app corriendo (`PORTADA_BASE` si no es el puerto 3000) y
`node tools/demo-portada/capturar-bruma.mjs`; después borrar `.next/cache/images` (el optimizador de imágenes guarda las viejas). La
imagen para compartir se rehace con `tools/demo-portada/og.mjs`. Las pruebas de RLS y E2E asumen el seed limpio: `pnpm db:reset`.
