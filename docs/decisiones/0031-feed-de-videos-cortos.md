# 0031 — Feed de videos cortos en la carta (plan Premium) en lugar de WebAR; likes y comentarios solo desde la mesa, con aprobación previa

- Estado: propuesta
- Fecha: 2026-10-21
- Reemplaza a: [0002 — WebAR sin app](0002-webar-sin-app.md) (descartada)

> El modelo de producto y de negocio (plan Premium, interacción desde la mesa, aprobación previa, límites) está **aceptado por el usuario** (2026-10-21). El **almacenamiento y la reproducción del video** quedan como propuesta hasta un spike en un iPhone y un Android reales.

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
8. **El identificador `webar` se retira** en el incremento de implementación: hoy siguen en la base el add-on `webar` del catálogo `addons`, su feature en `has_feature`/`org_entitlements` y el límite `models_3d`. Una migración los quita o los adapta y resuelve los contratos `webar` que existan (solo de ensayo).
9. **Almacenamiento y reproducción: lo decide un spike.** Las candidatas son Supabase Storage con MP4 H.264 directo o un servicio de streaming de pago que convierta formatos y sirva en calidad adaptativa. Usar un servicio de pago requiere aprobación.

## Alternativas consideradas
- **Mantener WebAR (ADR 0002)**: descartado por el usuario (costo de producción por plato, experiencia fuera de la página, poco valor percibido).
- **Feed como add-on sobre Pro o Premium**, con el esquema de WebAR: reutilizaba los contratos y la pantalla de SuperAdmin de ADR 0025, pero el usuario prefirió que sea un motivo de upgrade a Premium.
- **Comentarios publicados en el acto**, con moderación posterior: menos trabajo para el local, pero un insulto quedaría visible en su carta hasta que alguien lo viera.
- **Interacción también desde el link directo**: más alcance, pero cualquiera podría escribir desde fuera del local, sin el ticket de visita como freno.
- **Supabase Storage o un servicio de video externo, elegidos ya**: se pospone al spike porque depende de la reproducción real en iOS (videos HEVC/.mov del iPhone), de la cuota de transferencia (Supabase Free: 1 GB de almacenamiento y 5 GB de transferencia por mes) y del costo por local.

## Consecuencias
- UcoMenu publica contenido de terceros: hace falta una cola de moderación para Dueño y Staff, y actualizar `/terminos` y `/privacidad` antes de producción.
- El video es el recurso más caro de servir del producto: el spike debe estimar almacenamiento y transferencia por local, y es probable que adelante la subida de plan de Supabase o sume un proveedor (ADR 0015).
- El feed se carga bajo demanda; no puede penalizar el LCP de la carta (objetivo < 2,5 s en 4G).
- Las funciones de add-ons de ADR 0025 (`admin_set_addon`, `admin_end_addon`) quedan sin add-ons en el catálogo; se conservan para futuros add-ons.
- Premium se vende cuando se entregue lo que incluye (videos en la fase 2, fidelización en la fase 3); venderlo antes solo con videos sería una decisión comercial aparte.
- Los incrementos de implementación son **C**: tocan el catálogo de planes (dinero), abren escrituras anónimas y publican contenido.
