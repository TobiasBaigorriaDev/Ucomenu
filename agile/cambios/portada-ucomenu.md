# Cambio: Portada de ucomenu.com
Estado: verificado en local (falta aprobación del usuario, staging y producción)
Nivel: M  <!-- Muestra planes y precios pero no cambia reglas de dinero ni permisos; los precios salen de la tabla `plans` -->

## Objetivo
Una portada de venta para dueños de bares, cafés y restaurantes, inspirada en la landing de Whataform (hero centrado con abanico de teléfonos, bento de beneficios, filas con QR, precios, cierre), con los colores de UcoNext y capturas **del producto real**. Acción principal: «Probalo 14 días gratis» por WhatsApp.

## Decisiones
- **Modo:** Persuade. Reemplaza `src/app/page.tsx`. Visitante típico: dueño no técnico que llega desde el celular.
- **Color:** paleta de plataforma (`PLATFORM_PALETTE`): verde `#155b20`, verde profundo `#0f4318`, celda `#dcebd3`, arena `#e8e6dc`, fondo `#f6f5f0`, tinta `#242621`. El verde vivo `#4a9e38` solo es decoración (rombos), nunca fondo de texto. Color plano, sin degradados de relleno ni sombras (filete fino); los tokens globales ya están alineados.
- **Tipografía (aprobada 2026-10-28):** Schibsted Grotesk 800, apretada, para titulares; Schibsted Grotesk 400–600 para el resto. Sin Gloock en la portada.
- **Alcance de estilos:** la portada queda fuera de `.carta` y `.panel`; usa un alcance propio (`.marketing`) y no toca los tokens del panel ni de la carta.
- **CTA (2026-10-28):** WhatsApp `+54 9 2622 23-0125` → `https://wa.me/5492622230125?text=…` con mensaje prellenado «Hola, quiero probar UcoMenu 14 días gratis con mi local». Un solo lugar de configuración para el número. *Supuesto a confirmar: prefijo +54 9 (celular argentino).*
- **Prueba de 14 días con el plan Pro (2026-10-28):** la oferta comercial es Pro. Hoy el trigger de alta crea una prueba de Básico, pero el alta del SuperAdmin ya permite elegir plan y fecha de fin (migración `20261014210000`), así que se cumple sin código: dar de alta el local en Pro con vencimiento a 14 días. `docs/producto.md` actualizado en ese punto.
- **Precios anteriores (histórico):** Básico USD 20 y Pro USD 40 (mensual) o USD 190 y 380 (anual). `plans` exige sesión y la portada es pública, así que los valores viven en `src/lib/marketing/planes.ts` y `tests/rls/portada-planes.rls.test.ts` falla si se separan de la tabla (en lugar de leerla con la clave de servicio o abrirla con una migración). Premium como «Próximamente», sin precio. Sucursal adicional (ARS 12.000/mes, solo Pro) en letra chica.
- **Prueba social:** sin testimonios, logos ni cifras inventadas. La prueba es el producto: capturas reales y una carta de ejemplo abierta con QR. Todo dato de demostración se rotula «local de ejemplo».
- **Capturas:** salen del producto corriendo en local con un local ficticio bien cargado (varias categorías, platos con foto, un llamado pendiente, un pedido abierto). Se guardan en `public/portada/`, y el marco del teléfono es CSS, no imagen.
- **No copiar de Whataform:** pedidos por WhatsApp, delivery, pagos online, comisiones. UcoMenu es solo consulta; los pedidos los anota el mozo.

## Estructura y copy (es-AR, voseo)
1. **Navegación** (píldora fija arriba): UcoMenu · Cómo funciona · Para tu local · Precios · Preguntas · Ingresar · **Probalo gratis**. En celular queda el CTA en la barra fija superior (sin barra inferior).
2. **Hero.** Etiqueta: «Dejá el PDF y la carta de papel». Título: «Tu carta digital con QR / **que también llama al mozo**». Subtítulo: «Tus clientes escanean el QR de la mesa, ven tu carta con tu logo y tus colores, y llaman al mozo o piden la cuenta con un toque. Sin app y sin hardware.» Tres tildes: *14 días gratis con el plan Pro · Sin tarjeta de crédito · Sin instalar nada*. Botón **«Probalo 14 días gratis»** y enlace «Ver una carta de ejemplo». Debajo, abanico de 3 a 5 teléfonos con la carta de locales de ejemplo en distintas paletas y estilos, más tarjetas flotantes: «Mesa 7 llama al mozo», «Pidió la cuenta» y un QR. En celular, el teléfono central con las puntas de los laterales sangrando y una sola tarjeta.
3. *(Eliminada tras la revisión: repetía los tildes del hero.)*
4. **«Todo bajo control».** Título: «Tu carta siempre al día. Tu salón más ágil.» Subtítulo: «Cambiás un precio en segundos, marcás lo que se terminó y tus clientes llaman al mozo sin levantar la mano.» Tres tarjetas con captura real:
   - *Tu carta, siempre al día:* «Cambiás un precio o pausás un plato y ya está en todos los QR. Sin reimprimir nada.»
   - *Sin levantar la mano:* «Desde el QR de la mesa tocan Llamar al mozo o Pedir la cuenta. El mozo lo ve en su pantalla, con sonido.»
   - *Con tu cara:* «Tu logo y una de 12 paletas de contraste verificado. Tu carta se ve como tu local.»
5. **«Mucho más que una carta digital»** (bloque `#dcebd3` con bento, una celda en verde profundo): *Pedidos que anota el mozo* (el mozo anota en la mesa, la cocina marca cada plato listo y la mesa avisa) · *Happy Hour programado* (descuentos por día y horario que se prenden y apagan solos) · *Analítica con resumen* (platos más vistos y vendidos, llamados por hora, resumen escrito por IA) · *En tres idiomas* (traducción sugerida por IA que revisás antes de publicar) · *Filtros por dieta* (Sin TACC, vegano, vegetariano, según lo que declares) · *Varias sucursales* (una carta, disponibilidad por sucursal) · *Videos de tu local* con etiqueta «Pronto». Etiqueta «Pro» en los que corresponde.
6. **«Así de simple»** (tres filas alternadas, CTA después de cada una): *Un QR por cada mesa* · *No pierdas ningún llamado* (Mesas en vivo con mesa, tipo y espera; «Atendido») · *Toda tu carta en un solo lugar* (panel desde el celular o la compu).
7. **«Elegí cómo se ve tu carta».** Selector real de estilo (bento, clásica, minimal, afiche) y paleta (12), con vista previa de una carta de ejemplo.
8. **«Probalo vos».** «Escaneá y mirá una carta de verdad. Es un local de ejemplo: platos y precios ficticios.» QR en escritorio, botón en celular.
9. **Precios (diseño anterior):** «Un precio fijo por mes. Probás 14 días con el plan Pro, sin tarjeta.» Selector mensual/anual (ahorro anual: USD 50 en Básico, USD 100 en Pro). Tarjetas Básico, Pro (con «Prueba de 14 días») y Premium «Próximamente: fidelización por sellos y videos». Nota: precios en dólares, se abonan en pesos al equivalente.
10. **Preguntas frecuentes (8):** ¿tienen que instalar algo? · ¿pueden pedir y pagar desde la carta? (no, solo consulta; el mozo anota) · ¿cambio precios yo? · ¿y los alérgenos? (etiquetas declaradas por el local, no una certificación) · ¿cuántas sucursales y mesas? · ¿cómo empiezo? · ¿qué pasa al terminar los 14 días? · ¿necesito hardware?
11. **Cierre** (verde pleno): «Tu carta, lista para que la escaneen.» «Escribinos por WhatsApp y empezá tu prueba de 14 días con el plan Pro. Sin tarjeta de crédito.»
12. **Pie:** marca, `LegalLinks`, Ingresar, WhatsApp.

## Capturas necesarias (producto real, 390 px y escritorio)
Carta pública en 4–5 paletas y los 4 estilos · carta de mesa con el dock «Llamar al mozo / Pedir la cuenta» · Mesas en vivo con un llamado «Mesa 7» · pantalla de cocina · Apariencia (paleta y vista previa) · Promociones · Analítica con resumen · QR imprimible · cuenta del cliente. **Bloqueo:** el seed tiene pocos platos y casi sin fotos; hacen falta 10 a 15 fotos de platos con derechos de uso para el local de ejemplo.

## Aceptación
- [x] Dado un visitante en 390 px, cuando abre `/`, entonces ve titular, subtítulo, tildes y el botón de WhatsApp sin scroll horizontal, y el botón abre WhatsApp con el mensaje prellenado.
- [x] Dado un visitante en 1440 px, cuando abre `/`, entonces ve el abanico de teléfonos con capturas reales, rotuladas como local de ejemplo.
- [ ] Conciliar los precios de la portada en pesos con el catálogo `plans`, que sigue en USD; la prueba RLS comprueba los límites. Premium no muestra precio.
- [x] Ninguna afirmación promete pedidos del cliente, pagos online, alérgenos por plato ni funciones no implementadas sin la etiqueta «Pronto».
- [ ] Contraste AA, objetivos táctiles de 44 px, foco visible y `prefers-reduced-motion` respetado. *(Diseñado así —botones y píldoras de 44 px o más, foco propio, animaciones solo con `no-preference`—, pero no se midió el contraste con herramienta; pendiente.)*
- [x] El botón de «Probalo vos» abre una carta pública real. *(El QR codifica `NEXT_PUBLIC_SITE_URL` + la ruta de la demo: en local apunta al dominio definitivo, que todavía no sirve la app; ver «Antes de publicar».)*
- [x] Título, descripción e imagen para compartir (es-AR); sin dependencias nuevas.
- [x] Las rutas `/m`, `/t`, `/panel` y `/sala` no cambian de aspecto (usan sus propias paletas; los tokens globales solo alcanzan a la portada, los textos legales y las pantallas de estado). La prueba `identidad.spec` fijaba el fondo global anterior: se actualizó a `#f6f5f0`.

## Fuera de alcance
- Autoregistro, pasarela de pago, formulario de contacto, blog, página de precios aparte, versión en inglés.
- Renombrar `--cobalt`; publicar en producción (el DNS de ucomenu.com aún no apunta a la app).

## Evidencia
Sin commit todavía (árbol de trabajo local, 2026-10-28).
- **Colores:** íconos PWA, `themeColor`, manifiesto y tokens globales alineados al verde de UcoNext; `palettes.test.ts` 23 verdes.
- **Verificado:** `pnpm typecheck`, eslint de lo nuevo, `pnpm test` (79 archivos, 1220 casos), `pnpm build`, `pnpm test:rls portada-planes` (2) y E2E `portada.spec` (8) más `legal.spec` (17) en verde con 4 workers; `identidad.spec` verde (la prueba de «publica» pasa sola; con la máquina cargada se pasó una vez de tiempo).
- **Visual:** revisión en 1440 y 390 px sin desborde; revisión independiente (`impeccable-finish-reviewer`) con disposición *fix*; sus ocho correcciones se aplicaron (abanico que sangra, hero móvil, tarjetas de la sala recortadas, hueco del bento, franja repetida eliminada, capturas del panel legibles, procedencia, lista de despliegue). No hubo segunda revisión.
- **Documentado:** `DESIGN.md` y `.impeccable/design.json` (tercera superficie «Portada»), brief en `.impeccable/surfaces/src-app-page-tsx.md`, procedencia en `public/portada/PROCEDENCIA.md`.
- **No corrido:** la suite E2E completa con 11 workers (con la caché de imágenes fría y la máquina saturada, pruebas de la carta y de legales pasaron de tiempo; con 4 workers pasan), contraste AA con herramienta, `pnpm test:rls` completo, producción.

## Capturas propias (2026-10-29)
- El usuario sacó a mano cinco cartas de locales de ejemplo de staging (Bruma Bistró, Fuego Andino, La Bestia Burger & Bar, Patio Oliva, Aurelia Alta Cocina; paletas Oliva, Cacao, Carbón, Trattoria y Monocromo, estilos Bento, Afiche y Minimal) y sus versiones «más abajo». Reemplazan las del hero y de las pestañas de estilo; las «más abajo» van en una galería del pie («Y más abajo, la carta sigue»). La carta desde el QR de la mesa (Control B y paso 1) usa Patio Oliva y La Bestia. Procedencia en `public/portada/PROCEDENCIA.md`.
- Se descartó `demostracionDeMenufeed.png` (marca de agua de TikTok de una cuenta ajena).
- **Panel (2026-10-29):** el usuario pasó tres capturas propias de staging que reemplazan las de la demo local: el editor de un plato (Aurelia) en «Tu carta, siempre al día», las paletas (Aurelia, 505 × 672 px, se muestra a su tamaño real) en «Con tu cara» y la lista de platos de La Bestia en «Toda tu carta en un solo lugar». La promoción y la sala siguen saliendo de una **réplica local de «Bruma Bistró»** (mismo catálogo, fotos y mesas que en staging; `tools/sembrar-demo-staging.mjs --prueba-local`), sin tocar staging ni credenciales: los locales de staging no tienen cuentas de Dueño ni de mozo y escribir ahí exige aprobación. Script: `tools/demo-portada/capturar-bruma.mjs`. Pendiente solo, opcional, una captura del feed de videos sin marcas de agua ajenas.
- Verificado tras el cambio: `pnpm typecheck`, eslint, 1222 pruebas unitarias y la RLS de planes en verde; revisión visual en 1440 y 390 px sin desborde, desde un servidor de desarrollo propio en el puerto 3200. **No corrido:** E2E ni el build (en el puerto 3000 corre un `next start` ajeno con una compilación vieja y reconstruir `.next` lo rompería); la prueba de pestañas se actualizó a los nombres de los locales y se agregó una del pie.

## Ajuste de estados de pedidos (2026-10-29)
- Se compactó la secuencia «Anotado → Listo → Entregado» para que permanezca en una línea. En el servidor local del puerto 3200 se comprobó con Playwright que los tres estados comparten altura y no desbordan a 320, 390, 900, 1200 y 1440 px; diff sin commit.

## Video del feed (2026-10-29)
- La celda «Videos cortos de tu local» muestra una muestra real del feed en un teléfono: `public/portada/menufeed.mp4` (6 s, mudo, en
  bucle) con su imagen de portada. Se reproduce solo cuando está a la vista, no arranca con «reducir movimiento» y lleva un botón para
  pausarlo; el botón refleja lo que el video hace de verdad y, si el navegador no puede reproducirlo, se muestra la imagen de portada. Componente: `src/components/marketing/menufeed-video.tsx`.
- Defecto corregido (2026-10-29): el video «no se reproducía o se pausaba». Causa verificada en Chrome: el recorte traía una pista de audio AAC cuyo último paquete daba `PIPELINE_ERROR_DECODE` y detenía el video a los ~6 s; además el umbral de visibilidad (35 %) lo pausaba en pantallas bajas y el botón mentía sobre el estado. Ahora el archivo no tiene audio, el umbral es 15 % y el botón sigue los eventos `play`/`pause`. Evidencia: `e2e/portada.spec.ts` pasa en Chromium y en Chrome instalado (22/22) contra un `next dev`.
- El video que pasó el usuario (14,9 s) muestra, desde ~7 s, clips con marca de agua de TikTok de una cuenta ajena: se publicó solo
  la parte limpia (primeros 6 s) y el original no está en `public/`. Falta confirmar que el clip «Bistec» sea propio o libre, y conviene
  regrabar una muestra con deslizar, me gusta y «Ver plato» usando clips propios (ver `mis-capturas/README.md`).

## Antes de publicar (checklist)
- [ ] Crear el local de ejemplo en el entorno publicado o fijar `NEXT_PUBLIC_DEMO_CARTA_PATH`; sin eso «Ver una carta de ejemplo» y el QR de «Probalo vos» dan 404.
- [ ] Fijar `NEXT_PUBLIC_SITE_URL` al dominio definitivo (el QR de la demo lo usa).
- [ ] Confirmar el número de WhatsApp (se asumió +54 9 2622 23-0125) y el mensaje.
- [ ] Dar de alta cada local nuevo en Pro con vencimiento a 14 días desde SuperAdmin (la oferta de la portada).
- [ ] Si cambian precios o límites en `plans`, actualizar `src/lib/marketing/planes.ts` (la prueba de paridad avisa).
- [ ] Si se rehacen las capturas de la promoción y la sala: cargar `bruma-bistro` en local (`tools/sembrar-demo-staging.mjs --prueba-local`), `node tools/demo-portada/capturar-bruma.mjs` y borrar `.next/cache/images`; la imagen para compartir, con `tools/demo-portada/og.mjs`.
- [ ] Desplegar a staging solo con aprobación del usuario.

## Preguntas abiertas
- Fotos de platos para el local de ejemplo (propias, o libres de derechos).
- Confirmar el prefijo del WhatsApp y el copy.
- `docs/producto.md` dice «tres estilos de carta»; `DESIGN.md` y el código tienen cuatro (bento, clásica, minimal, afiche). Verificar al construir.

## Precios mensuales en pesos (2026-10-29)
- El usuario indicó Básico ARS 14.900 y Pro ARS 29.000. La portada muestra esos importes mensuales y retira la opción anual hasta contar con precios anuales definidos.
- El catálogo `plans` y la facturación siguen en USD: conciliar antes de publicar; no se modificaron datos ni reglas de cobro. Prueba unitaria de la portada: 5/5.

- Opción anual retomada: Básico ARS 143.040 (equivale a ARS 11.920 mensuales). Pro queda como consultar hasta resolver la discrepancia entre ARS 287.040 anuales y ARS 23.020 mensuales indicados por el usuario.

- Cierre: los rombos se ubicaron debajo del contenido para evitar superposición. Comprobado en el servidor local con Playwright a 320, 390, 900 y 1440 px: separación de 32 px y sin desborde del bloque.

## Presentación de producto (2026-10-29)
- A pedido del usuario se incorporó debajo del hero la versión horizontal narrada de 70 s (`video/entregas/ucomenu-presentacion-youtube-narrado.mp4`), con imagen de portada, controles nativos y subtítulos en español generados a partir del guion. El video no arranca solo y se sirve bajo demanda (`preload=none`). Copia de 31,9 MB en `public/portada/presentacion.mp4`; procedencia en `public/portada/PROCEDENCIA.md`.
- Verificado en el diff local: `pnpm build`, `pnpm typecheck`, ESLint focalizado y `pnpm exec playwright test e2e/portada.spec.ts --workers=2` (12/12). Prueba comprueba controles, ausencia de descarga inicial, respuesta parcial del archivo y ancho de 320 y 1440 px; capturas inspeccionadas en `output/ux/`. FFmpeg decodificó video y audio completos sin errores. Subtítulos temporizados según inicio de frases del guion; falta revisión humana de sincronización y escucha en dispositivo real.

## Staging y push (2026-10-29)
- Autorizado por el usuario. `f13587d` integra portada y feed Pro; `ca30809` permite configurar la URL de demo al construir la imagen; ambos subidos a `origin/main`.
- `supabase db push --dry-run` mostró solo `20261210100000_feed_de_videos_en_pro.sql`; aplicada en staging. Antes, E2E `videos`, `videos-mux` y `superadmin-addons-baja`: 28/28; la sesión anterior verificó build y portada (12/12), y feed público en la corrida de UX. Revisión independiente C registrada en la ficha del feed.
- Fly v72, imagen `deployment-01M655ZFZ8N3X9P635VY3XGGKM`, construida desde `ca30809`, máquina iniciada y control passing. Smoke público: `/`, `/login`, `/m/demo/centro`, subtítulos 200; video responde 206 a rango. La portada apunta a la demo de staging; QR usa el dominio de staging. Sin operaciones de producción.
- Pendiente comprobación en dispositivo real, sincronización de subtítulos y resolución de los pendientes comerciales y legales antes de producción.

## Carta de ejemplo Aurelia (2026-10-30)
- Por pedido del usuario, el enlace y los QR usan por defecto `https://ucomenu-staging.fly.dev/m/aurelia/centro`; `NEXT_PUBLIC_DEMO_CARTA_PATH` sigue permitiendo reemplazarlo por ruta o URL. Se corrigió el texto que identificaba el ejemplo como QR de mesa: es enlace de sucursal.
- Diff local sin commit: prueba unitaria de marketing 6/6, ESLint focalizado correcto, carta de staging HTTP 200, portada local HTTP 200 con enlaces a Aurelia y Playwright focalizado correcto contra `next dev` en 3200. Build intentado dos veces: Windows denegó `unlink` de un archivo de `.next/static` (EPERM); E2E habitual no arrancó porque Docker estaba apagado, por lo que el test focalizado se corrió sin su global setup, sin base.
- Staging v72 aún conserva la URL de demo anterior en sus argumentos de build. Para publicar este cambio, reconstruir con `NEXT_PUBLIC_DEMO_CARTA_PATH=/m/aurelia/centro` o la URL de Aurelia; requiere autorización para despliegue. Antes de producción decidir una demo estable en ese entorno: el valor por defecto actual depende de staging.

- Desplegado con autorización el 2026-10-30: commit `94d91cc` subido a main; Fly v73 imagen `deployment-01M678H1F9X150RFRK8NE8EWCZ`, build y tipos en verde, máquina iniciada y control passing. Portada y carta Aurelia HTTP 200; la portada contiene las referencias a Aurelia. Se configuró la URL de Aurelia al construir; no hubo cambios de base ni de producción. No se escaneó físicamente el QR.

## Acceso en la navegación (2026-10-30)
El usuario pidió mostrar «Acceder» en el nav. El enlace existente a `/login` ahora también se muestra en móvil; se ajustaron espacios para que entre junto a «Probalo gratis» a 320 px. Verificado con ESLint focalizado, `pnpm build` y Playwright contra `next start` del build: enlace visible, objetivo táctil de 44 px, sin desborde y navegación a login. Una primera prueba contra `next dev` falló porque servía CSS anterior; la prueba del build actualizado pasó. Cambios locales sin despliegue.

- El acceso móvil al login se desplegó en staging Fly v74 desde `d9b710e`; comprobado en Chromium a 320 px con navegación a `/login`.
