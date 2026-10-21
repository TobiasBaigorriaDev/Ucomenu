# 0031 — Feed de videos cortos en la carta (plan Premium) en lugar de WebAR; likes y comentarios solo desde la mesa, con aprobación previa

- Estado: aceptada
- Fecha: 2026-10-21
- Reemplaza a: [0002 — WebAR sin app](0002-webar-sin-app.md) (descartada)

> El modelo de producto, de negocio (plan Premium, interacción desde la mesa, aprobación previa, límites) y el **almacenamiento y reproducción en Mux Video** están **aceptados por el usuario** (2026-10-21).

## Contexto
La fase 2 iba a ser un add-on de realidad aumentada (ADR 0002). El usuario la descartó por no ser buena idea para el producto: cada plato exigía producir y validar dos modelos 3D a escala real, el costo era de UcoMenu y en iOS la experiencia ocurría fuera de la página. Lo que se busca en cambio es que la carta muestre **el local vivo** (ambiente, preparación y presentación de los platos) en un formato que el comensal ya conoce, y que genere interacción.

El comensal es anónimo y sin registro; la única escritura pública que existe hoy (el llamado al mozo) pasa por una función de base con el ticket de visita de la mesa (ADR 0010). Un comentario es contenido de un tercero que se publica en la carta del local.

## Decisión
1. **Feed de videos cortos con scroll vertical** (estilo Reels) dentro de la carta pública: el local publica videos del restaurante, del ambiente y de sus platos; un video puede enlazarse a un plato.
2. **Incluido en el plan Premium**, sin add-on: feature `video_feed` por plan y límite `videos_published` en `plans` (cupo inicial de **10 videos publicados**, parametrizable). Como el resto de los límites (ADR 0006), cuenta al publicar y superar el tope no borra nada.
3. **Límites por video:** hasta **30 segundos** y **50 MB** por archivo subido, en vertical 9:16.
4. **Like y comentario solo desde el QR de una mesa**, con el ticket de visita de 3 horas (ADR 0010, enmienda). El link directo ve el feed, pero no interactúa.
5. **Comentarios con aprobación previa:** alias opcional, sin datos personales; quedan pendientes y solo se publican cuando el local los aprueba.
6. **Likes anónimos:** uno por dispositivo y video, sin guardar nada que identifique al comensal (como los contadores de ADR 0022).
7. **Escritura pública por funciones de base únicas** (como `create_waiter_call`), que validan todo adentro: ticket, mesa activa, `has_feature(org, 'video_feed')`, cuenta en gracia o al día y límite por cliente. `anon` no escribe en ninguna tabla.
8. **El identificador `webar` se retira** en el incremento de implementación: hoy siguen en la base el add-on `webar` del catálogo `addons`, su feature en `has_feature`/`org_entitlements` y el límite `models_3d`. Una migración los quita o los adapta y resuelve los contratos `webar` que existan (solo de ensayo). **Hecho** en la migración `20261110100000` ([ficha](../../agile/cambios/catalogo-video-feed.md)): el catálogo de add-ons queda vacío.
9. **Almacenamiento y reproducción con Mux Video** (aprobado por el usuario el 2026-10-21): subida directa desde el panel mediante URL firmada de un solo uso (*Direct Upload*), transcodificación automática de cualquier entrada (incluidos `.mov` HEVC/HDR de iPhone) a **HLS adaptativo** (`.m3u8`) con póster generado por Mux y límite `max_resolution_tier = 1080p` / calidad `basic` (codificación sin costo). En la base (`menu_videos`) solo se guardan los identificadores de Mux (`asset_id`, `playback_id` público cuando se publica, estado y metadatos). Costo verificado (2026-10-21): plan **Free** sin tarjeta (hasta 10 videos y 100.000 min/mes de entrega) para desarrollo y pruebas en staging; plan **Pay-as-you-go** en producción con **USD 20/mes de crédito gratis + 100.000 min/mes de entrega incluidos** (almacenamiento ~$0,00045/min y entrega adicional ~$0,00096/min: un local con 10 videos de 30 s y 2.000 min vistos/mes consume ~USD 0,002/mes de almacenamiento y entra en los 100.000 min/mes gratuitos; más allá del cupo gratuito, ~USD 1,95/mes por local frente a los USD 70/mes del plan Premium). No consume almacenamiento ni transferencia de Supabase.

## Alternativas consideradas
- **Mantener WebAR (ADR 0002)**: descartado por el usuario (costo de producción por plato, experiencia fuera de la página, poco valor percibido).
- **Feed como add-on sobre Pro o Premium**, con el esquema de WebAR: reutilizaba los contratos y la pantalla de SuperAdmin de ADR 0025, pero el usuario prefirió que sea un motivo de upgrade a Premium.
- **Comentarios publicados en el acto**, con moderación posterior: menos trabajo para el local, pero un insulto quedaría visible en su carta hasta que alguien lo viera.
- **Interacción también desde el link directo**: más alcance, pero cualquiera podría escribir desde fuera del local, sin el ticket de visita como freno.
- **Supabase Storage con MP4 directo, FFmpeg en Fly.io o Bunny / Cloudflare Stream**: se descartó **Supabase Storage con MP4 directo** porque los iPhone graban por defecto en `.mov` HEVC/10-bit que falla con pantalla negra en muchos Android Chrome, un MP4 sin el átomo `moov` al inicio bloquea el arranque en iOS Safari, y videos de hasta 50 MB / 30 s (~13,3 Mbps) traban el 4G del salón y agotan los 5 GB de Supabase Free en ~100 vistas (o consumen 60–300 GB/mes por local en Supabase Pro); se descartó **transcodificar con FFmpeg en Fly.io** porque la máquina de 512 MB de RAM sufriría OOM y saturación de CPU; y frente a **Bunny Stream / Cloudflare Stream** (~USD 1,10–2,05/mes por local), **Mux Video** ofrece plan Free sin tarjeta para staging y USD 20/mes de crédito + 100.000 min/mes gratis en producción.

## Consecuencias
- UcoMenu publica contenido de terceros: hace falta una cola de moderación para Dueño y Staff, y actualizar `/terminos` y `/privacidad` antes de producción.
- Con **Mux Video** el tráfico de video no pasa por Supabase Storage ni adelanta la subida a Supabase Pro. Las credenciales de API de Mux (`MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`) viven solo en el servidor. Borrar un video en el panel debe borrar también el asset en Mux.
- El feed se carga bajo demanda; no puede penalizar el LCP de la carta (objetivo < 2,5 s en 4G).
- Las funciones de add-ons de ADR 0025 (`admin_set_addon`, `admin_end_addon`) quedan sin add-ons en el catálogo; se conservan para futuros add-ons.
- Premium se vende cuando se entregue lo que incluye (videos en la fase 2, fidelización en la fase 3); venderlo antes solo con videos sería una decisión comercial aparte.
- Los incrementos de implementación son **C**: tocan el catálogo de planes (dinero), abren escrituras anónimas y publican contenido.
