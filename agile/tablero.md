# Tablero (backlog flexible)

> **No es un cronograma.** No hay obligación de ejecutar por orden. Se elige el próximo ítem **desbloqueado** de mayor valor, urgencia o reducción de riesgo. Sin microtareas numeradas salvo que tengan dependencias reales.

Estados: **Backlog · Seleccionado · En curso · Bloqueado · Para verificar · Hecho**

Formato por línea: `- [nivel S/M/C] Título — nota (bloqueado por: X) → ficha: agile/cambios/x.md`

Actualizado: 2026-10-26. «Hecho» indica alcance implementado e integrado; el usuario confirmó todas las comprobaciones de «Para verificar» (2026-10-26). Producción sigue bloqueada aunque un cambio esté desplegado en staging.

## En curso

- (vacío)

## Seleccionado

- (vacío)

## Para verificar

- [M] Acciones del pedido desde Mesas y doble acceso a anotar — en staging Fly v67; pendiente comprobación manual → [ficha](cambios/acciones-pedido-desde-mesas.md)
- [M] Audios de notificación para mozo y cocina; aviso al completar el pedido — subido a main y desplegado en staging Fly v65, falta escucha manual → [ficha](cambios/audios-notificaciones.md)
- [C] Propina sugerida por sucursal — aprobada por Claude, en staging Fly v64 y subida a main; falta comprobación manual del usuario → [ficha](cambios/propina-sugerida.md)
- [M] Personal por sucursal, solo pantalla: el Dueño asigna sucursales a un mozo o cocinero desde Personal y ellos solo ven los pedidos, mesas, llamados, avisos y platos de esas sucursales (sin RLS; la restricción real es el ítem [C] del Backlog); implementado, verificado en local y desplegado en staging (Fly v62, 2026-10-26), falta tu comprobación manual → [ficha](cambios/personal-por-sucursal.md)

## Bloqueado

- [M] Salida a producción — preparación y staging hechos; dominio `ucomenu.com` confirmado (falta apuntarlo a la app); faltan proyecto de producción, configuración propia, purgas y respaldos programados, revisión legal (abogado y los pendientes visibles de `/terminos` y `/privacidad`) y aprobación del usuario → [ficha](cambios/salida-a-produccion.md)
- [S] Spike descartable de Apple Wallet y Google Wallet con ubicaciones — bloqueado por cuentas de Apple Developer y emisor de Google Wallet, aprobación y pago; valida ADR 0003 → [ADR 0003](../docs/decisiones/0003-fidelizacion-wallet-geofencing.md)

## Backlog

> Las fases agrupan por objetivo de entrega; dentro de cada una el orden es libre salvo las dependencias indicadas. Las fichas se crean al seleccionar el ítem.

### Mejoras y decisiones pendientes del MVP

- [C] Personal por sucursal con restricción real: que mozo y cocinero solo puedan leer **y escribir** lo de su sucursal (RLS de `orders`, `order_items`, `tables`, `waiter_calls`, cuentas de mesa; `set_order_item_status`, `set_kitchen_availability` y demás funciones del mozo y la cocina). Hoy solo se acota lo que ven en pantalla (ficha M, en «Para verificar») → [ficha M](cambios/personal-por-sucursal.md) · revierte parte de los ADR 0005 y 0034

### Fase 2 — Feed de videos cortos (plan Premium)

> Reemplaza al add-on WebAR, descartado el 2026-10-21 (ADR 0002 → [ADR 0031](../docs/decisiones/0031-feed-de-videos-cortos.md)). Reglas en `docs/producto.md`, «Feed de videos cortos».
> Catálogo, elección de Mux, carga y publicación de videos, el feed, los likes y los comentarios están en «Hecho»; el texto legal de los comentarios también está hecho; para habilitarlos en producción faltan la revisión de un abogado y programar la purga.


### Fase 3 — Fidelización, Wallet y cercanía (plan Premium) — fuera de este incremento

> Descartada de este incremento por decisión del usuario (2026-10-23): el sistema de fidelización va en otro incremento. Los ítems (programa de sellos, Apple Wallet, Google Wallet, recordatorio por cercanía y promociones por pase) se detallarán cuando ese incremento se abra; el contexto técnico sigue en el [ADR 0003](../docs/decisiones/0003-fidelizacion-wallet-geofencing.md).

### Próximo incremento — S4: Clientes recurrentes

> Pospuesto al próximo incremento por decisión del usuario (2026-10-26). S1–S3 de «Salón y crecimiento» están en «Hecho». Reglas en `docs/producto.md` (módulo 10) y [ADR 0042](../docs/decisiones/0042-clientes-recurrentes.md); se mantiene la revisión legal como requisito previo.

- [S] Texto de consentimiento y privacidad revisado por un abogado (rol de encargado, inscripción ante la AAIP) — bloqueado por: abogado
- [C] `customers` y alta por el personal con consentimiento; búsqueda por teléfono exacto, enmascarado para el Staff
- [C] Vincular cliente a pedido e historial de visitas (nunca a la mesa)
- [C] Baja, exportación y purga de datos del cliente
- [M] Preferencias estructuradas, sin datos de salud
- [C] Reconocimiento desde la carta por código de dispositivo (opcional, posterior)

### Fase 4 — Posterior al MVP

- [C] Cobro automático de la suscripción (Mercado Pago Suscripciones) con activación y suspensión por webhook
- [M] Subdominio o dominio propio por organización

## Hecho

> Una línea por ítem: qué es, fecha y ficha. Pruebas, decisiones y revisiones viven en la ficha; los motivos duraderos, en el ADR.

- [M] Información alimentaria segura y textos legales coherentes con la app: avisos que no sugieren alérgenos que no hay, notas de contacto cruzado y de opciones, traducciones viejas quitadas al cambiar el original, y términos, privacidad y `/alergenos` reescritos con pendientes visibles; implementado y verificado en local (2026-10-26); falta abogado y decisiones del usuario → [ficha](cambios/informacion-alimentaria-y-textos-legales.md)
- [S] Dominio: `ucomenu.com` confirmado como definitivo por el usuario (2026-10-26; ya es suyo, DNS en Cloudflare); procedimiento de apuntarlo a Fly y a Cloudflare documentado → [procedimiento](../docs/produccion.md) · [ADR 0015](../docs/decisiones/0015-estrategia-de-lanzamiento.md)

- [C] Rol de cocinero (pantalla `/cocina`: pedidos con «Listo», platos agotados por sucursal; Pro y Premium; flujo anotado → listo → entregado; sin precios ni acceso a Sala y panel) — comprobación manual confirmada por el usuario (2026-10-26) → [ficha](cambios/rol-cocinero.md) · [ADR 0048](../docs/decisiones/0048-rol-cocinero.md)
- [C] Resumen de la analítica con IA (botón «Generar resumen» en `/panel/{slug}/analitica`: párrafo, hallazgos y acciones sobre las cifras del período; Gemini gratis con datos ficticios y Claude antes de usar ventas reales) — comprobación manual confirmada por el usuario (2026-10-26) → [ficha](cambios/resumen-de-analitica-con-ia.md) · ADR 0047
- [M] Sugerencia de traducciones con IA (botón «Sugerir con IA» en las traducciones de la carta; Gemini con clave gratuita en local y staging, Claude en producción) — comprobación manual confirmada por el usuario (2026-10-26) → [ficha](cambios/traduccion-automatica.md) · ADR 0046
- [C] Reinicio de QR programado por sucursal y masivo por el mozo — comprobación manual confirmada por el usuario (2026-10-26) → [ficha](cambios/reinicio-programado-qr.md)
- [C] Turno de mesa (rota al cerrar, anular o reiniciar; el QR impreso no cambia) y cuenta del comensal («Ver mi cuenta» tras pedir la cuenta) — comprobación manual confirmada por el usuario (2026-10-26) → [turno](cambios/turno-de-mesa.md) · [cuenta](cambios/cuenta-del-comensal.md) · [ADR 0044](../docs/decisiones/0044-turno-de-mesa-y-cuenta-del-comensal.md)
- [M] Estilo de carta «Afiche» (Big Shoulders, bandas de color, platos numerados) — comprobación manual confirmada por el usuario (2026-10-26) → [ficha](cambios/estilo-afiche.md)
- [C] Sucursal adicional para Pro (ARS 12.000/mes, hasta 3) como add-on de cupo, con cancelación que desactiva las elegidas — comprobación manual confirmada por el usuario (2026-10-26) → [ficha](cambios/sucursal-adicional.md) · [ADR 0039](../docs/decisiones/0039-sucursal-adicional-y-vistas-previas.md)
- [S] Comprobación con sesión en staging: catálogo vacío de add-ons y baja/reactivación en SuperAdmin; apariencia y temas, editor de platos y selector de Sala de Fly v18 — comprobación manual confirmada por el usuario (2026-10-26) → [catálogo y despliegue](cambios/catalogo-video-feed.md#despliegue-en-staging--2026-10-21) · [add-ons y baja](cambios/addons-y-baja-de-organizaciones.md)
- [S] Prueba en un Android real de la subida de videos desde el panel y el feed (también en Firefox y en Safari de escritorio) — comprobación manual confirmada por el usuario (2026-10-26) → [ficha](cambios/feed-de-videos.md)
- [S] Ticket de visita en teléfono real: volver a la carta tras más de 3 h con la pantalla apagada y comprobar nuevo escaneo y recuperación de pestañas descartadas — comprobación manual confirmada por el usuario (2026-10-26) → [ficha](cambios/ticket-de-visita.md)

- [C] Esquema de pedidos y alta de ítems sin opciones, con precio calculado por la base → [ficha](cambios/pedidos-esquema-y-alta-de-items.md) (hecho, en staging)
- [C] Variantes, adicionales y observaciones con validación de mínimos y máximos → [ficha](cambios/pedidos-variantes-adicionales-observaciones.md) (hecho, en staging)
- [C] Estados, modificar y cancelar con registro de solo-agregado; cerrar y anular sin bloqueo por mora → [ficha](cambios/pedidos-estados-y-registro.md) (hecho, en staging)
- [M] Vista «Mesas» en la Sala: pedido abierto + llamados por mesa y total en «Pedir la cuenta» → [ficha](cambios/sala-mesas-y-total.md) (hecho en local, 2026-10-24)
- [M] Pantalla «Anotar» en la Sala: elegir plato con variantes, cantidad y observación → [ficha](cambios/sala-anotar-pedido.md) (hecho, en staging, 2026-10-24)
- [M] Operar el pedido desde la Sala: cambiar estados, modificar y cancelar líneas, cerrar y anular → [ficha](cambios/sala-operar-pedido.md) (hecho, en staging, 2026-10-24)
- [M] Llamados dentro de «Mesas»: una sola pantalla para el mozo (se elimina la lista aparte de «Sala en vivo») → [ficha](cambios/mesas-con-llamados.md) (hecho en local, 2026-10-26)
- [M] Precuenta «no válida como factura», imprimible y sin observaciones → [ficha](cambios/sala-precuenta.md) (hecho, en staging, 2026-10-24)
- [C] Retención de pedidos (2 años desde el cierre, a confirmar con el contador) y su purga por lotes (`service_role`) → [ficha](cambios/retencion-de-pedidos.md) (hecho, revisado por Codex y migración en staging, 2026-10-24; sin programar; la purga con la organización ya estaba hecha)
- [C] Analítica de pedidos para el Dueño (rework Pro/Premium: resumen con comparación, ventas por día, franjas, platos, categorías y anulaciones) → [ficha](cambios/analitica-de-pedidos.md) · ADR 0045 (hecho, revisado por Codex en 3 rondas, aprobado por el usuario y desplegado en staging, Fly v54, 2026-10-25)

- [S] Pantalla del historial de promociones: `/panel/{slug}/promociones/historial`, Dueño y Staff, de a 50, con el detalle en palabras y las mismas reglas de «quién» que el historial de precios; implementada, verificada y en staging (2026-10-23) → [ficha](cambios/historial-de-promociones.md)
- [M] Carta con precio promocional en vivo: la carta y el feed leen `effective_prices` fuera de la caché y muestran el precio de lista tachado, el promocional y hasta cuándo, en es/en/pt; falla cerrado; sin medir el LCP; implementada, verificada y en staging (Fly versión 40, 2026-10-23) → [ficha](cambios/carta-con-precio-promocional.md)
- [M] Panel de promociones del Dueño: crear, editar, pausar, duplicar y borrar con guardado atómico (`save_promotion`), aviso de superposición y vista previa por día y hora; el Staff las ve; implementado y verificado, migración `20261124100000` y app en staging (Fly versión 40, 2026-10-23) → [ficha](cambios/panel-de-promociones.md)
- [C] Promociones y función de precio efectivo: tablas, historial de solo-agregado, `promotions` en Pro y Premium, `effective_prices` (única autoridad del precio) y paridad con la réplica en TypeScript con casos de medianoche y horario de verano; aprobado por Codex (3 rondas) y por el usuario; migración en staging y app en Fly versión 38 (2026-10-23) → [ficha](cambios/promociones-y-precio-efectivo.md) · [ADR 0040](../docs/decisiones/0040-promociones-programadas.md)
- [M] Zona horaria por sucursal: `branches.timezone` (lista cerrada de 22 zonas, Buenos Aires por defecto), editable solo por el Dueño; la facturación y la mora no cambian; migración en staging y app en Fly versión 38 (2026-10-23) → [ficha](cambios/zona-horaria-por-sucursal.md) · [ADR 0040](../docs/decisiones/0040-promociones-programadas.md)
- [C] Vistas previas de funciones por organización: tabla auditada con fin de hasta 90 días, `plan_grants` = plan ∪ vistas previas vigentes y bloque plegable en la ficha del SuperAdmin; aprobadas por Codex y por el usuario, con migración y app en staging (Fly versión 37, 2026-10-23) → [ficha](cambios/vistas-previas-de-funciones.md) · [ADR 0039](../docs/decisiones/0039-sucursal-adicional-y-vistas-previas.md)
- [M] Invitación a reseñar en la carta: enlace en el pie para todos los planes e invitación tras «Pedir la cuenta» (dock de llamados, Pro o superior), una vez al día por dispositivo, textos fijos es/en/pt; en `origin/main` y en staging (2026-10-23) → [ficha](cambios/invitacion-a-resenar.md)
- [M] Enlace de reseñas de Google por sucursal: columna validada con hosts exactos de Google (`CHECK` espejo de la validación local), editable solo por el Dueño con la cuenta al día y legible por la carta pública mientras la sucursal esté activa y publicada; implementado y verificado en local, y en staging con su migración (2026-10-23); la carta lo muestra desde la [invitación](cambios/invitacion-a-resenar.md) → [ficha](cambios/enlace-de-resenas-de-google.md)
- [M] Guía de primeros pasos descartable por cuenta (preferencia guardada en la base, con renglón para volver a mostrarla) y resumen por sucursal cuando hay varias; en `origin/main` y en staging (2026-10-23) → [ficha](cambios/guia-descartable.md)
- [C] Cuentas de Auth sin ningún local: se conservan y SuperAdmin las lista en `/admin/cuentas` y borra una a mano (email escrito, motivo, reserva de la cuenta y constancia sin el email); aprobado por Codex (3 rondas), en `origin/main` y en staging (2026-10-23) → [ficha](cambios/cuentas-sin-local.md) · [ADR 0032](../docs/decisiones/0032-reserva-de-cuentas-globales.md)
- [C] Escrituras públicas de la mesa solo desde el servidor: `create_waiter_call`, `set_video_like` y `submit_video_comment` las ejecuta únicamente `service_role` y la acción de servidor verifica antes ticket y conexión; cierra el límite aceptado de llamado, likes y comentarios; aprobado por Codex, en `origin/main` y en staging (2026-10-23) → [ficha](cambios/escrituras-publicas-solo-servidor.md) · [ADR 0038](../docs/decisiones/0038-escrituras-publicas-solo-servidor.md)
- [S] Variantes y adicionales: las seis decisiones conservadoras quedan confirmadas por el usuario sin cambios de código (2026-10-23) → [ficha](cambios/variantes-y-adicionales.md#confirmadas-por-el-usuario-el-2026-10-23-decisiones-conservadoras-tomadas-sin-poder-preguntar)
- [S] Textos legales de los comentarios: `/privacidad` y `/terminos` explican aprobación previa, qué se guarda, plazos de borrado (7 y 30 días), cómo pedir que se quite uno y las reglas para comensales y locales (2026-10-23); falta la revisión de un abogado → [ficha](cambios/textos-legales.md#ampliación--comentarios-del-feed-2026-10-23)
- [C] Comentarios con aprobación previa: `submit_video_comment` (única puerta; nace pendiente), hoja de comentarios en el feed, cola de moderación para Dueño y Staff en `/panel/{slug}/comentarios`, rechazados 7 días y pendientes 30 (purga `purge_video_comments`, sin programar); implementado y verificado en local; aprobado por Codex con el límite de la función pública aceptado por el usuario como excepción (3 rondas, 2026-10-23); en `origin/main` y en staging (2026-10-23); aprobado por el usuario (2026-10-23) → [ficha](cambios/comentarios-del-feed.md) · [ADR 0031](../docs/decisiones/0031-feed-de-videos-cortos.md)
- [C] Likes anónimos desde la mesa: `set_video_like` (única puerta), un like por dispositivo y video con código aleatorio en el navegador, conteo público y límite por conexión; `/privacidad` actualizada; aprobado por Codex (2 rondas, 2026-10-22); en `origin/main` y en staging (2026-10-22); aprobado por el usuario (2026-10-23) → [ficha](cambios/likes-del-feed.md) · [ADR 0031](../docs/decisiones/0031-feed-de-videos-cortos.md)
- [C] Feed vertical de videos en la carta, también desde la mesa (`/t/{token}/videos`, con la barra de llamado): lectura pública por política de base, `hls.js` con fallback; aprobado por Codex (5 rondas), en staging y probado por el usuario (2026-10-22) → [ficha](cambios/feed-de-videos.md) · [ADR 0031](../docs/decisiones/0031-feed-de-videos-cortos.md)
- [C] Carga y publicación de videos desde el panel con Mux: hecho (partes A y B aprobadas por Codex, en staging, Fly v21; probado con un iPhone 16 y un `.mov` HEVC) → [parte A](cambios/videos-del-panel-base.md) · [parte B](cambios/videos-mux-parte-b.md) · [ADR 0031](../docs/decisiones/0031-feed-de-videos-cortos.md)
- [C] Catálogo del feed: WebAR y `models_3d` retirados, contratos resueltos y SuperAdmin adaptado; `video_feed` en Premium y cupo de 10 publicados — aprobado, en `origin/main`, migración y app en staging (2026-10-21) → [ficha](cambios/catalogo-video-feed.md) · ADR 0031
- [M] Edición de plato por tareas: datos y foto juntos en PC, pestañas y borradores conservados — hecho (desplegado en staging, Fly v18, 2026-10-21) → [ficha](cambios/editor-plato-ux.md)
- [M] Selector de Sala: cambio directo de sucursal y selección múltiple explícita — hecho (desplegado en staging, Fly v18, 2026-10-21) → [ficha](cambios/selector-sucursal-directo.md)
- [C] Carta central con precio, disponibilidad y visibilidad por sucursal (nivel 2a): precio propio ($ 0 válido), agotado y oculto por sucursal; revisado por Codex (3 rondas); aprobado, subido y desplegado en staging con su migración (2026-10-21; el rollback del historial se acepta con su limitación) → [ficha](cambios/carta-por-sucursal.md) · ADR 0035
- [C] Vista por sucursal de cada persona (sala, cartel, sonido, push y analítica): preferencia, no permiso; revisado por Codex (3 rondas); aprobado, subido y desplegado en staging (2026-10-21) → [ficha](cambios/vista-por-sucursal.md) · ADR 0034
- [M] Detalle, retorno y confirmaciones y formularios, cuenta y mensajes (tandas 3 y 4 de UX): aprobados, subidos y desplegados en staging (2026-10-21) → [tanda 4](cambios/detalle-retorno-y-confirmaciones.md) · [tanda 3](cambios/formularios-cuenta-y-mensajes.md)
- [C] Listas completas (más de 1000 filas), reordenamientos atómicos y reemplazo de imágenes sin huérfanos: aprobado por Codex, subido y desplegado en staging con su migración (2026-10-21) → [ficha](cambios/orden-e-imagenes-atomicos.md) · ADR 0033
- [C] Cuentas globales de Auth protegidas (SuperAdmin intocable desde un local, reserva contra la carrera, 503 de sala con Auth caído, logos en el respaldo): aprobado por Codex, subido y desplegado en staging con su migración (2026-10-21) → [ficha](cambios/proteger-cuentas-globales.md) · ADR 0032
- [C] Borrado de mesas junto con sus llamados: aprobado por Codex, subido y desplegado en staging con su migración (2026-10-21) → [ficha](cambios/borrado-de-mesas.md) · ADR 0030
- [S] Almacenamiento y reproducción de videos: Mux Video elegido y aprobado; alcance y condiciones registrados (2026-10-21) → [ADR 0031](../docs/decisiones/0031-feed-de-videos-cortos.md)
- [C] Borrado de categorías y platos con limpieza de fotos, confirmación en dos pasos e historial conservado; revisado por Codex, publicación autorizada por el usuario, subido a `origin` y desplegado en staging (2026-10-21), con la RLS vigente de Dueño y Staff → [ficha](cambios/borrado-de-categorias-y-platos.md) · ADR 0029
- [C] SuperAdmin: borrado definitivo de organizaciones tras baja auditada de 30 días, con identificador escrito, motivo y auditoría; revisado por Codex, aprobado por el usuario, integrado en `main`, subido a `origin` y desplegado con su migración en staging (2026-10-20) → [ficha](cambios/borrado-de-organizaciones.md) · ADR 0028
- [C] Retención y purga de `payments` y `payment_voids`: sobreviven al borrado de la organización y se conservan 10 años; revisión independiente aprobada, integración autorizada por el usuario, subida a `origin` y desplegada en staging (2026-10-20; plazo por confirmar con el contador antes de producción) → [ficha](cambios/retencion-de-pagos.md) · ADR 0027
- [C] Retención y purga de `price_history`: se purga con la organización, tras 30 días de baja auditada, por una función que nadie de la API ejecuta; aprobada por Codex, subida a `origin` y migración aplicada en staging (2026-10-20) → [ficha](cambios/purga-de-price-history.md) · ADR 0026
- [C] SuperAdmin: gestión de add-ons y baja/reactivación de organizaciones — aprobado, integrado y desplegado en staging; catálogo actual sin WebAR (2026-10-20; retiro 2026-10-21) → [ficha](cambios/addons-y-baja-de-organizaciones.md) · ADR 0025
- [C] SuperAdmin anula un pago mal cargado: asiento compensatorio con motivo, solo el último pago vigente, el vencimiento vuelve al de antes y el Dueño lo ve marcado; revisado por Codex en dos rondas y aprobado por el usuario (2026-10-19; migración aplicada y desplegado en staging) → [ficha](cambios/anular-pagos.md) · ADR 0024
- [S] Prueba en un teléfono real sobre staging: textos legales (`/terminos`, `/privacidad`, `/alergenos`), alta de una organización desde `/admin` y pantalla «Llamados» en el salón; todo bien según el usuario (2026-10-19)
- [M] Carta en varios idiomas: español, inglés y portugués; el local escribe las traducciones en `/panel/{slug}/carta/traducciones`, la carta cae al español donde falta y no usa servicios externos; probada y aprobada por el usuario, integrada a `main` (2026-10-18; migración aplicada y desplegada a staging) → [ficha](cambios/carta-en-varios-idiomas.md) · ADR 0023
- [C] Analítica básica para el Dueño con plan Pro: platos más vistos (contadores anónimos por día, sin guardar nada del comensal) y llamados por hora de los últimos 14 días, con detalle al pasar el cursor o tocar; revisado por Codex en tres rondas y aprobado por el usuario (2026-10-19) → [ficha](cambios/analitica-basica.md) · ADR 0022
- [C] El Dueño lee los pagos y el historial de cambios de su cuenta en Suscripción: dos funciones de base solo de lectura con proyección segura (lista blanca, sin actor, motivo ni ids de terceros); revisado por Codex en dos rondas y aprobado por el usuario (2026-10-18); → [ficha](cambios/dueno-lee-pagos-y-auditoria.md) · ADR 0021
- [M] Aviso de llamados en iPhone y iPad: la sala y el panel se instalan como app (manifiesto, íconos, instrucciones en pantalla) y el aviso siempre se muestra en Apple; probado y aprobado por el usuario en un iPhone real contra staging (2026-10-18; desplegado a staging) → [ficha](cambios/aviso-push-iphone.md)
- [M] Aviso de llamados también desde el panel: cartel fijo con los llamados pendientes, «Sala en vivo» en modo alerta con contador, sonido que sigue al salir de la sala y activación del aviso del sistema desde el Resumen; probado y aprobado por el usuario en su Chrome (2026-10-18; desplegado a staging) → [ficha](cambios/aviso-push-desde-el-panel.md)
- [C] Aviso de llamados con la pestaña cerrada por Web Push (Android y Windows): tabla de suscripciones cerrada a la API, envío desde el servidor, service worker de la sala; revisado por Codex en tres rondas, probado por el usuario en Windows y Android contra staging y aprobado (2026-10-18) → [ficha](cambios/aviso-push-de-llamados.md) · ADR 0020
- [S] Restauración ensayada en un proyecto Supabase nuevo; repetición manual con recordatorio mensual configurado (2026-10-17) → [ficha](cambios/salida-a-produccion.md#ensayo-de-restauración-en-un-proyecto-nuevo-2026-10-17)
- [S] Wake Lock nativo del panel de sala comprobado con HTTPS en Chrome de Windows (2026-10-17) → [ficha](cambios/panel-de-sala.md#ensayo-de-wake-lock-nativo-con-https-2026-10-17)
- [S] Carta de demostración en staging: organización `demo` con 26 platos y 24 fotos; herramienta `tools/sembrar-demo-staging.mjs` (2026-10-17) → [ficha](cambios/demo-en-staging.md)
- [M] Login y sala en vivo con el lenguaje del panel; integrado a `main` y desplegado en staging (2026-10-17) → [ficha](cambios/ui-login-y-sala.md)
- [C] SuperAdmin suma una cuenta existente como Dueño de otra organización; integrado a `main`, migración aplicada en staging y aprobado por el usuario (2026-10-17) → [ficha](cambios/dueno-existente.md)
- [C] Desactivar y reactivar sucursales; integrado a `main`, migración confirmada en staging y cierre aprobado por el usuario (2026-10-17) → [ficha](cambios/desactivar-sucursales.md)
- [M] Rediseño del panel del Dueño y de SuperAdmin con el lenguaje de la carta (riel lateral, celdas, paleta del local y paleta UcoNext); revisado de forma independiente y por Codex; integrado a `main` y subido a `origin` (2026-10-17) → [ficha](cambios/ui-panel-dueno-y-superadmin.md)
- [M] Rediseño de la carta pública: Bento + Editorial + Cards (Gloock + Schibsted, bento de categorías, bandas pegajosas, cards de plato, dock de llamado); revisado de forma independiente; `PRODUCT.md` y `DESIGN.md` del sistema (2026-10-17) → [ficha](cambios/ui-carta-publica.md)
- [M] Corrección del slug de sucursal por SuperAdmin con históricos reservados y redirección a la dirección vigente → [ficha](cambios/correccion-slug-sucursal.md)
- [M · C técnico] Buscador y filtros dietarios con aviso de alérgenos junto a los filtros; integrado a `main` por decisión del usuario (2026-10-17) → [ficha](cambios/buscador-y-filtros-dietarios.md)
- [M · C técnico] Disponibilidad por sucursal (agotado visible, lectura en vivo); integrado a `main` por decisión del usuario (2026-10-17) → [ficha](cambios/disponibilidad-por-sucursal.md)
- [M] Temas de fechas especiales de la carta (San Valentín, Navidad, Halloween…), con ventana de fechas; aprobado y commiteado 2026-10-21; migración y app en staging (Fly v18) → [ficha](cambios/temas-de-fechas.md)
- [M] Personalización de la carta: paletas oscuras y vivas, vista previa real y estilo de carta; aprobado y commiteado 2026-10-21; migraciones y app en staging (Fly v18) → [ficha](cambios/personalizacion-carta.md)
- [C] Identidad del local: logo y cuatro paletas; revisión recibida sin bloqueantes, límites registrados y ajustes menores atendidos (2026-10-16) → [ficha](cambios/identidad-del-local.md)
- [S] Categorías y platos de la carta pública paginados; cerrado sin revisión independiente por su nivel (2026-10-16) → [ficha](cambios/paginacion-carta-publica.md)
- [M] Variantes y adicionales: grupos por plato y publicación de opciones activas — integrado y migración aplicada en staging; decisiones de producto abiertas en Backlog (2026-10-17; estado de staging actualizado 2026-10-21) → [ficha](cambios/variantes-y-adicionales.md)
- [C] SuperAdmin: planes, suspensión/reactivación, pagos y prueba de 14 días con auditoría — reglas A1–A8 aprobadas, integrado y migración aplicada en staging (2026-10-16; estado de staging actualizado 2026-10-21) → [ficha](cambios/superadmin-planes-pagos.md) · ADR 0013
- [C] Gestión de sucursales: alta y renombrado dentro del tope del plan — política aprobada, integrado y migración aplicada en staging (2026-10-16; estado de staging actualizado 2026-10-21) → [ficha](cambios/gestion-de-sucursales.md)
- [M] Rendimiento de la carta pública: fotos reducidas en WebP por `/_next/image` y caché de categorías y platos con invalidación desde el panel; LCP en 4G de 11,3 s a 1,9 s; revisado por Codex, con un límite aceptado (una lectura en vuelo durante una edición puede dejar la carta anterior hasta 60 s) (2026-10-16) → [ficha](cambios/rendimiento-carta-publica.md)
- [M] Alta guiada del dueño: primeros pasos en el Resumen — implementado e integrado; mejoras no decididas en Backlog (2026-10-16) → [ficha](cambios/alta-guiada-del-dueno.md)
- [M] Cierre de sesión de mesa al atender «Pedir la cuenta», con 10 minutos de gracia — revisado por Codex, integrado y migración aplicada en staging (2026-10-16; estado de staging actualizado 2026-10-21) → [ficha](cambios/cerrar-sesion-al-atender-la-cuenta.md) · ADR 0010
- [S] Repaso de diseño del historial de precios: agrupado por día, cambio de precio destacado y etiqueta Sube/Baja; sin tocar datos ni permisos; revisado en capturas a 390 y 1280 px (2026-10-16)
- [S] `expectNoHorizontalOverflow` mide el borde derecho de cada elemento (ignora lo recortado por un scroll propio) y reemplaza a las copias locales de tres specs; E2E completo en verde (2026-10-16); de paso, la siembra de `ticket-de-visita` ya no depende de los milisegundos
- [S] Textos legales: `/terminos`, `/privacidad` y `/alergenos`, enlazados desde la portada, el login y la carta; borrador pendiente de revisión legal (2026-10-16) → [ficha](cambios/textos-legales.md)
- [M] SuperAdmin: el alta de una organización crea también su primera sucursal y la carta pública se abre de inmediato (2026-10-16) → [ficha](cambios/alta-con-primera-sucursal.md)
- [M] Revisión de Codex automatizada desde Claude: `pnpm revision:codex` (Codex CLI en solo lectura, veredicto como código de salida) y skill `ciclo-revision-codex`; probada con Codex real y con un Codex falso (2026-10-16) → tools/revision-codex.mjs
- [M] Revisión de Claude desde Codex; procedimiento en ambos sentidos y skill exclusiva de tareas críticas C (2026-10-17) → [ficha](cambios/revision-claude-desde-codex.md)
- [C] Purga de `waiter_calls` por antigüedad: `purge_waiter_calls`, 14 días por defecto, piso de 7, solo `service_role`; falta programar su ejecución en «Salida a producción» (2026-10-16) → [ficha](cambios/purga-de-waiter-calls.md) · ADR 0014
- [S] SuperAdmin: quien inicia sesión sin `next` aterriza en `/admin` (y el resto en `/panel`); un `next` válido manda siempre (2026-10-15, `aea92a8`)
- [M] Simplificación de Agile-SDD: rigor por consecuencias, verificación por impacto, una función por documento, handoff breve, sincronizador acotado a las 4 skills (2026-10-15) → [ficha](cambios/simplificacion-agile-sdd.md)
- [S] Orden local del repositorio: `output/` excluido de Git y ESLint y `docs/referencias/HUMM-MENU.png` de Git; archivos conservados (2026-10-15)
- [C] SuperAdmin, alta de organizaciones: `/admin` y `/admin/nueva` crean una organización con su Dueño, plan y auditoría de solo-agregado (integrado a `main` 2026-10-15) → [ficha](cambios/superadmin-alta-de-organizaciones.md) · ADR 0013
- [M] Configuración del llamado: silenciar mesas y cooldown por sucursal en `/panel/{slug}/llamados` (2026-10-14) → [ficha](cambios/configuracion-del-llamado.md)
- [M] Ticket de visita: la pestaña de `/t/{token}` vence a las 3 h y la sala muestra cuánto hacía que escaneó (2026-10-14) → [ficha](cambios/ticket-de-visita.md) · ADR 0010
- [M] Pantalla del historial de precios: por local y por plato, Dueño y Staff (2026-10-14) → [ficha](cambios/pantalla-historial-de-precios.md)
- [M] Diseño gastronómico de la carta pública, dirección editorial (2026-10-14); la variante A queda como alternativa histórica (`feat/diseno-carta`, etiqueta `alt/carta-variante-a-tarjetas`) → [ficha](cambios/diseno-carta.md)
- [M] Panel de sala en tiempo real por sondeo corto (2026-10-14) → [ficha](cambios/panel-de-sala.md) · ADR 0011
- [C] Historial de cambios de precio: `price_history` de solo-agregado por trigger (2026-10-14) → [ficha](cambios/historial-de-precios.md) · ADR 0012
- [C] Llamado desde la mesa: `create_waiter_call` como única puerta de escritura pública (2026-10-14) → [ficha](cambios/llamado-desde-la-mesa.md) · ADR 0010
- [M] Mesas y QR: alta de mesas, token opaco, hoja imprimible y entrada pública `/t/{token}` (2026-10-14) → [ficha](cambios/mesas-y-qr.md) · ADR 0009
- [M] Gestión de carta: categorías y platos con foto, orden y activo/inactivo (2026-10-14) → [ficha](cambios/gestion-de-carta.md) · ADR 0008
- [C] Acceso del personal: login, `/panel` y `/sala` por rol, gestión de personal y aviso de mora (2026-10-14) → [ficha](cambios/acceso-del-personal.md) · ADR 0007
- [C] Planes y entitlements: catálogo, mora derivada, límites por plan y carta suspendida (2026-10-14) → [ficha](cambios/planes-y-entitlements.md) · ADR 0006
- [C] Núcleo multi-tenant: membresías, roles y RLS con aislamiento entre organizaciones (2026-10-14) → [ficha](cambios/nucleo-multi-tenant.md) · ADR 0005
- [M] Esqueleto caminante: bootstrap + carta pública de solo lectura con RLS (2026-10-13) → [ficha](cambios/esqueleto-menu-publico.md)
- [M] Exploración inicial: producto, arquitectura, ADR 0001–0004 y backlog (2026-10-13)
